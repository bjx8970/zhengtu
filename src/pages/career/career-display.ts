/**
 * 职业页面展示常量与纯格式化函数。
 *
 * 将职业领域的稳定枚举转换为中文文案，供职业页和工作台复用，
 * 不参与资格判断或状态变更。
 */

import {
  type CareerProcessStage,
  type RelativeSelectionStage,
  type SelectionFailure,
} from '../../domain/career/state';
import type { CareerOpportunityStatus, CareerRestrictionType } from '../../domain/career/types';
import type {
  CareerOpportunityEligibilityFailure,
  RankEligibilityFailure,
} from '../../types/career';

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
  appointment: '任职决定',
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
  probation_active: '录用试用期尚未结束',
  probation_failed: '录用试用期未通过',
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

const OPPORTUNITY_ELIGIBILITY_FAILURE_LABELS: Record<CareerOpportunityEligibilityFailure, string> =
  {
    opportunity_unavailable: '机会当前不可接受',
    opportunity_expired: '机会已到期',
    active_process: '已有进行中的职业流程',
    running_work: '请先完成进行中的工作',
    blocking_event: '存在待处理的阻塞事件',
    pending_continuation: '请先完成当前时间推进',
    opportunity_conditions: '未满足机会资格条件',
    target_missing: '目标岗位配置不存在',
    target_snapshot_mismatch: '目标岗位信息已变更',
    target_vacant: '目标岗位暂无空缺',
    same_position: '当前已在目标岗位',
    appointment_restriction: '存在任职选拔限制',
    target_conditions: '未满足目标岗位任职条件',
  };

/** 固定相对选拔六阶段的中文名称。 */
export const RELATIVE_SELECTION_STAGE_LABELS: Record<RelativeSelectionStage, string> = {
  eligibility_review: '资格审查',
  democratic_recommendation: '民主推荐',
  organization_inspection: '组织考察',
  collective_decision: '集体决定',
  public_notice: '公示',
  appointment: '任职决定',
};

const SELECTION_OUTCOME_LABELS = {
  in_progress: '选拔进行中',
  appointed: '获选',
  not_selected: '落选',
  no_candidates: '无合格候选人',
  selection_failed: '选拔失败',
} as const;

const SELECTION_FAILURE_LABELS: Record<SelectionFailure['code'], string> = {
  no_qualified_candidates: '没有符合资格的候选人',
  stage_no_survivors: '本阶段没有幸存候选人',
  no_unique_winner: '最高分候选人并列，无法产生唯一赢家',
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
 * @param stage 固定相对选拔阶段
 * @returns 阶段中文名称
 */
export function formatRelativeSelectionStage(stage: RelativeSelectionStage): string {
  return RELATIVE_SELECTION_STAGE_LABELS[stage] ?? stage;
}

/**
 * @param outcome 相对选拔结果字面量
 * @returns 结果中文名称
 */
export function formatSelectionOutcome(outcome: keyof typeof SELECTION_OUTCOME_LABELS): string {
  return SELECTION_OUTCOME_LABELS[outcome] ?? outcome;
}

/**
 * @param failure 结构化选拔失败原因
 * @returns 失败原因中文名称；空值返回空字符串
 */
export function formatSelectionFailure(failure: SelectionFailure | null | undefined): string {
  if (!failure) return '';
  return SELECTION_FAILURE_LABELS[failure.code] ?? failure.detail;
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

/**
 * @param reason 职业机会资格未满足原因
 * @returns 用于界面展示的中文原因
 */
export function formatOpportunityEligibilityFailure(
  reason: CareerOpportunityEligibilityFailure,
): string {
  return OPPORTUNITY_ELIGIBILITY_FAILURE_LABELS[reason];
}
