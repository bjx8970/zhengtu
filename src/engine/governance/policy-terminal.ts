/**
 * 政策终态转换
 *
 * 将非终态政策标记为失败、完成或废止，并清理不再有效的阶段状态。
 */

import type { PolicyInstance } from '../../domain/governance/state';
import type { PolicyStatus } from '../../domain/governance/types';
import {
  canTransition,
  isTerminal,
  statusChangedSignal,
  transitionSuccess,
  type PolicyInstanceTransitionParams,
  type PolicyTransitionResult,
} from './policy-lifecycle-shared';

/** 标记政策失败所需的实例转换参数。 */
export type FailPolicyParams = PolicyInstanceTransitionParams;
/** 直接标记政策完成所需的实例转换参数。 */
export type CompletePolicyParams = PolicyInstanceTransitionParams;
/** 废止政策所需的实例转换参数。 */
export type RepealPolicyParams = PolicyInstanceTransitionParams;

function terminalTransition(
  instance: PolicyInstance,
  target: Extract<PolicyStatus, 'completed' | 'failed' | 'repealed'>,
  currentDay: number,
  idFactory: () => string,
): PolicyTransitionResult {
  if (isTerminal(instance.status)) return { success: false, reason: 'already_terminal' };
  if (!canTransition(instance.status, target))
    return { success: false, reason: 'invalid_transition' };
  const updated: PolicyInstance = {
    ...instance,
    status: target,
    nextMilestoneAtDay: null,
    suspendedAtDay: null,
    currentPhaseId: target === 'completed' ? null : instance.currentPhaseId,
    phaseEnteredAtDay: target === 'completed' ? null : instance.phaseEnteredAtDay,
    completedAtDay: target === 'completed' ? currentDay : instance.completedAtDay,
    failedAtDay: target === 'failed' ? currentDay : instance.failedAtDay,
    repealedAtDay: target === 'repealed' ? currentDay : instance.repealedAtDay,
  };
  return transitionSuccess(
    updated,
    [],
    [statusChangedSignal(instance, target, currentDay, idFactory)],
  );
}

/**
 * 标记政策为失败。
 *
 * @param params 政策实例及当前日
 * @returns 失败终态或转换失败原因
 */
export function failPolicy(params: FailPolicyParams): PolicyTransitionResult {
  return terminalTransition(params.instance, 'failed', params.currentDay, params.idFactory);
}

/**
 * 直接标记实施中的政策为完成。
 *
 * @param params 政策实例及当前日
 * @returns 完成终态或转换失败原因
 */
export function completePolicy(params: CompletePolicyParams): PolicyTransitionResult {
  return terminalTransition(params.instance, 'completed', params.currentDay, params.idFactory);
}

/**
 * 废止尚未终结的政策。
 *
 * @param params 政策实例及当前日
 * @returns 废止终态或转换失败原因
 */
export function repealPolicy(params: RepealPolicyParams): PolicyTransitionResult {
  return terminalTransition(params.instance, 'repealed', params.currentDay, params.idFactory);
}
