/**
 * 职业领域跨层共享类型。
 *
 * 收纳职业 Engine 与 Store 事务共同使用、但不属于持久化存档的数据契约。
 */

import type { CivilServiceRank } from '../domain/career/types';
import type { CareerOpportunity } from '../domain/career/state';
import type { CareerExperienceQualificationRules } from './config';
import type { PlayerSave } from './player';
import type { PositionConfigV2 } from './position-v2';

/** 职业机会接受或任职复核失败原因。 */
export type CareerOpportunityEligibilityFailure =
  | 'opportunity_unavailable'
  | 'opportunity_expired'
  | 'active_process'
  | 'running_work'
  | 'blocking_event'
  | 'pending_continuation'
  | 'opportunity_conditions'
  | 'target_missing'
  | 'target_snapshot_mismatch'
  | 'target_vacant'
  | 'same_position'
  | 'appointment_restriction'
  | 'target_conditions';

/** 职业机会资格判定结果。 */
export interface CareerOpportunityEligibilityResult {
  eligible: boolean;
  failure: CareerOpportunityEligibilityFailure | null;
}

/** 职业机会资格判定输入。 */
export interface CareerOpportunityEligibilityInput {
  opportunity: CareerOpportunity;
  state: Readonly<PlayerSave>;
  currentDay: number;
  daysPerYear: number;
  targetPosition: PositionConfigV2 | null;
  careerExperienceQualificationRules: Readonly<CareerExperienceQualificationRules>;
}

/** 选拔阶段的纯结算结果。 */
export interface CareerSelectionSettlement {
  outcome: 'passed' | 'failed' | 'continued';
  score: number | null;
  detail: string;
}

/** 公务员职级晋升资格失败原因。 */
export type RankEligibilityFailure =
  | 'no_progression_rule'
  | 'already_highest_rank'
  | 'rule_source_mismatch'
  | 'probation_active'
  | 'probation_failed'
  | 'insufficient_days_in_rank'
  | 'insufficient_service_days'
  | 'insufficient_assessments'
  | 'insufficient_qualified_assessments'
  | 'insufficient_excellent_assessments'
  | 'rank_advancement_frozen'
  | 'disciplinary_restriction'
  | 'quota_unavailable'
  | 'additional_condition_failed';

/** 公务员职级晋升资格判定结果。 */
export interface RankEligibilityResult {
  eligible: boolean;
  fromRank: CivilServiceRank;
  toRank: CivilServiceRank | null;
  failures: { reason: RankEligibilityFailure; detail: string }[];
  evaluatedAtDay: number;
}

/** 年度职数生产结果。 */
export interface AnnualRankQuotaGrant {
  /** 下一职级的世界指标 ID。 */
  metricId: string;
  /** 生产前库存。 */
  previousValue: number;
  /** 封顶后的生产后库存。 */
  currentValue: number;
  /** 本次实际新增库存。 */
  grantedValue: number;
  /** 考核等次是否允许发放。 */
  assessmentEligible: boolean;
}
