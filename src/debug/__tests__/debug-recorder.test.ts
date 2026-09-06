/**
 * Debug Trace 录制器测试（IndexedDB 以 mock 替代，聚焦会话逻辑）。
 *
 * 通过模块级 dispatch 驱动真实 reducer，验证：
 * NEW_GAME 完整轨迹、有效操作记录、无效操作丢弃、LOAD_SAVE 认领与合并、清除。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { unwrap } from 'solid-js/store';

vi.mock('../debug-storage', () => ({
  LEGACY_TRACE_PREFIX: 'legacy',
  persistTraceMeta: vi.fn(async () => undefined),
  appendJournalRecord: vi.fn(async () => undefined),
  loadStoredTrace: vi.fn(async () => null),
  findTraceKeyByStateHash: vi.fn(async () => null),
  clearTrace: vi.fn(async () => undefined),
}));

import { dispatch, useGameStore } from '../../store/game-store';
import { clearDebugTrace, getDebugTraceSession, getTraceStatusSignal } from '../debug-recorder';
import {
  appendJournalRecord,
  clearTrace,
  findTraceKeyByStateHash,
  loadStoredTrace,
} from '../debug-storage';
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
function storedRecord(seq: number): import('../debug-types').DebugActionRecord {
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

  it('LOAD_SAVE 命中已持久化轨迹时继承完整性与日志', async () => {
    const storedInitialState = structuredClone(unwrap(useGameStore().state)) as PlayerSave;
    storedInitialState.character.saveId = 'save-1';
    vi.mocked(loadStoredTrace).mockResolvedValue({
      traceKey: 'save-1',
      initialState: storedInitialState,
      lastStateHash: 'stored-hash',
      meta: {
        appVersion: '0.0.0-test',
        commitSha: null,
        saveSchemaVersion: 14,
        contentVersion: 'test',
        debugSchemaVersion: 1,
        saveId: 'save-1',
        characterName: '旧档',
        traceCompleteness: 'complete',
        startedAtDay: 0,
        startedAtWallClock: 0,
        exportedAtDay: 2,
        exportedAtWallClock: 0,
      },
      records: [storedRecord(1), storedRecord(2)],
    });

    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const { state } = useGameStore();
    dispatch({ type: 'LOAD_SAVE', save: structuredClone(unwrap(state)) as PlayerSave });

    await vi.waitFor(() => expect(traceStatus()?.journalLength).toBe(2));
    expect(traceStatus()?.completeness).toBe('complete');
    expect(traceStatus()?.startedAtDay).toBe(0);

    // 恢复后继续追加（seq 续接持久化日志）
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    expect(traceStatus()?.journalLength).toBe(3);
  });

  it('clearDebugTrace 同时清除内存与持久层', async () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    await clearDebugTrace();

    expect(traceStatus()).toBeNull();
    expect(clearTrace).toHaveBeenCalledWith('save-1');
  });
});
