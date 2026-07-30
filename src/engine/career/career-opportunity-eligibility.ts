/**
 * 职业机会资格判定。
 *
 * 集中 Store 与 UI 共用的机会接受、任职落位前校验，保证展示状态与 reducer
 * 的持久化裁定保持一致。
 */

import type { CareerExperienceQualificationRules } from '../../types/config';
import type { PlayerSave } from '../../types/player';
import type { PositionConfigV2 } from '../../types/position-v2';
import type { ConditionExpression } from '../../domain/conditions';
import type { CareerOpportunity } from '../../domain/career/state';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { getActiveCareerRestrictions } from './civil-service-rank-eligibility';
import { evaluateCondition } from '../events/condition-interpreter';

export type CareerOpportunityEligibilityFailure =
  | 'opportunity_unavailable'
  | 'opportunity_expired'
  | 'active_process'
  | 'blocking_event'
  | 'pending_continuation'
  | 'opportunity_conditions'
  | 'target_missing'
  | 'target_snapshot_mismatch'
  | 'target_vacant'
  | 'same_position'
  | 'appointment_restriction'
  | 'target_conditions';

export interface CareerOpportunityEligibilityResult {
  eligible: boolean;
  failure: CareerOpportunityEligibilityFailure | null;
}

export interface CareerOpportunityEligibilityInput {
  opportunity: CareerOpportunity;
  state: Readonly<PlayerSave>;
  currentDay: number;
  daysPerYear: number;
  targetPosition: PositionConfigV2 | null;
  careerExperienceQualificationRules: Readonly<CareerExperienceQualificationRules>;
}

const ELIGIBLE: CareerOpportunityEligibilityResult = { eligible: true, failure: null };

/**
 * @param state 当前存档
 * @returns 是否有尚未完成的日程行动
 */
export function hasRunningCareerAction(state: Readonly<PlayerSave>): boolean {
  return Object.values(state.actions.slots).some((tier) => tier.occupants.some(Boolean));
}

/**
 * @param condition 配置条件表达式
 * @returns 条件是否依赖一次性信号载荷
 */
function containsSignalFieldCondition(condition: ConditionExpression): boolean {
  if ('signalField' in condition) return true;
  if ('all' in condition) return condition.all.some(containsSignalFieldCondition);
  if ('any' in condition) return condition.any.some(containsSignalFieldCondition);
  return 'not' in condition && containsSignalFieldCondition(condition.not);
}

/**
 * @param conditions 待评估条件
 * @param input 职业机会资格评估输入
 * @returns 条件是否全部满足
 */
function satisfiesConditions(
  conditions: readonly ConditionExpression[],
  input: CareerOpportunityEligibilityInput,
): boolean {
  const { opportunity, state, currentDay, daysPerYear, careerExperienceQualificationRules } = input;
  if (opportunity.sourceSignal === null && conditions.some(containsSignalFieldCondition))
    return false;
  const fallbackSignal: DomainSignalSnapshot = {
    signalId: 'career-eligibility-recheck',
    signalType: 'assessment.completed',
    occurredAtDay: currentDay,
    data: { year: 0, score: 0, tier: '' },
  };
  return conditions.every((condition) =>
    evaluateCondition(condition, {
      state,
      signal: opportunity.sourceSignal ?? fallbackSignal,
      currentDay,
      daysPerYear,
      careerExperienceQualificationRules,
    }),
  );
}

/**
 * @param input 职业机会资格评估输入
 * @param requireAvailable 是否要求机会仍为待处理状态
 * @returns 静态机会与岗位资格评估结果
 */
function evaluateOpportunityEligibility(
  input: CareerOpportunityEligibilityInput,
  requireAvailable: boolean,
): CareerOpportunityEligibilityResult {
  const { opportunity, state, currentDay, targetPosition } = input;
  if (requireAvailable && opportunity.status !== 'available')
    return { eligible: false, failure: 'opportunity_unavailable' };
  if (opportunity.expiresAtDay !== null && opportunity.expiresAtDay <= currentDay)
    return { eligible: false, failure: 'opportunity_expired' };
  if (!satisfiesConditions(opportunity.eligibilityConditions, input))
    return { eligible: false, failure: 'opportunity_conditions' };
  if (opportunity.type === 'training') return ELIGIBLE;
  if (!targetPosition) return { eligible: false, failure: 'target_missing' };
  if (
    targetPosition.id !== opportunity.target.positionId ||
    targetPosition.institutionId !== opportunity.target.institutionId ||
    targetPosition.regionId !== opportunity.target.regionId
  )
    return { eligible: false, failure: 'target_snapshot_mismatch' };
  if (targetPosition.vacancyCount <= 0) return { eligible: false, failure: 'target_vacant' };
  if (state.career.appointment.positionId === targetPosition.id)
    return { eligible: false, failure: 'same_position' };
  if (
    getActiveCareerRestrictions(state.career.restrictions, currentDay).some(
      (restriction) =>
        restriction.type === 'appointment_selection_freeze' ||
        restriction.type === 'disciplinary_action',
    )
  )
    return { eligible: false, failure: 'appointment_restriction' };
  if (!satisfiesConditions(targetPosition.requirements, input))
    return { eligible: false, failure: 'target_conditions' };
  return ELIGIBLE;
}

/**
 * @param input 职业机会资格评估输入
 * @returns 是否可以接受机会及失败原因
 */
export function evaluateCareerOpportunityAcceptanceEligibility(
  input: CareerOpportunityEligibilityInput,
): CareerOpportunityEligibilityResult {
  const { state } = input;
  if (state.career.activeProcess) return { eligible: false, failure: 'active_process' };
  if (state.events.activeBlockingEventId) return { eligible: false, failure: 'blocking_event' };
  if (state.time.pendingContinuation) return { eligible: false, failure: 'pending_continuation' };
  return evaluateOpportunityEligibility(input, true);
}

/**
 * @param input 职业机会资格评估输入
 * @returns 是否仍可完成任职落位及失败原因
 */
export function evaluateCareerOpportunityAppointmentEligibility(
  input: CareerOpportunityEligibilityInput,
): CareerOpportunityEligibilityResult {
  return evaluateOpportunityEligibility(input, false);
}
