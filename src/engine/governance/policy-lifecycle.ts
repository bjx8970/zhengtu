/**
 * 政策生命周期引擎
 *
 * 纯函数实现政策从提议到废止的完整生命周期状态机。
 * 所有操作返回 PolicyTransitionResult 判别联合，不直接修改 Store。
 *
 * 状态转换规则（合法路径）：
 *   proposed → approved → implementing → suspended → implementing → completed
 *            ↘ repealed     ↘ failed      ↘ failed      ↘ failed
 *                            ↘ repealed    ↘ repealed    ↘ repealed
 *
 * 终态（不可恢复）：completed, failed, repealed
 */

import type {
  PolicyInstance,
  PolicyExecutableSnapshot,
  PolicyOriginContextSnapshot,
} from '../../domain/governance/state';
import type { DomainSignalSnapshot, PolicyStatus } from '../../domain/governance/types';
import type { PolicyDefinitionConfig } from '../../types/config';
import type { EffectDefinition } from '../../domain/conditions';
import { CURRENT_CONTENT_VERSION } from '../../types/save';

// ===== 结果类型 =====

/** 政策生命周期转换失败原因 */
export type PolicyTransitionFailure =
  | 'policy_not_found'
  | 'definition_not_found'
  | 'condition_failed'
  | 'invalid_transition'
  | 'already_terminal'
  | 'not_effective_yet'
  | 'phase_not_found'
  | 'effect_failed'
  | 'duplicate_active_policy'
  | 'unknown_region'
  | 'unknown_institution'
  | 'no_phases';

/** 政策生命周期转换结果（判别联合） */
export type PolicyTransitionResult =
  | {
      success: true;
      instance: PolicyInstance;
      effects: EffectDefinition[];
      emittedSignals: DomainSignalSnapshot[];
    }
  | {
      success: false;
      reason: PolicyTransitionFailure;
    };

// ===== 内部辅助 =====

/**
 * 合法状态转换表。
 *
 * 只有表中列出的 from → to 转换才是合法的。
 */
const VALID_TRANSITIONS: Record<PolicyStatus, readonly PolicyStatus[]> = {
  proposed: ['approved', 'repealed'],
  approved: ['implementing', 'failed', 'repealed'],
  implementing: ['suspended', 'completed', 'failed', 'repealed'],
  suspended: ['implementing', 'failed', 'repealed'],
  completed: [],
  failed: [],
  repealed: [],
};

/** 终态集合 */
const TERMINAL_STATUSES: ReadonlySet<PolicyStatus> = new Set(['completed', 'failed', 'repealed']);

/**
 * 检查状态转换是否合法。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否合法
 */
function isValidTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return (VALID_TRANSITIONS[from] as readonly string[]).includes(to);
}

/**
 * 创建领域信号快照。
 *
 * @param signalType 信号类型
 * @param data 信号载荷
 * @param currentDay 当前日
 * @param idFactory ID 工厂
 * @returns 信号快照
 */
function makeSignal<T extends DomainSignalSnapshot['signalType']>(
  signalType: T,
  data: Extract<DomainSignalSnapshot, { signalType: T }>['data'],
  currentDay: number,
  idFactory: () => string,
): DomainSignalSnapshot {
  return {
    signalId: idFactory(),
    signalType,
    occurredAtDay: currentDay,
    data,
  } as DomainSignalSnapshot;
}

/**
 * 创建政策可执行快照。
 *
 * @param definition 政策配置定义
 * @returns 冻结的快照
 */
export function createPolicySnapshot(definition: PolicyDefinitionConfig): PolicyExecutableSnapshot {
  return {
    policyId: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    tags: [...definition.tags],
    effectiveDelayDays: definition.effectiveDelayDays,
    phases: definition.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      description: phase.description,
      durationDays: phase.durationDays,
      entryEffects: phase.entryEffects.map((e) => structuredClone(e)),
      completionEffects: phase.completionEffects.map((e) => structuredClone(e)),
    })),
    contentVersion: CURRENT_CONTENT_VERSION,
  };
}

// ===== 生命周期函数 =====

/** proposePolicy 参数 */
export interface ProposePolicyParams {
  definition: PolicyDefinitionConfig;
  originContext: PolicyOriginContextSnapshot;
  currentDay: number;
  idFactory: () => string;
  /** 已存在的政策实例列表（用于重复检查） */
  existingPolicies: readonly PolicyInstance[];
  /** 可用性条件评估函数 */
  evaluateCondition: (condition: unknown) => boolean;
}

/**
 * 提议一项新政策。
 *
 * 检查可用性条件、重复政策，创建 proposed 状态的政策实例。
 *
 * @param params 提议参数
 * @returns 转换结果
 */
export function proposePolicy(params: ProposePolicyParams): PolicyTransitionResult {
  const { definition, originContext, currentDay, idFactory, existingPolicies, evaluateCondition } =
    params;

  // 检查重复活动政策（同一 policyId + regionId + institutionId）
  const duplicate = existingPolicies.find(
    (p) =>
      p.policyId === definition.id &&
      p.originContext.regionId === originContext.regionId &&
      p.originContext.institutionId === originContext.institutionId &&
      !TERMINAL_STATUSES.has(p.status),
  );
  if (duplicate) {
    return { success: false, reason: 'duplicate_active_policy' };
  }

  // 检查可用性条件
  if (definition.availabilityCondition) {
    try {
      if (!evaluateCondition(definition.availabilityCondition)) {
        return { success: false, reason: 'condition_failed' };
      }
    } catch {
      return { success: false, reason: 'condition_failed' };
    }
  }

  const instance: PolicyInstance = {
    instanceId: idFactory(),
    policyId: definition.id,
    status: 'proposed',
    proposedAtDay: currentDay,
    approvedAtDay: null,
    effectiveAtDay: null,
    currentPhaseId: null,
    phaseEnteredAtDay: null,
    nextMilestoneAtDay: null,
    suspendedAtDay: null,
    accumulatedSuspendedDays: 0,
    completedAtDay: null,
    failedAtDay: null,
    repealedAtDay: null,
    originContext,
    snapshot: createPolicySnapshot(definition),
    metrics: {},
  };

  return {
    success: true,
    instance,
    effects: [],
    emittedSignals: [],
  };
}

/** approvePolicy 参数 */
export interface ApprovePolicyParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 批准一项政策。
 *
 * 从 proposed 转为 approved，计算生效日，原子应用批准效果。
 * 仅在 success 结果中返回 effects 和 signals。
 *
 * @param params 批准参数
 * @returns 转换结果
 */
export function approvePolicy(params: ApprovePolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (!isValidTransition(instance.status, 'approved')) {
    return { success: false, reason: 'invalid_transition' };
  }

  const approvedAtDay = currentDay;
  const effectiveAtDay = currentDay + instance.snapshot.effectiveDelayDays;

  const signals: DomainSignalSnapshot[] = [];

  // 发出 policy.approved 信号
  signals.push(
    makeSignal(
      'policy.approved',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  // 发出 policy.status_changed 信号
  signals.push(
    makeSignal(
      'policy.status_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousStatus: instance.status,
        currentStatus: 'approved',
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    status: 'approved',
    approvedAtDay,
    effectiveAtDay,
  };

  return {
    success: true,
    instance: updated,
    effects: updated.snapshot.phases.length > 0 ? [] : [],
    emittedSignals: signals,
  };
}

/** activatePolicy 参数 */
export interface ActivatePolicyParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 激活一项政策，使其进入实施状态。
 *
 * 从 approved 转为 implementing，进入第一阶段。
 * 检查当前日不早于生效日；应用第一阶段 entryEffects。
 *
 * @param params 激活参数
 * @returns 转换结果
 */
export function activatePolicy(params: ActivatePolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (!isValidTransition(instance.status, 'implementing')) {
    return { success: false, reason: 'invalid_transition' };
  }

  if (instance.effectiveAtDay !== null && currentDay < instance.effectiveAtDay) {
    return { success: false, reason: 'not_effective_yet' };
  }

  const phases = instance.snapshot.phases;
  if (phases.length === 0) {
    return { success: false, reason: 'no_phases' };
  }

  const firstPhase = phases[0]!;
  const phaseEnteredAtDay = currentDay;
  const nextMilestoneAtDay = currentDay + firstPhase.durationDays;

  const signals: DomainSignalSnapshot[] = [];

  // 发出 policy.status_changed
  signals.push(
    makeSignal(
      'policy.status_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousStatus: instance.status,
        currentStatus: 'implementing',
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  // 发出 policy.phase_changed
  signals.push(
    makeSignal(
      'policy.phase_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousPhaseId: null,
        currentPhaseId: firstPhase.id,
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    status: 'implementing',
    currentPhaseId: firstPhase.id,
    phaseEnteredAtDay,
    nextMilestoneAtDay,
  };

  return {
    success: true,
    instance: updated,
    effects: firstPhase.entryEffects,
    emittedSignals: signals,
  };
}

/** suspendPolicy 参数 */
export interface SuspendPolicyParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 暂停一项正在实施的政策。
 *
 * 仅允许 implementing → suspended。
 * 保留当前阶段和原里程碑日期。
 *
 * @param params 暂停参数
 * @returns 转换结果
 */
export function suspendPolicy(params: SuspendPolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (!isValidTransition(instance.status, 'suspended')) {
    return { success: false, reason: 'invalid_transition' };
  }

  const signals: DomainSignalSnapshot[] = [];
  signals.push(
    makeSignal(
      'policy.status_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousStatus: instance.status,
        currentStatus: 'suspended',
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    status: 'suspended',
    suspendedAtDay: currentDay,
  };

  return {
    success: true,
    instance: updated,
    effects: [],
    emittedSignals: signals,
  };
}

/** resumePolicy 参数 */
export interface ResumePolicyParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 恢复一项暂停的政策。
 *
 * 仅允许 suspended → implementing。
 * 里程碑顺延暂停天数，累计暂停时间。
 *
 * @param params 恢复参数
 * @returns 转换结果
 */
export function resumePolicy(params: ResumePolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (!isValidTransition(instance.status, 'implementing')) {
    return { success: false, reason: 'invalid_transition' };
  }

  const pauseDays = instance.suspendedAtDay !== null ? currentDay - instance.suspendedAtDay : 0;

  const signals: DomainSignalSnapshot[] = [];
  signals.push(
    makeSignal(
      'policy.status_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousStatus: instance.status,
        currentStatus: 'implementing',
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    status: 'implementing',
    suspendedAtDay: null,
    accumulatedSuspendedDays: instance.accumulatedSuspendedDays + pauseDays,
    nextMilestoneAtDay:
      instance.nextMilestoneAtDay !== null ? instance.nextMilestoneAtDay + pauseDays : null,
  };

  return {
    success: true,
    instance: updated,
    effects: [],
    emittedSignals: signals,
  };
}

/** advancePolicyPhase 参数 */
export interface AdvancePolicyPhaseParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 推进政策到下一阶段（或完成）。
 *
 * 仅允许 implementing 状态；当前日必须达到 nextMilestoneAtDay。
 * 应用当前阶段的 completionEffects，如果存在下一阶段则应用其 entryEffects。
 * 如果当前是最后阶段，则标记为 completed。
 *
 * @param params 推进参数
 * @returns 转换结果
 */
export function advancePolicyPhase(params: AdvancePolicyPhaseParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (instance.status !== 'implementing') {
    return { success: false, reason: 'invalid_transition' };
  }

  if (instance.nextMilestoneAtDay === null) {
    return { success: false, reason: 'invalid_transition' };
  }

  if (currentDay < instance.nextMilestoneAtDay) {
    return { success: false, reason: 'not_effective_yet' };
  }

  const phases = instance.snapshot.phases;
  const currentIdx = phases.findIndex((p) => p.id === instance.currentPhaseId);
  if (currentIdx === -1) {
    return { success: false, reason: 'phase_not_found' };
  }

  const currentPhase = phases[currentIdx]!;
  const isLastPhase = currentIdx === phases.length - 1;

  const signals: DomainSignalSnapshot[] = [];
  const effects: EffectDefinition[] = [...currentPhase.completionEffects];

  if (isLastPhase) {
    // 最后阶段：完成政策
    const updated: PolicyInstance = {
      ...instance,
      status: 'completed',
      completedAtDay: currentDay,
      nextMilestoneAtDay: null,
      currentPhaseId: null,
      phaseEnteredAtDay: null,
    };

    signals.push(
      makeSignal(
        'policy.status_changed',
        {
          policyInstanceId: instance.instanceId,
          policyId: instance.policyId,
          previousStatus: instance.status,
          currentStatus: 'completed',
          regionId: instance.originContext.regionId,
          institutionId: instance.originContext.institutionId,
          originPositionId: instance.originContext.positionId,
        },
        currentDay,
        idFactory,
      ),
    );

    return {
      success: true,
      instance: updated,
      effects,
      emittedSignals: signals,
    };
  }

  // 推进到下一阶段
  const nextPhase = phases[currentIdx + 1]!;
  const phaseEnteredAtDay = currentDay;
  const nextMilestoneAtDay = currentDay + nextPhase.durationDays;

  effects.push(...nextPhase.entryEffects);

  signals.push(
    makeSignal(
      'policy.phase_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousPhaseId: currentPhase.id,
        currentPhaseId: nextPhase.id,
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    currentPhaseId: nextPhase.id,
    phaseEnteredAtDay,
    nextMilestoneAtDay,
  };

  return {
    success: true,
    instance: updated,
    effects,
    emittedSignals: signals,
  };
}

/** failPolicy 参数 */
export interface FailPolicyParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 标记政策为失败。
 *
 * 允许从 approved、implementing、suspended 转为 failed。
 *
 * @param params 失败参数
 * @returns 转换结果
 */
export function failPolicy(params: FailPolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (TERMINAL_STATUSES.has(instance.status)) {
    return { success: false, reason: 'already_terminal' };
  }

  if (!isValidTransition(instance.status, 'failed')) {
    return { success: false, reason: 'invalid_transition' };
  }

  const signals: DomainSignalSnapshot[] = [];
  signals.push(
    makeSignal(
      'policy.status_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousStatus: instance.status,
        currentStatus: 'failed',
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    status: 'failed',
    failedAtDay: currentDay,
    nextMilestoneAtDay: null,
    suspendedAtDay: null,
  };

  return {
    success: true,
    instance: updated,
    effects: [],
    emittedSignals: signals,
  };
}

/** completePolicy 参数 */
export interface CompletePolicyParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 标记政策为完成。
 *
 * 仅允许 implementing → completed。通常由 advancePolicyPhase 在最后阶段调用，
 * 但也暴露为独立函数用于测试和特殊场景。
 *
 * @param params 完成参数
 * @returns 转换结果
 */
export function completePolicy(params: CompletePolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (TERMINAL_STATUSES.has(instance.status)) {
    return { success: false, reason: 'already_terminal' };
  }

  if (!isValidTransition(instance.status, 'completed')) {
    return { success: false, reason: 'invalid_transition' };
  }

  const signals: DomainSignalSnapshot[] = [];
  signals.push(
    makeSignal(
      'policy.status_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousStatus: instance.status,
        currentStatus: 'completed',
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    status: 'completed',
    completedAtDay: currentDay,
    nextMilestoneAtDay: null,
    currentPhaseId: null,
    phaseEnteredAtDay: null,
    suspendedAtDay: null,
  };

  return {
    success: true,
    instance: updated,
    effects: [],
    emittedSignals: signals,
  };
}

/** repealPolicy 参数 */
export interface RepealPolicyParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

/**
 * 废止一项政策。
 *
 * 允许从 proposed、approved、implementing、suspended 转为 repealed。
 * 终态再次调用必须失败。
 *
 * @param params 废止参数
 * @returns 转换结果
 */
export function repealPolicy(params: RepealPolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;

  if (TERMINAL_STATUSES.has(instance.status)) {
    return { success: false, reason: 'already_terminal' };
  }

  if (!isValidTransition(instance.status, 'repealed')) {
    return { success: false, reason: 'invalid_transition' };
  }

  const signals: DomainSignalSnapshot[] = [];
  signals.push(
    makeSignal(
      'policy.status_changed',
      {
        policyInstanceId: instance.instanceId,
        policyId: instance.policyId,
        previousStatus: instance.status,
        currentStatus: 'repealed',
        regionId: instance.originContext.regionId,
        institutionId: instance.originContext.institutionId,
        originPositionId: instance.originContext.positionId,
      },
      currentDay,
      idFactory,
    ),
  );

  const updated: PolicyInstance = {
    ...instance,
    status: 'repealed',
    repealedAtDay: currentDay,
    nextMilestoneAtDay: null,
    suspendedAtDay: null,
  };

  return {
    success: true,
    instance: updated,
    effects: [],
    emittedSignals: signals,
  };
}
