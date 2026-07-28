/**
 * 政策 Reducer
 *
 * 处理政策生命周期相关动作：
 * - PROPOSE_POLICY / APPROVE_POLICY / ACTIVATE_POLICY
 * - SUSPEND_POLICY / RESUME_POLICY
 * - FAIL_POLICY / REPEAL_POLICY
 *
 * 采用事务模式：先在副本上规划全部效果和信号，成功后才一次提交。
 */

import type { PlayerSave } from '../../types/player';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { PolicyInstance, PolicyOriginContextSnapshot } from '../../domain/governance/state';
import type { EventDefinition } from '../../domain/events/definition';
import type { ConditionExpression } from '../../domain/conditions';
import { unwrap } from 'solid-js/store';
import { getConfigLoader } from '../../config/loader';
import { processCascadeSignalsInTransaction } from './event-reducer';
import { evaluateCondition } from '../../engine/events/condition-interpreter';
import { applyEffects } from '../../engine/events/effect-executor';
import {
  proposePolicy,
  approvePolicy,
  activatePolicy,
  suspendPolicy,
  resumePolicy,
  failPolicy,
  repealPolicy,
} from '../../engine/governance/policy-lifecycle';
import type { PolicyTransitionResult } from '../../engine/governance/policy-lifecycle';
import { createRuntimeIdFactory } from '../runtime-id';

/**
 * 从当前任职构建政策原始上下文快照。
 */
function buildOriginContext(draft: PlayerSave): PolicyOriginContextSnapshot {
  const career = draft.career;
  const appointment = career.appointment;
  const latestExperience =
    career.experiences.length > 0 ? career.experiences[career.experiences.length - 1]! : null;

  return {
    positionId: appointment.positionId,
    institutionId: appointment.institutionId,
    regionId: appointment.regionId,
    institutionLevel: appointment.institutionLevel,
    positionDomain: appointment.positionDomain,
    leadershipRank: appointment.leadershipRank,
    experienceId: latestExperience?.id ?? null,
  };
}

/**
 * 提交政策引擎结果到 draft，并处理事件编排。
 *
 * 事务模式：在副本上克隆状态、应用变更、编排信号，成功后才写回 draft。
 */
function commitPolicyTransition(
  draft: PlayerSave,
  result: PolicyTransitionResult,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
  policyIdx: number | null,
): { success: boolean; instance?: PolicyInstance } {
  if (!result.success) return { success: false };

  // 政策转换、效果和事件级联必须同进同退；级联的事务入口还会处理 blocker continuation。
  const transaction = structuredClone(unwrap(draft));

  // 应用效果
  if (result.effects.length > 0) {
    // 效果引用 signal 字段时必须有真实来源；该不变量一旦被新转换破坏，应在提交前失败。
    const contextSignal = result.emittedSignals[0];
    if (!contextSignal) {
      throw new Error('Policy transition emitted effects without a context signal');
    }
    const effectContext = buildEffectContext(transaction, currentDay, contextSignal);
    applyEffects(transaction, result.effects, effectContext);
  }

  // 更新政策实例
  if (policyIdx !== null && policyIdx >= 0 && policyIdx < transaction.governance.policies.length) {
    transaction.governance.policies[policyIdx] = result.instance;
  } else {
    transaction.governance.policies.push(result.instance);
  }

  // 复用事件 reducer 的统一 continuation 入口，避免 policy reducer 重复实现级联队列。
  if (result.emittedSignals.length > 0) {
    processCascadeSignalsInTransaction(
      transaction,
      result.emittedSignals,
      currentDay,
      rng,
      idFactory,
      definitions,
    );
  }

  Object.assign(draft, transaction);
  return { success: true, instance: result.instance };
}

/**
 * 构建效果执行上下文。
 */
function buildEffectContext(_draft: PlayerSave, currentDay: number, signal: DomainSignalSnapshot) {
  const loader = getConfigLoader();
  const institutions = loader.getAllInstitutions();
  return {
    signal,
    currentDay,
    attributeBounds: loader.getGameConfig().attributeBounds,
    knownInstitutionIds: new Set(institutions.map((i) => i.id)),
    knownRegionIds: new Set(institutions.map((i) => i.regionId)),
  };
}

// ===== Reducer 入口 =====

/** PROPOSE_POLICY 载荷 */
export interface ProposePolicyReducerPayload {
  policyId: string;
  regionId?: string;
  institutionId?: string;
  _idFactory?: () => string;
}

/** 提议政策 reducer */
export function reduceProposePolicy(
  draft: PlayerSave,
  payload: ProposePolicyReducerPayload,
  currentDay: number,
): PolicyInstance | null {
  const loader = getConfigLoader();
  const definition = loader.getPolicyDefinition(payload.policyId);
  if (!definition) return null;

  const idFactory = payload._idFactory ?? createRuntimeIdFactory('policy');

  const originContext = buildOriginContext(draft);

  // 覆盖后的归属必须始终可在配置中定位，且机构与地区不能跨域组合。
  const institutionId = payload.institutionId ?? originContext.institutionId;
  const institution = loader.getInstitutionById(institutionId);
  if (!institution) return null;
  const regionId = payload.regionId ?? institution.regionId;
  const knownRegionIds = new Set(loader.getAllInstitutions().map((item) => item.regionId));
  if (!knownRegionIds.has(regionId) || institution.regionId !== regionId) return null;
  originContext.institutionId = institution.id;
  originContext.regionId = regionId;

  const result = proposePolicy({
    definition,
    originContext,
    currentDay,
    idFactory,
    existingPolicies: draft.governance.policies,
    evaluateCondition: (condition) => {
      // Use a dummy signal for condition evaluation during proposal
      const dummySignal: DomainSignalSnapshot = {
        signalId: 'dummy',
        signalType: 'policy.approved',
        occurredAtDay: currentDay,
        data: {
          policyInstanceId: 'dummy',
          policyId: payload.policyId,
          regionId: originContext.regionId,
          institutionId: originContext.institutionId,
          originPositionId: originContext.positionId,
        },
      };
      return evaluateCondition(condition as ConditionExpression, {
        signal: dummySignal,
        state: draft as Readonly<PlayerSave>,
        currentDay,
        daysPerYear: 360,
      });
    },
  });

  if (!result.success) return null;

  const definitions = loader.getAllEventDefinitions();
  const rng = () => Math.random();
  const committed = commitPolicyTransition(
    draft,
    result,
    currentDay,
    rng,
    idFactory,
    definitions,
    null,
  );

  return committed.instance ?? null;
}

/** APPROVE_POLICY 等共用载荷 */
export interface PolicyInstancePayload {
  policyInstanceId: string;
  _rng?: () => number;
  _idFactory?: () => string;
}

/** 批准政策 reducer */
export function reduceApprovePolicy(
  draft: PlayerSave,
  payload: PolicyInstancePayload,
  currentDay: number,
): PolicyInstance | null {
  const idx = draft.governance.policies.findIndex((p) => p.instanceId === payload.policyInstanceId);
  if (idx === -1) return null;

  const loader = getConfigLoader();
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('policy');
  const rng = payload._rng ?? (() => Math.random());

  const instance = draft.governance.policies[idx]!;

  const result = approvePolicy({
    instance,
    currentDay,
    idFactory,
  });

  if (!result.success) return null;

  const definitions = loader.getAllEventDefinitions();
  const committed = commitPolicyTransition(
    draft,
    result,
    currentDay,
    rng,
    idFactory,
    definitions,
    idx,
  );

  return committed.instance ?? null;
}

/** 激活政策 reducer */
export function reduceActivatePolicy(
  draft: PlayerSave,
  payload: PolicyInstancePayload,
  currentDay: number,
): PolicyInstance | null {
  const idx = draft.governance.policies.findIndex((p) => p.instanceId === payload.policyInstanceId);
  if (idx === -1) return null;

  const loader = getConfigLoader();
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('policy');
  const rng = payload._rng ?? (() => Math.random());

  const instance = draft.governance.policies[idx]!;

  const result = activatePolicy({
    instance,
    currentDay,
    idFactory,
  });

  if (!result.success) return null;

  const definitions = loader.getAllEventDefinitions();
  const committed = commitPolicyTransition(
    draft,
    result,
    currentDay,
    rng,
    idFactory,
    definitions,
    idx,
  );

  return committed.instance ?? null;
}

/** 暂停政策 reducer */
export function reduceSuspendPolicy(
  draft: PlayerSave,
  payload: PolicyInstancePayload,
  currentDay: number,
): PolicyInstance | null {
  const idx = draft.governance.policies.findIndex((p) => p.instanceId === payload.policyInstanceId);
  if (idx === -1) return null;

  const loader = getConfigLoader();
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('policy');
  const rng = payload._rng ?? (() => Math.random());

  const instance = draft.governance.policies[idx]!;

  const result = suspendPolicy({
    instance,
    currentDay,
    idFactory,
  });

  if (!result.success) return null;

  const definitions = loader.getAllEventDefinitions();
  const committed = commitPolicyTransition(
    draft,
    result,
    currentDay,
    rng,
    idFactory,
    definitions,
    idx,
  );

  return committed.instance ?? null;
}

/** 恢复政策 reducer */
export function reduceResumePolicy(
  draft: PlayerSave,
  payload: PolicyInstancePayload,
  currentDay: number,
): PolicyInstance | null {
  const idx = draft.governance.policies.findIndex((p) => p.instanceId === payload.policyInstanceId);
  if (idx === -1) return null;

  const loader = getConfigLoader();
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('policy');
  const rng = payload._rng ?? (() => Math.random());

  const instance = draft.governance.policies[idx]!;

  const result = resumePolicy({
    instance,
    currentDay,
    idFactory,
  });

  if (!result.success) return null;

  const definitions = loader.getAllEventDefinitions();
  const committed = commitPolicyTransition(
    draft,
    result,
    currentDay,
    rng,
    idFactory,
    definitions,
    idx,
  );

  return committed.instance ?? null;
}

/** 失败政策 reducer */
export function reduceFailPolicy(
  draft: PlayerSave,
  payload: PolicyInstancePayload,
  currentDay: number,
): PolicyInstance | null {
  const idx = draft.governance.policies.findIndex((p) => p.instanceId === payload.policyInstanceId);
  if (idx === -1) return null;

  const loader = getConfigLoader();
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('policy');
  const rng = payload._rng ?? (() => Math.random());

  const instance = draft.governance.policies[idx]!;

  const result = failPolicy({
    instance,
    currentDay,
    idFactory,
  });

  if (!result.success) return null;

  const definitions = loader.getAllEventDefinitions();
  const committed = commitPolicyTransition(
    draft,
    result,
    currentDay,
    rng,
    idFactory,
    definitions,
    idx,
  );

  return committed.instance ?? null;
}

/** 废止政策 reducer */
export function reduceRepealPolicy(
  draft: PlayerSave,
  payload: PolicyInstancePayload,
  currentDay: number,
): PolicyInstance | null {
  const idx = draft.governance.policies.findIndex((p) => p.instanceId === payload.policyInstanceId);
  if (idx === -1) return null;

  const loader = getConfigLoader();
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('policy');
  const rng = payload._rng ?? (() => Math.random());

  const instance = draft.governance.policies[idx]!;

  const result = repealPolicy({
    instance,
    currentDay,
    idFactory,
  });

  if (!result.success) return null;

  const definitions = loader.getAllEventDefinitions();
  const committed = commitPolicyTransition(
    draft,
    result,
    currentDay,
    rng,
    idFactory,
    definitions,
    idx,
  );

  return committed.instance ?? null;
}
