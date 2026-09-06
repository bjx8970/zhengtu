/**
 * Debug Trace 录制器测试（IndexedDB 以迷你 fake store 替代，聚焦会话逻辑）。
 *
 * 通过模块级 dispatch 驱动真实 reducer，验证：
 * NEW_GAME 完整轨迹、有效操作记录、无效操作丢弃、LOAD_SAVE 连续性认领
 * （同 saveId 最新快照续接；旧快照分支化不继承未来 journal）、
 * 三种认领落定路径都补写窗口期记录、刷新后再次载入可续接且重放通过、清除。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { unwrap } from 'solid-js/store';

vi.mock('../debug-storage', () => ({
  BRANCH_TRACE_PREFIX: 'branch',
  LEGACY_TRACE_PREFIX: 'legacy',
  persistTraceMeta: vi.fn(async () => undefined),
  commitTraceBatch: vi.fn(async () => undefined),
  loadStoredTrace: vi.fn(async () => null),
  findTraceKeyByStateHash: vi.fn(async () => null),
  clearTrace: vi.fn(async () => undefined),
}));

import { dispatch, useGameStore } from '../../store/game-store';
import { buildDebugBundle } from '../debug-exporter';
import { replayBundle } from '../debug-replay';
import { clearDebugTrace, getDebugTraceSession, getTraceStatusSignal } from '../debug-recorder';
import {
  clearTrace,
  commitTraceBatch,
  findTraceKeyByStateHash,
  loadStoredTrace,
  persistTraceMeta,
  type StoredTraceMeta,
} from '../debug-storage';
import { hashSave } from '../state-hash';
import type { DebugActionRecord, DebugMetadata } from '../debug-types';
import type { PlayerSave } from '../../types/player';

const traceStatus = getTraceStatusSignal();

/** fake store 中的一条完整轨迹 */
type FakeTrace = StoredTraceMeta & { records: DebugActionRecord[] };

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

/** 构造已持久化轨迹（initialState 缺省取当前活动状态快照） */
function storedTrace(
  traceKey: string,
  lastStateHash: string,
  records: DebugActionRecord[],
  initialState?: PlayerSave,
): FakeTrace {
  return {
    traceKey,
    initialState: initialState ?? (structuredClone(unwrap(useGameStore().state)) as PlayerSave),
    lastStateHash,
    meta: testMeta({ saveId: traceKey, exportedAtDay: records.length }),
    records,
  };
}

/**
 * 安装迷你 fake IndexedDB：commitTraceBatch/persistTraceMeta 写入、
 * loadStoredTrace/findTraceKeyByStateHash 读取、clearTrace 删除，
 * 使「刷新后再次 LOAD_SAVE」的生命周期能被端到端模拟。
 */
function installFakeTraceStore(): Map<string, FakeTrace> {
  const store = new Map<string, FakeTrace>();
  vi.mocked(loadStoredTrace).mockImplementation(
    async (traceKey: string) => store.get(traceKey) ?? null,
  );
  vi.mocked(findTraceKeyByStateHash).mockImplementation(async (stateHash: string) => {
    for (const trace of store.values()) {
      if (trace.lastStateHash === stateHash) return trace.traceKey;
    }
    return null;
  });
  vi.mocked(commitTraceBatch).mockImplementation(async (meta, records) => {
    const existing = store.get(meta.traceKey);
    store.set(meta.traceKey, {
      ...meta,
      records: [...(existing?.records ?? []), ...records],
    });
  });
  vi.mocked(persistTraceMeta).mockImplementation(async (meta) => {
    const existing = store.get(meta.traceKey);
    store.set(meta.traceKey, { ...meta, records: existing?.records ?? [] });
  });
  vi.mocked(clearTrace).mockImplementation(async (traceKey: string) => {
    store.delete(traceKey);
  });
  return store;
}

/** 用一次性门控挂起下一次 loadStoredTrace（模拟认领窗口） */
function gateNextLoad(store: Map<string, FakeTrace>): () => void {
  let resolveGate: ((value: FakeTrace | null) => void) | undefined;
  const gate = new Promise<FakeTrace | null>((resolve) => {
    resolveGate = resolve;
  });
  vi.mocked(loadStoredTrace).mockImplementationOnce(() => gate);
  return () => {
    if (!resolveGate) throw new Error('gate 未初始化');
    resolveGate(store.get('save-1') ?? null);
  };
}

/** 当前活动状态快照 */
function currentState(): PlayerSave {
  return structuredClone(unwrap(useGameStore().state)) as PlayerSave;
}

beforeEach(() => {
  installFakeTraceStore();
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

  it('有效操作原子落盘（journal + meta 同批次，尾哈希一致）', () => {
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

    expect(commitTraceBatch).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(commitTraceBatch).mock.calls[0];
    expect(firstCall?.[0].traceKey).toBe('save-1');
    expect(firstCall?.[0].lastStateHash).toBe(record?.afterStateHash);
    expect(firstCall?.[1]).toHaveLength(1);
  });

  it('未产生状态变化的动作不记录', () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    dispatch({ type: 'START_ACTION', deptId: '不存在', actionId: '不存在', tierKey: 'primary' });
    expect(traceStatus()?.journalLength).toBe(0);
  });

  it('同一 saveId 的最新快照（末状态哈希一致）继承完整轨迹', async () => {
    const store = installFakeTraceStore();
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const latest = currentState();
    store.set(
      'save-1',
      storedTrace(
        'save-1',
        hashSave(latest),
        [storedRecord(1), storedRecord(2)],
        structuredClone(latest),
      ),
    );

    dispatch({ type: 'LOAD_SAVE', save: structuredClone(latest) });

    await vi.waitFor(() => expect(traceStatus()?.journalLength).toBe(2));
    expect(traceStatus()?.completeness).toBe('complete');
    expect(traceStatus()?.traceKey).toBe('save-1');
    expect(traceStatus()?.startedAtDay).toBe(0);

    // 恢复后继续追加（seq 续接持久化日志），窗口记录以最终键原子落盘
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    expect(traceStatus()?.journalLength).toBe(3);
    const calls = vi.mocked(commitTraceBatch).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0].traceKey).toBe('save-1');
    expect(lastCall?.[1][0]?.seq).toBe(3);
    expect(lastCall?.[0].lastStateHash).toBe(lastCall?.[1][0]?.afterStateHash);
  });

  it('同一 saveId 的旧快照不继承未来 journal，以分支键记录且导出可重放', async () => {
    const store = installFakeTraceStore();
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    // 轨迹已记录到「第 2 日」；随后载入更旧的第 0 日备份
    const newer = currentState();
    newer.time.totalDaysPlayed = 2;
    const older = currentState();
    older.time.totalDaysPlayed = 0;
    store.set('save-1', storedTrace('save-1', hashSave(newer), [storedRecord(1), storedRecord(2)]));

    dispatch({ type: 'LOAD_SAVE', save: structuredClone(older) });

    // 不继承未来 journal，不覆盖原轨迹：换用全新分支键
    await vi.waitFor(() => expect(traceStatus()?.traceKey).toMatch(/^branch-/));
    expect(traceStatus()?.completeness).toBe('partial');
    expect(traceStatus()?.journalLength).toBe(0);
    const traceKeysWritten = vi.mocked(commitTraceBatch).mock.calls.map((c) => c[0].traceKey);
    expect(traceKeysWritten).not.toContain('save-1');

    // 分支轨迹从旧快照起录，导出后重放必须全哈希通过
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    const bundle = buildDebugBundle();
    expect(bundle.metadata.traceCompleteness).toBe('partial');
    expect(bundle.journal).toHaveLength(1);
    expect(replayBundle(bundle).ok).toBe(true);
  });

  it('首次轨迹认领挂起期间的窗口记录落盘，刷新后再次载入可续接并重放通过', async () => {
    const store = installFakeTraceStore();
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const loaded = currentState();

    const release = gateNextLoad(store);
    dispatch({ type: 'LOAD_SAVE', save: structuredClone(loaded) });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });

    // 窗口期：只入内存，不写 IndexedDB
    expect(traceStatus()?.journalLength).toBe(1);
    expect(commitTraceBatch).not.toHaveBeenCalled();

    release();
    // 落定（无历史路径）：保留候选键，窗口记录补写落盘
    await vi.waitFor(() => expect(commitTraceBatch).toHaveBeenCalledTimes(1));
    expect(traceStatus()?.traceKey).toBe('save-1');
    const flushCall = vi.mocked(commitTraceBatch).mock.calls[0];
    expect(flushCall?.[0].traceKey).toBe('save-1');
    expect(flushCall?.[0].lastStateHash).toBe(flushCall?.[1][0]?.afterStateHash);
    expect(store.get('save-1')?.records).toHaveLength(1);

    // 模拟刷新：重新载入最新（已推进）状态，末状态哈希命中 → 继承续接
    dispatch({ type: 'LOAD_SAVE', save: currentState() });
    await vi.waitFor(() => expect(traceStatus()?.journalLength).toBe(1));
    expect(traceStatus()?.traceKey).toBe('save-1');

    // 继续动作后导出，重放从 partial initialState 全哈希通过
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    const bundle = buildDebugBundle();
    expect(bundle.journal).toHaveLength(2);
    expect(replayBundle(bundle).ok).toBe(true);
  });

  it('不连续分支认领挂起期间的窗口记录落盘，再次载入经哈希匹配续接并重放通过', async () => {
    const store = installFakeTraceStore();
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    // 预置轨迹已到「第 2 日」，随后载入更旧的第 0 日备份
    const newer = currentState();
    newer.time.totalDaysPlayed = 2;
    const older = currentState();
    older.time.totalDaysPlayed = 0;
    store.set('save-1', storedTrace('save-1', hashSave(newer), [storedRecord(1), storedRecord(2)]));

    const release = gateNextLoad(store);
    dispatch({ type: 'LOAD_SAVE', save: structuredClone(older) });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });

    release();
    // 落定（不连续 → 分支）：窗口记录写入全新分支键，原 save-1 轨迹未被触碰
    await vi.waitFor(() => expect(traceStatus()?.traceKey).toMatch(/^branch-/));
    const branchKey = traceStatus()?.traceKey;
    expect(traceStatus()?.journalLength).toBe(1);
    expect(store.get('save-1')?.records).toHaveLength(2);
    const branchTrace = store.get(branchKey ?? '');
    expect(branchTrace?.records).toHaveLength(1);
    expect(branchTrace?.initialState.time.totalDaysPlayed).toBe(0);

    // 再次载入当前（窗口动作之后）状态：save-1 仍不连续，经末状态哈希命中分支 → 续接
    dispatch({ type: 'LOAD_SAVE', save: currentState() });
    await vi.waitFor(() => expect(traceStatus()?.journalLength).toBe(1));
    expect(traceStatus()?.traceKey).toBe(branchKey);
    expect(traceStatus()?.completeness).toBe('partial');

    // 继续动作后导出：initialState 为旧备份快照，重放全哈希通过
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
    const bundle = buildDebugBundle();
    expect(bundle.initialState.time.totalDaysPlayed).toBe(0);
    expect(bundle.journal).toHaveLength(2);
    expect(replayBundle(bundle).ok).toBe(true);
  });

  it('继承路径的 meta 尾哈希取窗口记录末条（而非载入起点）', async () => {
    const store = installFakeTraceStore();
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    const loaded = currentState();
    store.set(
      'save-1',
      storedTrace('save-1', hashSave(loaded), [storedRecord(1)], structuredClone(loaded)),
    );

    const release = gateNextLoad(store);
    dispatch({ type: 'LOAD_SAVE', save: structuredClone(loaded) });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });

    expect(commitTraceBatch).not.toHaveBeenCalled();
    release();

    await vi.waitFor(() => expect(traceStatus()?.journalLength).toBe(2));
    expect(traceStatus()?.completeness).toBe('complete');
    const inheritCall = vi.mocked(commitTraceBatch).mock.calls[0];
    expect(inheritCall?.[0].traceKey).toBe('save-1');
    const carried = inheritCall?.[1];
    expect(carried).toHaveLength(1);
    expect(carried?.[0]?.seq).toBe(2);
    // 尾哈希必须等于 carried 末条 afterStateHash：否则认领后立即刷新会误判不连续
    expect(inheritCall?.[0].lastStateHash).toBe(carried?.[0]?.afterStateHash);
    expect(inheritCall?.[0].lastStateHash).not.toBe(hashSave(loaded));
  });

  it('clearDebugTrace 同时清除内存与持久层', async () => {
    const store = installFakeTraceStore();
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1' } });
    await clearDebugTrace();

    expect(traceStatus()).toBeNull();
    expect(store.has('save-1')).toBe(false);
  });
});
