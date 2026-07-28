/**
 * 政策批准转换
 *
 * 将提议实例批准，并从冻结快照返回批准效果和领域信号。
 */

import {
  canTransition,
  makePolicySignal,
  statusChangedSignal,
  transitionSuccess,
  type PolicyInstanceTransitionParams,
  type PolicyTransitionResult,
} from './policy-lifecycle-shared';

/** 批准政策所需的实例转换参数。 */
export type ApprovePolicyParams = PolicyInstanceTransitionParams;

/**
 * 批准一项政策，并保留批准时的效果快照。
 *
 * @param params 政策实例及当前日
 * @returns 更新后的实例、批准效果和信号
 */
export function approvePolicy(params: ApprovePolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;
  if (!canTransition(instance.status, 'approved'))
    return { success: false, reason: 'invalid_transition' };
  const updated = {
    ...instance,
    status: 'approved' as const,
    approvedAtDay: currentDay,
    effectiveAtDay: currentDay + instance.snapshot.effectiveDelayDays,
  };
  const approved = makePolicySignal(
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
  );
  return transitionSuccess(updated, updated.snapshot.approvalEffects, [
    approved,
    statusChangedSignal(instance, 'approved', currentDay, idFactory),
  ]);
}
