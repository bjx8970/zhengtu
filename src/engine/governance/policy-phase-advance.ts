/**
 * 政策阶段推进转换
 *
 * 在里程碑到达后完成当前阶段，进入下一阶段或将政策标记为完成。
 */

import {
  phaseChangedSignal,
  statusChangedSignal,
  transitionSuccess,
  type PolicyInstanceTransitionParams,
  type PolicyTransitionResult,
} from './policy-lifecycle-shared';

/** 推进政策阶段所需的实例转换参数。 */
export type AdvancePolicyPhaseParams = PolicyInstanceTransitionParams;

/**
 * 推进政策到下一阶段，或在最后阶段完成政策。
 *
 * @param params 政策实例及当前日
 * @returns 更新后的实例、阶段效果和领域信号
 */
export function advancePolicyPhase(params: AdvancePolicyPhaseParams): PolicyTransitionResult {
  const { instance, currentDay, idFactory } = params;
  if (instance.status !== 'implementing' || instance.nextMilestoneAtDay === null) {
    return { success: false, reason: 'invalid_transition' };
  }
  if (currentDay < instance.nextMilestoneAtDay)
    return { success: false, reason: 'not_effective_yet' };
  const index = instance.snapshot.phases.findIndex((phase) => phase.id === instance.currentPhaseId);
  if (index === -1) return { success: false, reason: 'phase_not_found' };
  const current = instance.snapshot.phases[index];
  if (!current) return { success: false, reason: 'phase_not_found' };
  const effects = [...current.completionEffects];
  const next = instance.snapshot.phases[index + 1];
  if (!next) {
    const updated = {
      ...instance,
      status: 'completed' as const,
      completedAtDay: currentDay,
      nextMilestoneAtDay: null,
      currentPhaseId: null,
      phaseEnteredAtDay: null,
    };
    return transitionSuccess(updated, effects, [
      statusChangedSignal(instance, 'completed', currentDay, idFactory),
    ]);
  }
  const updated = {
    ...instance,
    currentPhaseId: next.id,
    phaseEnteredAtDay: currentDay,
    nextMilestoneAtDay: currentDay + next.durationDays,
  };
  effects.push(...next.entryEffects);
  return transitionSuccess(updated, effects, [
    phaseChangedSignal(instance, current.id, next.id, currentDay, idFactory),
  ]);
}
