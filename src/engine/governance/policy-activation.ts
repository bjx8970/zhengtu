/**
 * 政策激活转换
 *
 * 在生效日到达后使已批准的政策进入首个实施阶段。
 */

import {
  canTransition,
  phaseChangedSignal,
  statusChangedSignal,
  transitionSuccess,
  type PolicyInstanceTransitionParams,
  type PolicyTransitionResult,
} from './policy-lifecycle-shared';

/** 激活政策所需的实例转换参数。 */
export type ActivatePolicyParams = PolicyInstanceTransitionParams;

/**
 * 激活一项已批准政策并应用首阶段入口效果。
 *
 * @param params 政策实例及当前日
 * @returns 更新后的实例、入口效果和状态／阶段信号
 */
export function activatePolicy(params: ActivatePolicyParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;
  if (!canTransition(instance.status, 'implementing'))
    return { success: false, reason: 'invalid_transition' };
  if (instance.effectiveAtDay !== null && currentDay < instance.effectiveAtDay) {
    return { success: false, reason: 'not_effective_yet' };
  }
  const phase = instance.snapshot.phases[0];
  if (!phase) return { success: false, reason: 'no_phases' };
  const updated = {
    ...instance,
    status: 'implementing' as const,
    currentPhaseId: phase.id,
    phaseEnteredAtDay: currentDay,
    nextMilestoneAtDay: currentDay + phase.durationDays,
  };
  return transitionSuccess(updated, phase.entryEffects, [
    statusChangedSignal(instance, 'implementing', currentDay, idFactory),
    phaseChangedSignal(instance, null, phase.id, currentDay, idFactory),
  ]);
}
