/**
 * Debug Bundle 重放器
 *
 * 从 Bundle 的 initialState 出发，逐条重放操作日志：
 * - 随机数 / 运行时 ID 按录制顺序回放，超量消费立即抛错、欠量消费记为分歧；
 * - 每步比对 before/after 状态哈希，首个分歧即「首次产生状态分歧的操作序号」；
 * - 终态与 Bundle 的 currentState 快照比对，覆盖日志末尾到导出时刻的漂移。
 *
 * 重放在当前运行环境的配置上进行；若配置版本与录制环境不同，
 * 分歧本身即为诊断信息（metadata.contentVersion 标明了录制环境）。
 */

import type { GameAction } from '../types/game';
import type { PlayerSave } from '../types/player';
import { reduceGameState } from '../store/game-store';
import type { DebugBundle, ReplayDivergence, ReplayResult } from './debug-types';
import { hashSave } from './state-hash';

/**
 * 创建按录制顺序回放的随机数生成器。
 *
 * @param values 录制的随机数序列
 * @returns next 取值（超出序列立即抛错）与 remaining 剩余数
 */
function createReplayRng(values: number[]): { next: () => number; remaining: () => number } {
  let index = 0;
  return {
    next: () => {
      if (index >= values.length) {
        throw new Error(`重放随机数超量消费：录制序列共 ${values.length} 个`);
      }
      // index < values.length 已在上方保证，非空断言安全
      const value = values[index]!;
      index += 1;
      return value;
    },
    remaining: () => values.length - index,
  };
}

/**
 * 创建按录制顺序回放的运行时 ID 工厂。
 *
 * @param values 录制的 ID 序列
 * @returns next 取值（超出序列立即抛错）与 remaining 剩余数
 */
function createReplayIdFactory(values: string[]): { next: () => string; remaining: () => number } {
  let index = 0;
  return {
    next: () => {
      if (index >= values.length) {
        throw new Error(`重放运行时 ID 超量消费：录制序列共 ${values.length} 个`);
      }
      // index < values.length 已在上方保证，非空断言安全
      const value = values[index]!;
      index += 1;
      return value;
    },
    remaining: () => values.length - index,
  };
}

/**
 * 逐步重放 Bundle 并校验哈希一致性。
 *
 * @param bundle 待重放的 Debug Bundle
 * @returns 重放结果（首个分歧即定位问题操作）
 */
export function replayBundle(bundle: DebugBundle): ReplayResult {
  const current: PlayerSave = structuredClone(bundle.initialState);
  let replayedCount = 0;

  for (const record of bundle.journal) {
    const beforeHash = hashSave(current);
    if (beforeHash !== record.beforeStateHash) {
      return diverged(
        record.seq,
        'before_hash_mismatch',
        record.beforeStateHash,
        beforeHash,
        replayedCount,
        current,
      );
    }

    const rng = createReplayRng(record.randomDraws);
    const ids = createReplayIdFactory(record.generatedIds);
    // record.action 已剥离函数字段，此处仅回注录制顺序的 rng/ID 工厂
    const action = {
      ...record.action,
      _rng: rng.next,
      _idFactory: ids.next,
    } as unknown as GameAction;

    // 随机数/ID 超量消费或 reducer 本身抛错 → 记为分歧而非中断诊断
    let changed: boolean;
    try {
      changed = reduceGameState(current, action);
    } catch (error) {
      return diverged(
        record.seq,
        'replay_threw',
        `随机数 ≤ ${record.randomDraws.length} 且 ID ≤ ${record.generatedIds.length}`,
        error instanceof Error ? error.message : String(error),
        replayedCount,
        current,
      );
    }
    if (!changed) {
      return diverged(record.seq, 'not_changed', 'true', 'false', replayedCount, current);
    }
    if (rng.remaining() > 0) {
      return diverged(
        record.seq,
        'rng_under_consumed',
        '0',
        `${rng.remaining()}`,
        replayedCount,
        current,
      );
    }
    if (ids.remaining() > 0) {
      return diverged(
        record.seq,
        'id_under_consumed',
        '0',
        `${ids.remaining()}`,
        replayedCount,
        current,
      );
    }

    const afterHash = hashSave(current);
    if (afterHash !== record.afterStateHash) {
      return diverged(
        record.seq,
        'after_hash_mismatch',
        record.afterStateHash,
        afterHash,
        replayedCount,
        current,
      );
    }
    replayedCount += 1;
  }

  const finalStateHash = hashSave(current);
  const exportHash = hashSave(bundle.currentState);
  const matchesExport = finalStateHash === exportHash;
  return {
    ok: matchesExport,
    firstDivergence: matchesExport
      ? null
      : {
          seq: -1,
          reason: 'final_state_mismatch',
          expected: exportHash,
          actual: finalStateHash,
        },
    replayedCount,
    finalStateHash,
    replayMatchesExport: matchesExport,
  };
}

/**
 * 构建分歧结果。
 *
 * @param seq 记录序号
 * @param reason 分歧类别
 * @param expected 期望值
 * @param actual 实际值
 * @param replayedCount 已重放记录数
 * @param current 重放终态
 * @returns 标记失败的 ReplayResult
 */
function diverged(
  seq: number,
  reason: ReplayDivergence['reason'],
  expected: string,
  actual: string,
  replayedCount: number,
  current: PlayerSave,
): ReplayResult {
  return {
    ok: false,
    firstDivergence: { seq, reason, expected, actual },
    replayedCount,
    finalStateHash: hashSave(current),
    replayMatchesExport: false,
  };
}
