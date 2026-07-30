/**
 * 职业机会生命周期纯函数。
 *
 * 集中维护机会状态机，避免 Store/UI 绕过终态和截止日约束。
 */

import type { CareerOpportunity } from '../../domain/career/state';
import type { CareerOpportunityStatus } from '../../domain/career/types';

/** 生命周期操作结果。 */
export interface CareerOpportunityLifecycleResult {
  success: boolean;
  opportunity: CareerOpportunity | null;
}

function transition(
  opportunity: CareerOpportunity,
  currentDay: number,
  status: CareerOpportunityStatus,
): CareerOpportunityLifecycleResult {
  if (opportunity.status !== 'available') return { success: false, opportunity: null };
  if (
    status === 'accepted' &&
    opportunity.expiresAtDay !== null &&
    opportunity.expiresAtDay <= currentDay
  )
    return { success: false, opportunity: null };
  const next = cloneOpportunity(opportunity);
  next.status = status;
  if (status === 'accepted') next.acceptedAtDay = currentDay;
  if (status === 'rejected') next.rejectedAtDay = currentDay;
  if (status === 'cancelled') next.cancelledAtDay = currentDay;
  return { success: true, opportunity: next };
}

function cloneOpportunity(opportunity: CareerOpportunity): CareerOpportunity {
  if (opportunity.type === 'training') {
    return {
      ...opportunity,
      source: { ...opportunity.source },
      eligibilityConditions: [...opportunity.eligibilityConditions],
      effects: [...opportunity.effects],
    };
  }
  return {
    ...opportunity,
    source: { ...opportunity.source },
    eligibilityConditions: [...opportunity.eligibilityConditions],
    target: { ...opportunity.target },
  };
}

/**
 * 接受可用机会。
 *
 * @param opportunity 当前机会
 * @param currentDay 当前绝对日
 * @returns 状态转换结果
 */
export function acceptCareerOpportunity(
  opportunity: CareerOpportunity,
  currentDay: number,
): CareerOpportunityLifecycleResult {
  return transition(opportunity, currentDay, 'accepted');
}

/**
 * 拒绝可用机会。
 *
 * @param opportunity 当前机会
 * @param currentDay 当前绝对日
 * @returns 状态转换结果
 */
export function rejectCareerOpportunity(
  opportunity: CareerOpportunity,
  currentDay: number,
): CareerOpportunityLifecycleResult {
  return transition(opportunity, currentDay, 'rejected');
}

/**
 * 取消可用机会。
 *
 * @param opportunity 当前机会
 * @param currentDay 当前绝对日
 * @returns 状态转换结果
 */
export function cancelCareerOpportunity(
  opportunity: CareerOpportunity,
  currentDay: number,
): CareerOpportunityLifecycleResult {
  return transition(opportunity, currentDay, 'cancelled');
}

/**
 * 使到期的可用机会失效。
 *
 * @param opportunity 当前机会
 * @param currentDay 当前绝对日
 * @returns 状态转换结果
 */
export function expireCareerOpportunity(
  opportunity: CareerOpportunity,
  currentDay: number,
): CareerOpportunityLifecycleResult {
  if (opportunity.expiresAtDay === null || opportunity.expiresAtDay > currentDay)
    return { success: false, opportunity: null };
  return transition(opportunity, currentDay, 'expired');
}

/**
 * 标记正在处理或已接受的机会为最终结果。
 *
 * @param opportunity 当前机会
 * @param currentDay 当前绝对日
 * @param outcome 最终结果
 * @returns 状态转换结果
 */
export function resolveCareerOpportunity(
  opportunity: CareerOpportunity,
  currentDay: number,
  outcome: NonNullable<CareerOpportunity['finalOutcome']>,
): CareerOpportunityLifecycleResult {
  if (opportunity.status !== 'accepted' && opportunity.status !== 'in_process')
    return { success: false, opportunity: null };
  const next = cloneOpportunity(opportunity);
  next.status = 'resolved';
  next.resolvedAtDay = currentDay;
  next.finalOutcome = outcome;
  return { success: true, opportunity: next };
}
