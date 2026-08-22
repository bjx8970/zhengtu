/** 公务员职级资格与职业限制纯函数。 */

import type { CareerRestriction } from '../../domain/career/state';
import { CIVIL_SERVICE_RANKS } from '../../domain/career/types';
import { evaluateCondition } from '../events/condition-interpreter';
import type { PlayerSave } from '../../types/player';
import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import type { CareerExperienceQualificationRules } from '../../types/config';
import type { RankEligibilityFailure, RankEligibilityResult } from '../../types/career';
import { calculateCareerServiceDays } from './career-service';

/** @param restrictions 全部持久化限制 @param currentDay 当前绝对日 @returns 当前有效的限制。 */
export function getActiveCareerRestrictions(
  restrictions: readonly CareerRestriction[],
  currentDay: number,
): CareerRestriction[] {
  return restrictions.filter(
    (restriction) =>
      restriction.startedAtDay <= currentDay &&
      (restriction.endsAtDay === null || currentDay < restriction.endsAtDay),
  );
}

/** @param tier 年度考核等次 @returns 是否为称职及以上。 */
export function isQualifiedAssessmentTier(tier: string): boolean {
  return tier === '优秀' || tier === '称职';
}
/** @param tier 年度考核等次 @returns 是否为优秀。 */
export function isExcellentAssessmentTier(tier: string): boolean {
  return tier === '优秀';
}

/** @param state 只读存档 @param currentDay 当前绝对日 @param daysPerYear 每年游戏天数 @param rule 当前职级规则 @returns 完整资格评估。 */
export function evaluateCivilServiceRankEligibility(
  state: Readonly<PlayerSave>,
  currentDay: number,
  daysPerYear: number,
  rule: CivilServiceRankProgressionRule | null,
  careerExperienceQualificationRules?: Readonly<CareerExperienceQualificationRules>,
): RankEligibilityResult {
  const fromRank = state.career.civilServiceRank;
  const failures: RankEligibilityResult['failures'] = [];
  if (!rule)
    return {
      eligible: false,
      fromRank,
      toRank: null,
      failures: [
        {
          reason:
            fromRank === CIVIL_SERVICE_RANKS[CIVIL_SERVICE_RANKS.length - 1]
              ? 'already_highest_rank'
              : 'no_progression_rule',
          detail: 'No configured progression rule',
        },
      ],
      evaluatedAtDay: currentDay,
    };
  if (rule.fromRank !== fromRank)
    return {
      eligible: false,
      fromRank,
      toRank: null,
      failures: [
        { reason: 'rule_source_mismatch', detail: 'Rule source rank does not match state' },
      ],
      evaluatedAtDay: currentDay,
    };
  const add = (reason: RankEligibilityFailure, detail: string) => failures.push({ reason, detail });
  const probation = state.career.appointment.probation;
  if (probation?.status === 'active') add('probation_active', '录用试用期尚未结束');
  if (probation?.status === 'failed') add('probation_failed', '录用试用期未通过');
  const daysInRank = Math.max(currentDay - state.career.civilServiceRankStartedAtDay, 0);
  if (daysInRank < rule.minDaysInRank)
    add('insufficient_days_in_rank', `当前 ${daysInRank} 天，要求 ${rule.minDaysInRank} 天`);
  const serviceDays = calculateCareerServiceDays(
    state.career.appointment,
    state.career.experiences,
    currentDay,
  );
  if (serviceDays < rule.minServiceDays)
    add('insufficient_service_days', `当前 ${serviceDays} 天，要求 ${rule.minServiceDays} 天`);
  const assessments = state.assessments.annualAssessments;
  const qualifiedAssessments = assessments.filter((item) =>
    isQualifiedAssessmentTier(item.tier),
  ).length;
  const excellentAssessments = assessments.filter((item) =>
    isExcellentAssessmentTier(item.tier),
  ).length;
  if (assessments.length < rule.minAssessmentCount)
    add(
      'insufficient_assessments',
      `当前 ${assessments.length} 次，要求 ${rule.minAssessmentCount} 次`,
    );
  if (qualifiedAssessments < rule.minQualifiedAssessmentCount)
    add(
      'insufficient_qualified_assessments',
      `当前 ${qualifiedAssessments} 次，要求 ${rule.minQualifiedAssessmentCount} 次`,
    );
  if (excellentAssessments < rule.minExcellentAssessmentCount)
    add(
      'insufficient_excellent_assessments',
      `当前 ${excellentAssessments} 次，要求 ${rule.minExcellentAssessmentCount} 次`,
    );
  const restrictions = getActiveCareerRestrictions(state.career.restrictions, currentDay);
  if (restrictions.some((item) => item.type === 'rank_advancement_freeze'))
    add('rank_advancement_frozen', '存在生效中的职级晋升冻结');
  if (restrictions.some((item) => item.type === 'disciplinary_action'))
    add('disciplinary_restriction', '存在生效中的处分限制');
  if (rule.quotaRequirement) {
    const quotaValue = state.world.metrics[rule.quotaRequirement.metricId] ?? 0;
    if (quotaValue < rule.quotaRequirement.requiredValue)
      add(
        'quota_unavailable',
        `当前库存 ${quotaValue}，要求 ${rule.quotaRequirement.requiredValue}`,
      );
  }
  // Rank rules intentionally reject signalField conditions: eligibility is derived
  // from durable career and assessment state, not a transient event payload.
  const signal = {
    signalId: 'rank-eligibility',
    signalType: 'assessment.completed' as const,
    occurredAtDay: currentDay,
    data: { year: 0, score: 0, tier: '' },
  };
  if (
    !rule.additionalConditions.every((condition) =>
      evaluateCondition(condition, {
        state,
        currentDay,
        daysPerYear,
        signal,
        careerExperienceQualificationRules,
      }),
    )
  )
    add('additional_condition_failed', '未满足配置的附加晋升条件');
  return {
    eligible: failures.length === 0,
    fromRank,
    toRank: rule.toRank,
    failures,
    evaluatedAtDay: currentDay,
  };
}
