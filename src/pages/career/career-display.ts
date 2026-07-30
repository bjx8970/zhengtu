/**
 * 职业页面展示常量与纯格式化函数。
 *
 * 将职业领域的稳定枚举转换为中文文案，供职业页和工作台复用，
 * 不参与资格判断或状态变更。
 */

import type { CareerProcessStage } from '../../domain/career/state';
import type { CareerOpportunityStatus, CareerRestrictionType } from '../../domain/career/types';
import type { RankEligibilityFailure } from '../../engine/career/civil-service-rank-eligibility';

/** 机构配置中使用的虚构地区标识的显示名称。 */
const REGION_LABELS: Record<string, string> = {
  region_qingyun_town: '青云镇',
  region_heping_subdistrict: '和平街道',
  region_yongning_county: '永宁县',
  region_jinjiang_district: '锦江区',
  region_lingchuan_city: '陵川市',
  region_jiangyuan_province: '江原省',
  region_capital: '首都',
};

const OPPORTUNITY_STATUS_LABELS: Record<CareerOpportunityStatus, string> = {
  available: '待处理',
  accepted: '已接受',
  rejected: '已拒绝',
  expired: '已过期',
  in_process: '选拔进行中',
  resolved: '已完成',
  cancelled: '已取消',
};

const OPPORTUNITY_SOURCE_LABELS = {
  assessment: '年度考核',
  political_cycle: '政治周期',
  event: '事件',
  policy: '政策',
  vacancy: '岗位空缺',
  system: '系统',
} as const;

const PROCESS_STAGE_LABELS: Record<CareerProcessStage, string> = {
  eligibility_review: '资格审查',
  democratic_recommendation: '民主推荐',
  organization_inspection: '组织考察',
  collective_decision: '集体决定',
  public_notice: '公示',
  appointment: '任职',
  probation: '试用',
  finalization: '完成',
};

const RESTRICTION_LABELS: Record<CareerRestrictionType, string> = {
  rank_advancement_freeze: '职级晋升冻结',
  appointment_selection_freeze: '任职选拔冻结',
  disciplinary_action: '处分限制',
};

const RANK_FAILURE_LABELS: Record<RankEligibilityFailure, string> = {
  no_progression_rule: '当前职级尚未配置晋升规则',
  already_highest_rank: '已处于最高职级',
  rule_source_mismatch: '当前职级与晋升规则不一致',
  insufficient_days_in_rank: '当前职级任职天数不足',
  insufficient_service_days: '累计服务天数不足',
  insufficient_assessments: '年度考核次数不足',
  insufficient_qualified_assessments: '称职及以上考核次数不足',
  insufficient_excellent_assessments: '优秀考核次数不足',
  rank_advancement_frozen: '当前处于职级晋升冻结期',
  disciplinary_restriction: '存在生效中的处分限制',
  quota_unavailable: '对应职级暂无可用职数',
  additional_condition_failed: '未满足附加晋升条件',
};

/**
 * @param regionId 稳定地区标识
 * @returns 适合界面显示的地区名称；未知标识保留原值以便排查配置。
 */
export function formatCareerRegion(regionId: string): string {
  return REGION_LABELS[regionId] ?? regionId;
}

/**
 * @param status 职业机会状态
 * @returns 中文状态名称。
 */
export function formatOpportunityStatus(status: CareerOpportunityStatus): string {
  return OPPORTUNITY_STATUS_LABELS[status] ?? status;
}

/**
 * @param sourceType 职业机会来源类型
 * @returns 中文来源名称。
 */
export function formatOpportunitySource(
  sourceType: keyof typeof OPPORTUNITY_SOURCE_LABELS,
): string {
  return OPPORTUNITY_SOURCE_LABELS[sourceType];
}

/**
 * @param stage 职业流程阶段
 * @returns 中文阶段名称。
 */
export function formatCareerProcessStage(stage: CareerProcessStage): string {
  return PROCESS_STAGE_LABELS[stage];
}

/**
 * @param type 职业限制类型
 * @returns 中文限制名称。
 */
export function formatCareerRestriction(type: CareerRestrictionType): string {
  return RESTRICTION_LABELS[type];
}

/**
 * @param reason 职级资格未满足原因
 * @returns 中文原因名称。
 */
export function formatRankFailure(reason: RankEligibilityFailure): string {
  return RANK_FAILURE_LABELS[reason];
}
