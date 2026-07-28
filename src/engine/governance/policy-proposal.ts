/**
 * 政策提议转换
 *
 * 校验可用性和重复实例，并将配置冻结为可持久化的政策快照。
 */

import type { PolicyOriginContextSnapshot, PolicyInstance } from '../../domain/governance/state';
import type { PolicyDefinitionConfig } from '../../types/config';
import {
  createPolicySnapshot,
  isTerminal,
  transitionSuccess,
  type PolicyTransitionResult,
} from './policy-lifecycle-shared';

/** 提议政策所需的上下文。 */
export interface ProposePolicyParams {
  definition: PolicyDefinitionConfig;
  originContext: PolicyOriginContextSnapshot;
  currentDay: number;
  idFactory: () => string;
  existingPolicies: readonly PolicyInstance[];
  evaluateCondition: (condition: unknown) => boolean;
}

/**
 * 创建处于 proposed 状态的政策实例。
 *
 * @param params 提议所需配置、任职上下文与条件求值器
 * @returns 新实例或明确的失败原因
 */
export function proposePolicy(params: ProposePolicyParams): PolicyTransitionResult {
  const { definition, originContext, currentDay, idFactory, existingPolicies, evaluateCondition } =
    params;
  const duplicate = existingPolicies.some(
    (policy) =>
      policy.policyId === definition.id &&
      policy.originContext.regionId === originContext.regionId &&
      policy.originContext.institutionId === originContext.institutionId &&
      !isTerminal(policy.status),
  );
  if (duplicate) return { success: false, reason: 'duplicate_active_policy' };
  try {
    if (definition.availabilityCondition && !evaluateCondition(definition.availabilityCondition)) {
      return { success: false, reason: 'condition_failed' };
    }
  } catch {
    return { success: false, reason: 'condition_failed' };
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
  return transitionSuccess(instance, [], []);
}
