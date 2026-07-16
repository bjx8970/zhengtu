/**
 * 年度考核引擎
 *
 * 核心职责：
 * 1. 基于 KPI 考核结果生成年度评价
 * 2. 判断晋升资格（优秀/称职 → eligible）
 * 3. 处理不合格处罚（冻结晋升一届）
 *
 * 纯函数，所有依赖通过参数传入。
 */

import type { AssessmentResult } from '../../types/game';
import { KPITier } from '../../types/enums';

/**
 * 执行年度考核。
 *
 * 基于 KPI 计算结果的等次，输出晋升资格和冻结处罚。
 *
 * @param kpiResult          KPI 计算结果
 * @param yearsInPosition    当前岗位年限
 * @returns 考核得分 + 等次 + 是否具备晋升资格 + 冻结周期 + 说明
 */
export function annualAssessment(
  kpiResult: AssessmentResult,
  yearsInPosition: number,
): {
  score: number;
  tier: KPITier;
  promotionEligible: boolean;
  frozenPeriods: number;
  consequence: string;
} {
  const { totalScore, tier } = kpiResult;

  let frozenPeriods = 0;
  let consequence = '';

  if (tier === KPITier.Incompetent) {
    frozenPeriods = 1;
    consequence = `年度考核不合格，在岗${yearsInPosition}年首次触发，晋升冻结一届`;
  } else if (tier === KPITier.Basic) {
    consequence = '年度考核基本称职，不影响晋升资格';
  }

  const promotionEligible = tier === KPITier.Excellent || tier === KPITier.Competent;

  return {
    score: totalScore,
    tier,
    promotionEligible,
    frozenPeriods,
    consequence,
  };
}

/**
 * 判断是否连续不合格（需降级或加重处罚）。
 *
 * @param assessmentHistory 历史考核结果列表
 * @param requiredConsecutive 连续不合格的阈值（默认 2）
 * @returns 是否连续不合格
 */
export function isConsecutiveFailure(
  assessmentHistory: { tier: string }[],
  requiredConsecutive = 2,
): boolean {
  const recent = assessmentHistory.slice(-requiredConsecutive);
  return (
    recent.length >= requiredConsecutive && recent.every((a) => a.tier === KPITier.Incompetent)
  );
}
