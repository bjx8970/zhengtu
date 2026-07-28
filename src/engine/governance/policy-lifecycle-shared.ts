/**
 * 政策生命周期共享契约
 *
 * 为拆分后的纯生命周期转换提供结果、状态规则、信号构造和快照冻结逻辑。
 */
import type { EffectDefinition } from '../../domain/conditions';
import type { PolicyExecutableSnapshot, PolicyInstance } from '../../domain/governance/state';
import type { DomainSignalSnapshot, PolicyStatus } from '../../domain/governance/types';
import type { PolicyDefinitionConfig } from '../../types/config';
import { CURRENT_CONTENT_VERSION } from '../../types/save';

/** 政策生命周期转换失败原因。 */
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

/** 政策生命周期转换的判别结果。 */
export type PolicyTransitionResult =
  | {
      success: true;
      instance: PolicyInstance;
      effects: EffectDefinition[];
      emittedSignals: DomainSignalSnapshot[];
    }
  | { success: false; reason: PolicyTransitionFailure };

/** 通用实例转换参数。 */
export interface PolicyInstanceTransitionParams {
  instance: PolicyInstance;
  currentDay: number;
  idFactory: () => string;
}

const VALID_TRANSITIONS: Record<PolicyStatus, readonly PolicyStatus[]> = {
  proposed: ['approved', 'repealed'],
  approved: ['implementing', 'failed', 'repealed'],
  implementing: ['suspended', 'completed', 'failed', 'repealed'],
  suspended: ['implementing', 'failed', 'repealed'],
  completed: [],
  failed: [],
  repealed: [],
};
const TERMINAL_STATUSES: ReadonlySet<PolicyStatus> = new Set(['completed', 'failed', 'repealed']);

/**
 * 判断状态是否可按生命周期规则转换。
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 该转换是否合法
 */
export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * 判断政策状态是否为不可恢复的终态。
 *
 * @param status 政策状态
 * @returns 是否为终态
 */
export function isTerminal(status: PolicyStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * 创建政策产生的领域信号。
 *
 * @param signalType 信号类型
 * @param data 信号载荷
 * @param currentDay 当前绝对日
 * @param idFactory 信号 ID 工厂
 * @returns 可持久化的领域信号快照
 */
export function makePolicySignal<T extends DomainSignalSnapshot['signalType']>(
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
 * 创建政策状态变化信号。
 * @param instance 政策实例
 * @param currentStatus 转换后的状态
 * @param currentDay 当前绝对日
 * @param idFactory 信号 ID 工厂
 * @returns 状态变化信号
 */
export function statusChangedSignal(
  instance: PolicyInstance,
  currentStatus: PolicyStatus,
  currentDay: number,
  idFactory: () => string,
): DomainSignalSnapshot {
  return makePolicySignal(
    'policy.status_changed',
    {
      policyInstanceId: instance.instanceId,
      policyId: instance.policyId,
      previousStatus: instance.status,
      currentStatus,
      regionId: instance.originContext.regionId,
      institutionId: instance.originContext.institutionId,
      originPositionId: instance.originContext.positionId,
    },
    currentDay,
    idFactory,
  );
}

/**
 * 创建政策阶段变化信号。
 * @param instance 政策实例
 * @param previousPhaseId 原阶段 ID
 * @param currentPhaseId 新阶段 ID
 * @param currentDay 当前绝对日
 * @param idFactory 信号 ID 工厂
 * @returns 阶段变化信号
 */
export function phaseChangedSignal(
  instance: PolicyInstance,
  previousPhaseId: string | null,
  currentPhaseId: string,
  currentDay: number,
  idFactory: () => string,
): DomainSignalSnapshot {
  return makePolicySignal(
    'policy.phase_changed',
    {
      policyInstanceId: instance.instanceId,
      policyId: instance.policyId,
      previousPhaseId,
      currentPhaseId,
      regionId: instance.originContext.regionId,
      institutionId: instance.originContext.institutionId,
      originPositionId: instance.originContext.positionId,
    },
    currentDay,
    idFactory,
  );
}

/**
 * 构造成功转换结果。
 * @param instance 转换后的实例
 * @param effects 要执行的效果
 * @param emittedSignals 要编排的信号
 * @returns 成功结果
 */
export function transitionSuccess(
  instance: PolicyInstance,
  effects: EffectDefinition[],
  emittedSignals: DomainSignalSnapshot[],
): PolicyTransitionResult {
  return { success: true, instance, effects, emittedSignals };
}

/**
 * 从配置创建不可变的政策执行快照。
 * @param definition 政策配置定义
 * @returns 独立于 ConfigLoader 的可执行快照
 */
export function createPolicySnapshot(definition: PolicyDefinitionConfig): PolicyExecutableSnapshot {
  return {
    policyId: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    tags: [...definition.tags],
    effectiveDelayDays: definition.effectiveDelayDays,
    approvalEffects: definition.approvalEffects.map((effect) => structuredClone(effect)),
    phases: definition.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      description: phase.description,
      durationDays: phase.durationDays,
      entryEffects: phase.entryEffects.map((effect) => structuredClone(effect)),
      completionEffects: phase.completionEffects.map((effect) => structuredClone(effect)),
    })),
    contentVersion: CURRENT_CONTENT_VERSION,
  };
}
