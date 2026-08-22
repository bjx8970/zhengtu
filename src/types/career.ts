/**
 * 职业领域跨层共享类型。
 *
 * 收纳职业 Engine 与 Store 事务共同使用、但不属于持久化存档的数据契约。
 */

import type { CivilServiceRank } from '../domain/career/types';

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
