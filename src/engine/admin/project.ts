/**
 * 行政线专属引擎 — 项目管理系统
 *
 * 提供基础设施建设项目的进度追踪和里程碑判定：
 * 1. 项目进度计算 — 审批耗时 × 资金到位率 × 人力配置
 * 2. 里程碑判定 — 进度达到阈值时触发事件
 * 3. 烂尾风险评估 — 资金链断裂或政策变动导致项目停滞
 *
 * 所有函数为纯函数，依赖通过参数注入。
 */

import { ProjectMilestone } from '../../types/enums';
import type { AdminLineConfig } from '../../types/config';

/** 项目里程碑的进度阈值 */
const MILESTONE_THRESHOLDS: Record<ProjectMilestone, number> = {
  [ProjectMilestone.Groundbreaking]: 0,
  [ProjectMilestone.MidConstruction]: 0.3,
  [ProjectMilestone.ToppedOff]: 0.6,
  [ProjectMilestone.Completed]: 1.0,
  // 烂尾不属于"进度阈值"，通过单独函数判定
  [ProjectMilestone.Abandoned]: -1,
};

/**
 * 计算项目完成进度。
 *
 * 公式：min(审批天数 / 120, 1.0) × 资金到位率 × 人力配置系数
 * > 120 天视为审批已充分完成。
 *
 * @param approvalDays 已审批耗时（天）
 * @param budgetRatio  资金到位率（0~1）
 * @param staffing     人力配置系数（0~1，1 为满编）
 * @returns 项目进度（0.0 ~ 1.0）
 */
export function calculateProjectProgress(
  approvalDays: number,
  budgetRatio: number,
  staffing: number,
): number {
  const approvalFactor = Math.min(approvalDays / 120, 1.0);
  return Math.min(approvalFactor * Math.max(budgetRatio, 0) * Math.max(staffing, 0), 1.0);
}

/**
 * 判定当前进度所处的最新里程碑。
 *
 * 逐级下调匹配：从 Completed 往下找第一个进度 >= 阈值的阶段。
 *
 * @param progress 项目进度（0~1）
 * @returns 当前里程碑阶段
 */
export function resolveProjectMilestone(progress: number): ProjectMilestone {
  if (progress >= 1.0) return ProjectMilestone.Completed;
  // 安全：MILESTONE_THRESHOLDS 对所有非 Abandoned 枚举值均有定义
  if (progress >= MILESTONE_THRESHOLDS[ProjectMilestone.ToppedOff]!)
    return ProjectMilestone.ToppedOff;
  if (progress >= MILESTONE_THRESHOLDS[ProjectMilestone.MidConstruction]!)
    return ProjectMilestone.MidConstruction;
  return ProjectMilestone.Groundbreaking;
}

/**
 * 判断项目是否已进入烂尾风险区。
 *
 * 烂尾判定逻辑：
 * - 资金到位率 < 0.3 且进度 < 0.5 → 资金链断裂风险
 * - 进度停滞（current == previous）且审批超过 180 天 → 政策搁置风险
 *
 * @param progress         当前进度
 * @param previousProgress 上一周期的进度
 * @param budgetRatio      资金到位率
 * @param approvalDays     审批天数
 * @returns 是否烂尾
 */
export function isAbandoned(
  progress: number,
  previousProgress: number,
  budgetRatio: number,
  approvalDays: number,
): boolean {
  // 已完成的不会烂尾
  if (progress >= 1.0) return false;

  // 资金链断裂：资金不足 30% 且进度不到一半
  if (budgetRatio < 0.3 && progress < 0.5) return true;

  // 政策搁置：停滞超过 180 天且进度仍低于 30%
  if (progress === previousProgress && approvalDays > 180 && progress < 0.3) return true;

  return false;
}

/**
 * 计算单次时间推进后的项目进度增量。
 *
 * 每推进一天，项目管理产生以下增量：
 * - 基础推进率（取自 config.projectCompletionBaseRate）
 * - 乘以资金到位率和人力配置
 *
 * @param currentProgress   当前进度
 * @param budgetRatio      资金到位率
 * @param staffing         人力配置
 * @param config           行政线配置常量
 * @returns 新进度
 */
export function advanceProjectProgress(
  currentProgress: number,
  budgetRatio: number,
  staffing: number,
  config: AdminLineConfig,
): number {
  if (currentProgress >= 1.0) return 1.0;
  const increment = config.projectCompletionBaseRate * budgetRatio * staffing;
  return Math.min(currentProgress + increment, 1.0);
}
