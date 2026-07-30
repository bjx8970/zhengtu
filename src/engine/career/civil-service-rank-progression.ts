/** 公务员职级晋升纯函数：重评资格并生成不可变结算结果。 */
import type { CivilServiceRankChangeRecord } from '../../domain/career/state';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import type { PlayerSave } from '../../types/player';
import type { CareerExperienceQualificationRules } from '../../types/config';
import {
  evaluateCivilServiceRankEligibility,
  type RankEligibilityFailure,
  type RankEligibilityResult,
} from './civil-service-rank-eligibility';

export interface AdvanceCivilServiceRankParams {
  state: Readonly<PlayerSave>;
  currentDay: number;
  daysPerYear: number;
  careerExperienceQualificationRules?: Readonly<CareerExperienceQualificationRules>;
  rule: CivilServiceRankProgressionRule;
  idFactory: () => string;
  sourceType: 'assessment' | 'event' | 'policy' | 'system';
  sourceId?: string | null;
  sourceAssessmentYear?: number | null;
}
export type AdvanceCivilServiceRankResult =
  | {
      success: true;
      previousRank: CivilServiceRankChangeRecord['previousRank'];
      currentRank: CivilServiceRankChangeRecord['currentRank'];
      changedAtDay: number;
      historyRecord: CivilServiceRankChangeRecord;
      quotaMetricId: string | null;
      quotaPreviousValue: number | null;
      quotaCurrentValue: number | null;
      emittedSignals: DomainSignalSnapshot[];
    }
  | { success: false; reason: RankEligibilityFailure; eligibility: RankEligibilityResult };

/** @param params 晋升结算参数 @returns 纯函数结算结果，不修改输入状态。 */
export function advanceCivilServiceRank(
  params: AdvanceCivilServiceRankParams,
): AdvanceCivilServiceRankResult {
  const eligibility = evaluateCivilServiceRankEligibility(
    params.state,
    params.currentDay,
    params.daysPerYear,
    params.rule,
    params.careerExperienceQualificationRules,
  );
  if (!eligibility.eligible || eligibility.toRank === null)
    return {
      success: false,
      reason: eligibility.failures[0]?.reason ?? 'no_progression_rule',
      eligibility,
    };
  const previousRank = params.state.career.civilServiceRank;
  const id = params.idFactory();
  const historyRecord: CivilServiceRankChangeRecord = {
    id,
    previousRank,
    currentRank: eligibility.toRank,
    changedAtDay: params.currentDay,
    reason: 'regular_advancement',
    sourceType: params.sourceType,
    sourceId: params.sourceId ?? null,
    sourceAssessmentYear: params.sourceAssessmentYear ?? null,
  };
  const quota = params.rule.quotaRequirement;
  const quotaPreviousValue: number | null = quota
    ? (params.state.world.metrics[quota.metricId] ?? 0)
    : null;
  if (quota && quotaPreviousValue !== null && quotaPreviousValue < quota.consumeValue)
    return {
      success: false,
      reason: 'quota_unavailable',
      eligibility: {
        ...eligibility,
        eligible: false,
        failures: [{ reason: 'quota_unavailable', detail: 'Quota would become negative' }],
      },
    };
  return {
    success: true,
    previousRank,
    currentRank: eligibility.toRank,
    changedAtDay: params.currentDay,
    historyRecord,
    quotaMetricId: quota?.metricId ?? null,
    quotaPreviousValue,
    quotaCurrentValue:
      quota && quotaPreviousValue !== null ? quotaPreviousValue - quota.consumeValue : null,
    emittedSignals: [
      {
        signalId: params.idFactory(),
        signalType: 'civil_service_rank.changed',
        occurredAtDay: params.currentDay,
        data: {
          rankChangeId: id,
          previousRank,
          currentRank: eligibility.toRank,
          reason: historyRecord.reason,
          sourceType: historyRecord.sourceType,
          sourceId: historyRecord.sourceId,
        },
      },
    ],
  };
}
