/**
 * Debug Replay 往返测试。
 *
 * 核心保证：录制（initialState + journal）在新会话中重放必须逐步哈希一致；
 * 任何录制内容被篡改都应定位到首个分歧的操作序号。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../debug-storage', () => ({
  LEGACY_TRACE_PREFIX: 'legacy',
  persistTraceMeta: vi.fn(async () => undefined),
  appendJournalRecord: vi.fn(async () => undefined),
  loadStoredTrace: vi.fn(async () => null),
  findTraceKeyByStateHash: vi.fn(async () => null),
  clearTrace: vi.fn(async () => undefined),
}));

import { createInitialState, dispatch } from '../../store/game-store';
import { buildDebugBundle } from '../debug-exporter';
import { clearDebugTrace } from '../debug-recorder';
import { replayBundle } from '../debug-replay';
import { hashSave } from '../state-hash';
import type { DebugActionRecord, DebugBundle, DebugMetadata } from '../debug-types';
import type { PlayerSave } from '../../types/player';

/** 录制一段真实会话：建档 + 一次月度推进 */
function recordSession(): DebugBundle {
  dispatch({ type: 'NEW_GAME', data: { saveId: 'replay-save', characterName: '重放' } });
  dispatch({
    type: 'ADVANCE_TIME',
    granularity: 'month',
    _rng: () => 0.5,
  });
  return buildDebugBundle();
}

afterEach(async () => {
  await clearDebugTrace();
  vi.clearAllMocks();
});

describe('replayBundle 往返', () => {
  it('真实会话录制后重放全程一致', () => {
    const bundle = recordSession();
    expect(bundle.journal.length).toBe(1);

    const result = replayBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.firstDivergence).toBeNull();
    expect(result.replayedCount).toBe(1);
    expect(result.replayMatchesExport).toBe(true);
    expect(result.finalStateHash).toBe(bundle.integrity.finalStateHash);
  });

  it('月度推进确实消费运行时 ID（录制非空序列）', () => {
    const bundle = recordSession();
    const record = bundle.journal[0];
    expect(record?.generatedIds.length).toBeGreaterThan(0);
  });

  it('篡改录制 ID 值可在对应 seq 定位哈希分歧', () => {
    const bundle = recordSession();
    const tampered = structuredClone(bundle);
    const first = tampered.journal[0];
    if (!first) throw new Error('journal 为空');
    expect(first.generatedIds.length).toBeGreaterThan(0);
    // 数量不变、仅改值：消费顺序一致，但落入状态的 ID 必然不同
    first.generatedIds = first.generatedIds.map((_, index) => `tampered-${index}`);

    const result = replayBundle(tampered);
    expect(result.ok).toBe(false);
    expect(result.firstDivergence?.seq).toBe(first.seq);
    expect(result.firstDivergence?.reason).toBe('after_hash_mismatch');
  });

  it('录制 ID 多于实际消费时判定 under-consumed', () => {
    const bundle = recordSession();
    const tampered = structuredClone(bundle);
    const first = tampered.journal[0];
    if (!first) throw new Error('journal 为空');
    first.generatedIds = [...first.generatedIds, 'extra-1', 'extra-2'];

    const result = replayBundle(tampered);
    expect(result.ok).toBe(false);
    expect(result.firstDivergence?.reason).toBe('id_under_consumed');
  });

  it('录制 ID 少于实际消费时报 replay_threw', () => {
    const bundle = recordSession();
    const tampered = structuredClone(bundle);
    const first = tampered.journal[0];
    if (!first) throw new Error('journal 为空');
    first.generatedIds = [];

    const result = replayBundle(tampered);
    expect(result.ok).toBe(false);
    expect(result.firstDivergence?.reason).toBe('replay_threw');
  });

  it('录制随机数多于实际消费时判定 rng under-consumed', () => {
    const bundle = recordSession();
    const tampered = structuredClone(bundle);
    const first = tampered.journal[0];
    if (!first) throw new Error('journal 为空');
    first.randomDraws = [...first.randomDraws, 0.3, 0.4];

    const result = replayBundle(tampered);
    expect(result.ok).toBe(false);
    expect(result.firstDivergence?.reason).toBe('rng_under_consumed');
  });

  it('动作未产生状态变化时判定 not_changed', () => {
    const initialState = createInitialState();
    const hash = hashSave(initialState);
    const record: DebugActionRecord = {
      seq: 1,
      actionType: 'START_ACTION',
      action: { type: 'START_ACTION', deptId: '不存在', actionId: '不存在', tierKey: 'primary' },
      gameDayBefore: 0,
      gameDayAfter: 0,
      randomDraws: [],
      generatedIds: [],
      beforeStateHash: hash,
      afterStateHash: hash,
      recordedAt: 0,
    };
    const metadata: DebugMetadata = {
      appVersion: '0.0.0-test',
      commitSha: null,
      saveSchemaVersion: 14,
      contentVersion: 'test',
      debugSchemaVersion: 1,
      saveId: 'x',
      characterName: 'x',
      traceCompleteness: 'complete',
      startedAtDay: 0,
      startedAtWallClock: 0,
      exportedAtDay: 0,
      exportedAtWallClock: 0,
    };
    const bundle: DebugBundle = {
      debugSchemaVersion: 1,
      metadata,
      initialState,
      currentState: structuredClone(initialState),
      journal: [record],
      configSnapshot: { contentVersion: 'test' } as DebugBundle['configSnapshot'],
      integrity: { journalLength: 1, finalStateHash: hash },
    };

    const result = replayBundle(bundle);
    expect(result.ok).toBe(false);
    expect(result.firstDivergence?.reason).toBe('not_changed');
  });

  it('重放不修改 Bundle 中的初始状态', () => {
    const bundle = recordSession();
    const frozen = structuredClone(bundle.initialState) as PlayerSave;
    replayBundle(bundle);
    expect(hashSave(bundle.initialState)).toBe(hashSave(frozen));
  });
});
