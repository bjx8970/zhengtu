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
import { getConfigLoader } from '../../config/loader';
import { processDomainSignal } from '../../engine/events/event-orchestrator';
import { applyEventOrchestrationPlan } from './event-reducer';
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

const MAX_CASCADE_DEPTH = 16;

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

  // 应用效果
  if (result.effects.length > 0) {
    const effectContext = buildEffectContext(draft, currentDay);
    applyEffects(draft, result.effects, effectContext);
  }

  // 更新政策实例
  if (policyIdx !== null && policyIdx >= 0 && policyIdx < draft.governance.policies.length) {
    draft.governance.policies[policyIdx] = result.instance;
  } else {
    draft.governance.policies.push(result.instance);
  }

  // 编排信号
  if (result.emittedSignals.length > 0) {
    processPolicySignals(draft, result.emittedSignals, currentDay, rng, idFactory, definitions);
  }

  return { success: true, instance: result.instance };
}

/**
 * 将政策信号送入事件编排器。
 */
function processPolicySignals(
  draft: PlayerSave,
  signals: DomainSignalSnapshot[],
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): void {
  const budget = { consumed: 0, limit: MAX_CASCADE_DEPTH };
  const queue: Array<{ kind: 'signal'; signal: DomainSignalSnapshot; cascadeDepth: number }> = [];

  for (const signal of signals) {
    if (draft.events.processedSignalIds.includes(signal.signalId)) continue;

    const orchestration = processDomainSignal({
      state: draft as Readonly<PlayerSave>,
      signal,
      currentDay,
      definitions,
      rng,
      idFactory,
      transactionInstances: [],
    });

    const { cascadeSignals } = applyEventOrchestrationPlan(
      draft,
      orchestration,
      currentDay,
      rng,
      idFactory,
      definitions,
      0,
      budget,
      queue,
    );

    const nextDepth = 1;
    queue.push(
      ...orchestration.emittedSignals.map((s) => ({
        kind: 'signal' as const,
        signal: s,
        cascadeDepth: nextDepth,
      })),
      ...cascadeSignals.map((s) => ({
        kind: 'signal' as const,
        signal: s,
        cascadeDepth: nextDepth,
      })),
    );
  }

  // 处理级联队列
  let iteration = 0;
  while (queue.length > 0 && iteration < 200) {
    iteration++;
    const item = queue.shift()!;
    if (draft.events.processedSignalIds.includes(item.signal.signalId)) continue;
    if (item.cascadeDepth >= MAX_CASCADE_DEPTH) continue;

    const orchestration = processDomainSignal({
      state: draft as Readonly<PlayerSave>,
      signal: item.signal,
      currentDay,
      definitions,
      rng,
      idFactory,
    });

    const { cascadeSignals } = applyEventOrchestrationPlan(
      draft,
      orchestration,
      currentDay,
      rng,
      idFactory,
      definitions,
      item.cascadeDepth + 1,
      budget,
      queue,
    );

    const nextDepth = item.cascadeDepth + 1;
    queue.push(
      ...orchestration.emittedSignals.map((s) => ({
        kind: 'signal' as const,
        signal: s,
        cascadeDepth: nextDepth,
      })),
      ...cascadeSignals.map((s) => ({
        kind: 'signal' as const,
        signal: s,
        cascadeDepth: nextDepth,
      })),
    );
  }
}

/**
 * 构建效果执行上下文。
 */
function buildEffectContext(_draft: PlayerSave, currentDay: number) {
  const loader = getConfigLoader();
  const institutions = loader.getAllInstitutions();
  return {
    signal: null as unknown as DomainSignalSnapshot,
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

  // 如果显式传入地区/机构，则覆盖
  if (payload.regionId) {
    const institution = loader.getInstitutionById(
      payload.institutionId ?? draft.career.appointment.institutionId,
    );
    if (!institution) return null;
    originContext.regionId = payload.regionId;
    originContext.institutionId = payload.institutionId ?? draft.career.appointment.institutionId;
  }

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

  // 批准效果来自快照的 approvalEffects 实际不存在在 snapshot 中，
  // 所以我们需要从原始定义获取批准效果
  const definition = loader.getPolicyDefinition(instance.policyId);
  const approvalEffects = definition?.approvalEffects ?? [];

  // 构建包含批准效果的扩展结果
  const extendedResult: PolicyTransitionResult = {
    ...result,
    effects: [...approvalEffects],
  };

  const definitions = loader.getAllEventDefinitions();
  const committed = commitPolicyTransition(
    draft,
    extendedResult,
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
