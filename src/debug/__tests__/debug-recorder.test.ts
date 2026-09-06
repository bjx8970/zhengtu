/**
 * Debug Trace 录制器测试（IndexedDB 以 mock 替代，聚焦会话逻辑）。
 *
 * 通过模块级 dispatch 驱动真实 reducer，验证：
 * NEW_GAME 完整轨迹、有效操作记录、无效操作丢弃、LOAD_SAVE 连续性认领
 * （同 saveId 最新快照续接；旧快照分支化不继承未来 journal）、
 * 认领窗口不重复持久化、清除。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { unwrap } from 'solid-js/store';

vi.mock('../debug-storage', () => ({
  BRANCH_TRACE_PREFIX: 'branch',
  LEGACY_TRACE_PREFIX: 'legacy',
  persistTraceMeta: vi.fn(async () => undefined),
  appendJournalRecord: vi.fn(async () => undefined),
  loadStoredTrace: vi.fn(async () => null),
  findTraceKeyByStateHash: vi.fn(async () => null),
  clearTrace: vi.fn(async () => undefined),
}));

import { dispatch, useGameStore } from '../../store/game-store';
import { buildDebugBundle } from '../debug-exporter';
import { replayBundle } from '../debug-replay';
import { clearDebugTrace, getDebugTraceSession, getTraceStatusSignal } from '../debug-recorder';
import {
  appendJournalRecord,
  clearTrace,
  findTraceKeyByStateHash,
  loadStoredTrace,
  persistTraceMeta,
} from '../debug-storage';
import type { StoredTraceMeta } from '../debug-storage';
import { hashSave } from '../state-hash';
import type { DebugActionRecord, DebugMetadata } from '../debug-types';
import type { PlayerSave } from '../../types/player';

const traceStatus = getTraceStatusSignal();

/** 录制型随机数工厂：每次消费固定值并记录调用 */
function recordingRng(sink: number[]): () => number {
  return () => {
    sink.push(0.5);
    return 0.5;
  };
}

/** 构造一条已持久化的轨迹记录 */
function storedRecord(seq: number): DebugActionRecord {
  return {
    seq,
    actionType: 'ADVANCE_TIME',
    action: { type: 'ADVANCE_TIME', granularity: 'day' },
    gameDayBefore: seq,
    gameDayAfter: seq + 1,
    randomDraws: [],
    generatedIds: [],
    beforeStateHash: `before-${seq}`,
    afterStateHash: `after-${seq}`,
    recordedAt: 0,
  };
}

/** 测试用元数据 */
function testMeta(overrides: Partial<DebugMetadata>): DebugMetadata {
  return {
    appVersion: '0.0.0-test',
    commitSha: null,
    saveSchemaVersion: 14,
    contentVersion: 'test',
    debugSchemaVersion: 1,
    saveId: '',
    characterName: '旧档',
    traceCompleteness: 'complete',
    startedAtDay: 0,
    startedAtWallClock: 0,
    exportedAtDay: 0,
    exportedAtWallClock: 0,
    ...overrides,
  };
}

/** 构造已持久化轨迹（lastStateHash 由调用方按连续性场景提供） */
function storedTrace(
  traceKey: string,
  lastStateHash: string,
  records: DebugActionRecord[],
): StoredTraceMeta & { records: DebugActionRecord[] } {
  const initialState = structuredClone(unwrap(useGameStore().state)) as PlayerSave;
  initialState.character.saveId = traceKey;
  return {
    traceKey,
    initialState,
    lastStateHash,
    meta: testMeta({ saveId: traceKey, exportedAtDay: records.length }),
    records,
  };
}

beforeEach(() => {
  vi.mocked(loadStoredTrace).mockResolvedValue(null);
  vi.mocked(findTraceKeyByStateHash).mockResolvedValue(null);
});

afterEach(async () => {
  await clearDebugTrace();
  vi.clearAllMocks();
});

describe('debugTrace 经由 dispatch 的录制', () => {
  it('NEW_GAME 建立完整轨迹（complete，saveId 关联）', () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1', characterName: '张三' } });

    const status = traceStatus();
    expect(status?.active).toBe(true);
    expect(status?.completeness).toBe('complete');
    expect(status?.traceKey).toBe('save-1');
    expect(status?.saveId).toBe('save-1');
    expect(status?.characterName).toBe('张三');
    expect(status?.journalLength).toBe(0);
  });

  it('有效操作记录随机数消费与游戏日推进', () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const draws: number[] = [];
    const dayBefore = useGameStore().state.time.totalDaysPlayed;
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: recordingRng(draws) });

    const session = getDebugTraceSession();
    expect(session?.journal).toHaveLength(1);
    const record = session?.journal[0];
    expect(record?.seq).toBe(1);
    expect(record?.action).toEqual({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(record?.gameDayBefore).toBe(dayBefore);
    expect(record?.gameDayAfter).toBe(dayBefore + 1);
    expect(record?.randomDraws).toEqual(draws);
    expect(record?.beforeStateHash).not.toBe(record?.afterStateHash);
    expect(appendJournalRecord).toHaveBeenCalledTimes(1);
  });

  it('未产生状态变化的动作不记录', () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    dispatch({ type: 'START_ACTION', deptId: '不存在', actionId: '不存在', tierKey: 'primary' });
    expect(traceStatus()?.journalLength).toBe(0);
  });

  it('LOAD_SAVE 后以 partial 建立会话并继续记录', async () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const { state } = useGameStore();
    const save = structuredClone(unwrap(state)) as PlayerSave;
    save.character.saveId = 'save-2';
    dispatch({ type: 'LOAD_SAVE', save });

    await vi.waitFor(() => expect(traceStatus()?.completeness).toBe('partial'));
    expect(traceStatus()?.traceKey).toBe('save-2');

    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    expect(traceStatus()?.journalLength).toBe(1);
  });

  it('同一 saveId 的最新快照（末状态哈希一致）继承完整轨迹', async () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const { state } = useGameStore();
    const latest = structuredClone(unwrap(state)) as PlayerSave;
    vi.mocked(loadStoredTrace).mockImplementation(async (traceKey: string) =>
      traceKey === 'save-1'
        ? storedTrace('save-1', hashSave(latest), [storedRecord(1), storedRecord(2)])
        : null,
    );

    dispatch({ type: 'LOAD_SAVE', save: latest });

    await vi.waitFor(() => expect(traceStatus()?.journalLength).toBe(2));
    expect(traceStatus()?.completeness).toBe('complete');
    expect(traceStatus()?.traceKey).toBe('save-1');
    expect(traceStatus()?.startedAtDay).toBe(0);

    // 恢复后继续追加（seq 续接持久化日志），窗口记录以最终键落盘
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    expect(traceStatus()?.journalLength).toBe(3);
    const calls = vi.mocked(appendJournalRecord).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0]).toBe('save-1');
    expect((lastCall?.[1] as DebugActionRecord | undefined)?.seq).toBe(3);
  });

  it('同一 saveId 的旧快照不继承未来 journal，以分支键记录且导出可重放', async () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const { state } = useGameStore();
    // 轨迹已记录到「第 2 日」；随后载入更旧的第 0 日备份
    const newer = structuredClone(unwrap(state)) as PlayerSave;
    newer.time.totalDaysPlayed = 2;
    const older = structuredClone(unwrap(state)) as PlayerSave;
    older.time.totalDaysPlayed = 0;
    vi.mocked(loadStoredTrace).mockImplementation(async (traceKey: string) =>
      traceKey === 'save-1'
        ? storedTrace('save-1', hashSave(newer), [storedRecord(1), storedRecord(2)])
        : null,
    );
    vi.mocked(findTraceKeyByStateHash).mockResolvedValue(null);
    vi.mocked(persistTraceMeta).mockClear();

    dispatch({ type: 'LOAD_SAVE', save: older });

    // 不继承未来 journal，不覆盖原轨迹：换用全新分支键
    await vi.waitFor(() => expect(traceStatus()?.traceKey).toMatch(/^branch-/));
    expect(traceStatus()?.completeness).toBe('partial');
    expect(traceStatus()?.journalLength).toBe(0);
    expect(persistTraceMeta).not.toHaveBeenCalledWith(
      expect.objectContaining({ traceKey: 'save-1' }),
    );

    // 分支轨迹从旧快照起录，导出后重放必须全哈希通过
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    const bundle = buildDebugBundle();
    expect(bundle.metadata.traceCompleteness).toBe('partial');
    expect(bundle.journal).toHaveLength(1);
    expect(replayBundle(bundle).ok).toBe(true);
  });

  it('认领窗口内的记录仅入内存，认领落定后以最终键与 seq 落盘一次', async () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const { state } = useGameStore();
    const loaded = structuredClone(unwrap(state)) as PlayerSave;

    // 让认领挂起，制造「窗口期内产生新动作」的场景
    type StoredLoad = StoredTraceMeta & { records: DebugActionRecord[] };
    let resolveLoad: ((value: StoredLoad | null) => void) | undefined;
    vi.mocked(loadStoredTrace).mockImplementation(
      () =>
        new Promise<StoredLoad | null>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    // 只考察认领发起之后的持久化行为（NEW_GAME 的初始 meta 不计入）
    vi.mocked(appendJournalRecord).mockClear();
    vi.mocked(persistTraceMeta).mockClear();

    dispatch({ type: 'LOAD_SAVE', save: loaded });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });

    // 窗口期：只入内存，不写 IndexedDB
    expect(traceStatus()?.journalLength).toBe(1);
    expect(appendJournalRecord).not.toHaveBeenCalled();
    expect(persistTraceMeta).not.toHaveBeenCalled();

    if (!resolveLoad) throw new Error('认领流程未发起');
    resolveLoad(storedTrace('save-1', hashSave(loaded), [storedRecord(1)]));
    await vi.waitFor(() => expect(traceStatus()?.journalLength).toBe(2));
    expect(traceStatus()?.completeness).toBe('complete');

    // 恢复后的续接记录恰好落盘一次（最终键 + 最终 seq），无重复吸收
    expect(appendJournalRecord).toHaveBeenCalledTimes(1);
    const carried = vi.mocked(appendJournalRecord).mock.calls[0]?.[1] as
      DebugActionRecord | undefined;
    expect(vi.mocked(appendJournalRecord).mock.calls[0]?.[0]).toBe('save-1');
    expect(carried?.seq).toBe(2);
  });

  it('clearDebugTrace 同时清除内存与持久层', async () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    await clearDebugTrace();

    expect(traceStatus()).toBeNull();
    expect(clearTrace).toHaveBeenCalledWith('save-1');
  });
});
