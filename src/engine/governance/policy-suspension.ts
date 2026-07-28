/**
 * 政策暂停与恢复转换
 *
 * 维护暂停期间和里程碑顺延，且只允许实施状态与暂停状态之间切换。
 */

import {
  canTransition,
  statusChangedSignal,
  transitionSuccess,
  type PolicyInstanceTransitionParams,
  type PolicyTransitionResult,
} from './policy-lifecycle-shared';

/** 暂停政策所需的实例转换参数。 */
export type SuspendPolicyParams = PolicyInstanceTransitionParams;
/** 恢复政策所需的实例转换参数。 */
export type ResumePolicyParams = PolicyInstanceTransitionParams;

/**
 * 暂停正在实施的政策。
 *
 * @param params 政策实例及当前日
 * @returns 更新后的暂停实例或失败原因
 */
export function suspendPolicy(params: SuspendPolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;
  if (!canTransition(instance.status, 'suspended'))
    return { success: false, reason: 'invalid_transition' };
  const updated = { ...instance, status: 'suspended' as const, suspendedAtDay: currentDay };
  return transitionSuccess(
    updated,
    [],
    [statusChangedSignal(instance, 'suspended', currentDay, idFactory)],
  );
}

/**
 * 恢复暂停政策并按暂停天数顺延里程碑。
 *
 * @param params 政策实例及当前日
 * @returns 更新后的实施实例或失败原因
 */
export function resumePolicy(params: ResumePolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;
  if (!canTransition(instance.status, 'implementing'))
    return { success: false, reason: 'invalid_transition' };
  const pausedDays = instance.suspendedAtDay === null ? 0 : currentDay - instance.suspendedAtDay;
  const updated = {
    ...instance,
    status: 'implementing' as const,
    suspendedAtDay: null,
    accumulatedSuspendedDays: instance.accumulatedSuspendedDays + pausedDays,
    nextMilestoneAtDay:
      instance.nextMilestoneAtDay === null ? null : instance.nextMilestoneAtDay + pausedDays,
  };
  return transitionSuccess(
    updated,
    [],
    [statusChangedSignal(instance, 'implementing', currentDay, idFactory)],
  );
}
