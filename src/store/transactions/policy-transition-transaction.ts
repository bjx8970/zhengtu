/**
 * 政策转换的统一 Store 事务提交器。
 *
 * 显式政策 Action 与自动时间轴共用这里的效果、指标信号和事件级联语义。
 */

import { unwrap } from 'solid-js/store';
import type { EventDefinition } from '../../domain/events/definition';
import type { PolicyInstance } from '../../domain/governance/state';
import { applyEffects } from '../../engine/events/effect-executor';
import { deriveMetricSignalsFromEffects } from '../../engine/events/metric-signal-bridge';
import type { PolicyTransitionResult } from '../../engine/governance/policy-lifecycle';
import type { PlayerSave } from '../../types/player';
import { getConfigLoader } from '../../config/loader';
import { processCascadeSignalsInTransaction } from '../reducers/event-reducer';

/**
 * 在调用方持有的事务副本中提交单次政策转换。
 *
 * @param draft 可变事务状态
 * @param result 政策生命周期引擎结果
 * @param policyIndex 既有实例索引；新提议传 null
 * @param currentDay 当前绝对日
 * @param idFactory 事务共享 ID 工厂
 * @returns 已提交实例、生命周期/指标信号和效果记录
 */
export function commitPolicyTransitionInTransaction(
  draft: PlayerSave,
  result: PolicyTransitionResult,
  policyIndex: number | null,
  currentDay: number,
  idFactory: () => string,
) {
  if (!result.success) {
    return { success: false, emittedSignals: [], appliedEffects: [] };
  }

  if (policyIndex === null) {
    if (
      draft.governance.policies.some((policy) => policy.instanceId === result.instance.instanceId)
    ) {
      throw new Error(`Policy instance "${result.instance.instanceId}" already exists`);
    }
    draft.governance.policies.push(result.instance);
  } else {
    if (
      !Number.isInteger(policyIndex) ||
      policyIndex < 0 ||
      policyIndex >= draft.governance.policies.length
    ) {
      throw new Error(`Policy index "${policyIndex}" is invalid`);
    }
    const existing = draft.governance.policies[policyIndex];
    if (!existing || existing.instanceId !== result.instance.instanceId) {
      throw new Error(
        `Policy index "${policyIndex}" does not match instance "${result.instance.instanceId}"`,
      );
    }
    draft.governance.policies[policyIndex] = result.instance;
  }

  let appliedEffects: ReturnType<typeof applyEffects>['applied'] = [];
  if (result.effects.length > 0) {
    const contextSignal = result.emittedSignals[0];
    if (!contextSignal) {
      throw new Error('Policy transition emitted effects without a context signal');
    }
    const loader = getConfigLoader();
    const institutions = loader.getAllInstitutions();
    appliedEffects = applyEffects(draft, result.effects, {
      signal: contextSignal,
      currentDay,
      attributeBounds: loader.getGameConfig().attributeBounds,
      knownInstitutionIds: new Set(institutions.map((item) => item.id)),
      knownRegionIds: new Set(institutions.map((item) => item.regionId)),
    }).applied;
  }

  const metricSignals = deriveMetricSignalsFromEffects(
    appliedEffects,
    { currentDay, policies: draft.governance.policies },
    idFactory,
  );
  return {
    success: true,
    instance: result.instance,
    emittedSignals: [...result.emittedSignals, ...metricSignals],
    appliedEffects,
  };
}

/**
 * 原子提交单次政策转换并处理其事件级联。
 *
 * @param draft Solid Store 草稿
 * @param result 政策生命周期引擎结果
 * @param policyIndex 既有实例索引；新提议传 null
 * @param currentDay 当前绝对日
 * @param rng 随机数生成器
 * @param idFactory 事务共享 ID 工厂
 * @param definitions 事件定义
 * @returns 成功提交的政策实例或 undefined
 */
export function commitPolicyTransition(
  draft: PlayerSave,
  result: PolicyTransitionResult,
  policyIndex: number | null,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): PolicyInstance | undefined {
  const transaction = structuredClone(unwrap(draft));
  const committed = commitPolicyTransitionInTransaction(
    transaction,
    result,
    policyIndex,
    currentDay,
    idFactory,
  );
  if (!committed.success) return undefined;
  processCascadeSignalsInTransaction(
    transaction,
    committed.emittedSignals,
    currentDay,
    rng,
    idFactory,
    definitions,
  );
  Object.assign(draft, transaction);
  return committed.instance;
}
