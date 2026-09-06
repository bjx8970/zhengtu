/**
 * Debug Bundle 导出器测试：结构完整性、序列化与文件名。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../debug-storage', () => ({
  LEGACY_TRACE_PREFIX: 'legacy',
  persistTraceMeta: vi.fn(async () => undefined),
  commitTraceBatch: vi.fn(async () => undefined),
  loadStoredTrace: vi.fn(async () => null),
  findTraceKeyByStateHash: vi.fn(async () => null),
  clearTrace: vi.fn(async () => undefined),
}));

import { dispatch, useGameStore } from '../../store/game-store';
import { buildDebugBundle, debugBundleFileName } from '../debug-exporter';
import { clearDebugTrace } from '../debug-recorder';
import { DEBUG_SCHEMA_VERSION, type DebugMetadata } from '../debug-types';
import { hashSave } from '../state-hash';

afterEach(async () => {
  await clearDebugTrace();
  vi.clearAllMocks();
});

describe('buildDebugBundle', () => {
  it('无活动轨迹时抛出', async () => {
    await clearDebugTrace();
    expect(() => buildDebugBundle()).toThrow('当前没有可导出的 Debug 轨迹');
  });

  it('Bundle 包含初始状态、当前状态、日志与完整性信息', () => {
    dispatch({ type: 'NEW_GAME', data: { saveId: 'save-1', characterName: '张三' } });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });

    const bundle = buildDebugBundle();
    expect(bundle.debugSchemaVersion).toBe(DEBUG_SCHEMA_VERSION);
    expect(bundle.journal.length).toBe(1);
    expect(bundle.initialState.character.saveId).toBe('save-1');
    expect(bundle.currentState.time.totalDaysPlayed).toBe(
      useGameStore().state.time.totalDaysPlayed,
    );
    expect(bundle.metadata.characterName).toBe('张三');
    expect(bundle.metadata.traceCompleteness).toBe('complete');
    expect(bundle.integrity.journalLength).toBe(1);
    expect(bundle.integrity.finalStateHash).toBe(bundle.journal[0]?.afterStateHash);

    // 导出为自包含纯数据，可 JSON 往返
    const roundTrip = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    expect(roundTrip.journal).toHaveLength(1);
    expect(hashSave(roundTrip.currentState)).toBe(hashSave(bundle.currentState));

    // 配置快照可用
    expect(bundle.configSnapshot.contentVersion).toBeTruthy();
    expect(Array.isArray(bundle.configSnapshot.positions)).toBe(true);
  });
});

describe('debugBundleFileName', () => {
  const base: DebugMetadata = {
    appVersion: '0.0.0',
    commitSha: null,
    saveSchemaVersion: 14,
    contentVersion: 'test',
    debugSchemaVersion: 1,
    saveId: 'abc-123',
    characterName: '张三',
    traceCompleteness: 'complete',
    startedAtDay: 0,
    startedAtWallClock: 0,
    exportedAtDay: 0,
    exportedAtWallClock: 0,
  };

  it('优先使用 saveId 并带日期后缀', () => {
    expect(debugBundleFileName(base)).toMatch(/^zhengtu-debug-abc-123-\d{8}\.json$/);
  });

  it('saveId 缺失时回退角色名并清理非法字符', () => {
    const name = debugBundleFileName({
      ...base,
      saveId: '',
      characterName: 'Zhang San/4',
    });
    expect(name).toMatch(/^zhengtu-debug-Zhang_San_4-\d{8}\.json$/);
  });
});
