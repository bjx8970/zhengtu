/** 事件、政策、履历、世界事实与指标条件的纯函数解释器。 */

import type { ConditionExpression } from '../../domain/conditions';
import type { ConditionEvaluationContext } from '../../types/condition';
import { analyzeCareerExperiences } from '../career/career-experience-analysis';
import { compareNumber } from './condition-comparison';

/** @param condition 事件历史条件 @param context 评估上下文 @returns 是否满足条件 */
export function evaluateEventHistoryCondition(
  condition: Extract<ConditionExpression, { eventHistory: string }>,
  context: ConditionEvaluationContext,
): boolean {
  const count = context.state.events.history.filter(
    (item) => item.eventId === condition.eventHistory,
  ).length;
  if (condition.check === 'occurred') return count > 0;
  if (condition.check === 'not_occurred') return count === 0;
  if (condition.check === 'count_gte') return count >= condition.value;
  return condition.check === 'count_lte' && count <= condition.value;
}

/** @param condition 政策状态条件 @param context 评估上下文 @returns 是否满足条件 */
export function evaluatePolicyStateCondition(
  condition: Extract<ConditionExpression, { policyRef: unknown }>,
  context: ConditionEvaluationContext,
): boolean {
  const ref = condition.policyRef as
    { source: 'signal' } | { source: 'fixed'; policyInstanceId: string };
  const data = context.signal.data as Record<string, unknown>;
  const instanceId =
    ref.source === 'fixed'
      ? ref.policyInstanceId
      : typeof data.policyInstanceId === 'string'
        ? data.policyInstanceId
        : undefined;
  if (!instanceId) return false;
  const policy = context.state.governance.policies.find((item) => item.instanceId === instanceId);
  if (!policy) return false;
  switch (condition.check) {
    case 'status_is':
      return policy.status === condition.value;
    case 'phase_is':
      return policy.currentPhaseId === condition.value;
    case 'metric_gte':
      return (policy.metrics[condition.metricId] ?? 0) >= condition.value;
    case 'metric_lte':
      return (policy.metrics[condition.metricId] ?? 0) <= condition.value;
  }
}

/** @param condition 履历条件 @param context 评估上下文 @returns 是否满足条件 */
export function evaluateExperienceCondition(
  condition: Extract<ConditionExpression, { experience: string }>,
  context: ConditionEvaluationContext,
): boolean {
  if (!context.careerExperienceQualificationRules) return false;
  const analysis = analyzeCareerExperiences({
    experiences: context.state.career.experiences,
    currentAppointment: context.state.career.appointment,
    currentDay: context.currentDay,
    rules: context.careerExperienceQualificationRules,
  });
  if (!analysis.valid) return false;
  switch (condition.experience) {
    case 'region_count':
      return compareNumber(analysis.regionCount, condition.value, condition.op);
    case 'institution_count':
      return compareNumber(analysis.institutionCount, condition.value, condition.op);
    case 'domain_count':
      return compareNumber(analysis.domainCount, condition.value, condition.op);
    case 'level_count':
      return compareNumber(analysis.levelCount, condition.value, condition.op);
    case 'has_institution':
      return analysis.qualifiedInstitutionIds.includes(condition.value);
    case 'has_region':
      return analysis.qualifiedRegionIds.includes(condition.value);
  }
}

/** @param condition 世界事实条件 @param context 评估上下文 @returns 是否满足条件 */
export function evaluateFactCondition(
  condition: Extract<ConditionExpression, { fact: string }>,
  context: ConditionEvaluationContext,
): boolean {
  const actual = context.state.world.facts[condition.fact];
  if (condition.op === 'is_true') return actual === true;
  if (condition.op === 'is_false') return actual === false || actual === undefined;
  if (condition.op === 'eq') return actual === condition.value;
  return condition.op === 'neq' && actual !== condition.value;
}

/** @param condition 世界指标条件 @param context 评估上下文 @returns 是否满足条件 */
export function evaluateWorldMetricCondition(
  condition: Extract<ConditionExpression, { worldMetric: string }>,
  context: ConditionEvaluationContext,
): boolean {
  return compareNumber(
    context.state.world.metrics[condition.worldMetric] ?? 0,
    condition.value,
    condition.op,
  );
}
