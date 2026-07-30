/** 公务员职级资格与职业限制纯函数。 */

import type {
  CareerExperience,
  CareerRestriction,
  CurrentAppointment,
} from '../../domain/career/state';
import type { CivilServiceRank } from '../../domain/career/types';
import { CIVIL_SERVICE_RANKS } from '../../domain/career/types';
import { evaluateCondition } from '../events/condition-interpreter';
import type { PlayerSave } from '../../types/player';
import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import type { CareerExperienceQualificationRules } from '../../types/config';

export type RankEligibilityFailure =
  | 'no_progression_rule'
  | 'already_highest_rank'
  | 'rule_source_mismatch'
  | 'insufficient_days_in_rank'
  | 'insufficient_service_days'
  | 'insufficient_assessments'
  | 'insufficient_qualified_assessments'
  | 'insufficient_excellent_assessments'
  | 'rank_advancement_frozen'
  | 'disciplinary_restriction'
  | 'quota_unavailable'
  | 'additional_condition_failed';

export interface RankEligibilityResult {
  eligible: boolean;
  fromRank: CivilServiceRank;
  toRank: CivilServiceRank | null;
  failures: { reason: RankEligibilityFailure; detail: string }[];
  evaluatedAtDay: number;
}

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

/** @param appointment 当前任职 @param experiences 历史履历 @param currentDay 当前绝对日 @returns 去重后的职业服务天数。 */
export function calculateCareerServiceDays(
  appointment: CurrentAppointment,
  experiences: readonly CareerExperience[],
  currentDay: number,
): number {
  const intervals = [
    ...experiences.map((item) => [item.startedAtDay, item.endedAtDay ?? currentDay] as const),
    [appointment.startedAtDay, currentDay] as const,
  ]
    .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && end >= start)
    .sort(([left], [right]) => left - right);
  let total = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (const [nextStart, nextEnd] of intervals) {
    if (start === null || end === null) {
      start = nextStart;
      end = nextEnd;
      continue;
    }
    if (nextStart > end) {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    } else {
      end = Math.max(end, nextEnd);
    }
  }
  return start === null || end === null ? 0 : total + end - start;
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
  if (currentDay - state.career.civilServiceRankStartedAtDay < rule.minDaysInRank)
    add('insufficient_days_in_rank', 'Insufficient days in rank');
  if (
    calculateCareerServiceDays(state.career.appointment, state.career.experiences, currentDay) <
    rule.minServiceDays
  )
    add('insufficient_service_days', 'Insufficient career service days');
  const assessments = state.assessments.annualAssessments;
  if (assessments.length < rule.minAssessmentCount)
    add('insufficient_assessments', 'Insufficient assessments');
  if (
    assessments.filter((item) => isQualifiedAssessmentTier(item.tier)).length <
    rule.minQualifiedAssessmentCount
  )
    add('insufficient_qualified_assessments', 'Insufficient qualified assessments');
  if (
    assessments.filter((item) => isExcellentAssessmentTier(item.tier)).length <
    rule.minExcellentAssessmentCount
  )
    add('insufficient_excellent_assessments', 'Insufficient excellent assessments');
  const restrictions = getActiveCareerRestrictions(state.career.restrictions, currentDay);
  if (restrictions.some((item) => item.type === 'rank_advancement_freeze'))
    add('rank_advancement_frozen', 'Rank advancement is frozen');
  if (restrictions.some((item) => item.type === 'disciplinary_action'))
    add('disciplinary_restriction', 'An active disciplinary restriction exists');
  if (
    rule.quotaRequirement &&
    (state.world.metrics[rule.quotaRequirement.metricId] ?? 0) < rule.quotaRequirement.requiredValue
  )
    add('quota_unavailable', 'Rank quota unavailable');
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
    add('additional_condition_failed', 'Additional conditions failed');
  return {
    eligible: failures.length === 0,
    fromRank,
    toRank: rule.toRank,
    failures,
    evaluatedAtDay: currentDay,
  };
}
