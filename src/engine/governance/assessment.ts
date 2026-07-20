/**
 * 年度考核引擎
 *
 * 核心职责：
 * 1. 基于五维综合评分 + 等次生成年度评价
 * 2. 判断晋升资格（优秀/称职 → eligible）
 * 3. 处理不合格处罚（冻结晋升届数从配置读取）
 *
 * 纯函数，所有依赖通过参数传入。
 */

import type { GameConfig } from '../../types/config';
import { KPITier } from '../../types/enums';

/**
 * 执行年度考核。
 *
 * @param comprehensiveScore 五维综合评分
 * @param tier               考核等次
 * @param yearsInPosition    当前岗位年限
 * @param config             游戏配置常量
 * @returns 考核得分 + 等次 + 晋升资格 + 冻结周期 + 说明
 */
export function annualAssessment(
  comprehensiveScore: number,
  tier: KPITier,
  yearsInPosition: number,
  config: GameConfig,
): {
  score: number;
  tier: KPITier;
  promotionEligible: boolean;
  frozenPeriods: number;
  consequence: string;
} {
  let frozenPeriods = 0;
  let consequence = '';

  if (tier === KPITier.Incompetent) {
    frozenPeriods = config.incompetentFrozenPeriods;
    consequence = `年度考核不合格，在岗${yearsInPosition}年首次触发，晋升冻结${frozenPeriods}届`;
  } else if (tier === KPITier.Basic) {
    consequence = '年度考核基本称职，不影响晋升资格';
  }

  const promotionEligible = tier === KPITier.Excellent || tier === KPITier.Competent;

  return {
    score: comprehensiveScore,
    tier,
    promotionEligible,
    frozenPeriods,
    consequence,
  };
}

/**
 * 判断是否连续不合格（需降级或加重处罚）。
 *
 * @param assessmentHistory    历史考核结果列表
 * @param requiredConsecutive  连续不合格的阈值
 * @returns 是否连续不合格
 */
export function isConsecutiveFailure(
  assessmentHistory: { tier: KPITier }[],
  requiredConsecutive: number,
): boolean {
  const recent = assessmentHistory.slice(-requiredConsecutive);
  return (
    recent.length >= requiredConsecutive && recent.every((a) => a.tier === KPITier.Incompetent)
  );
}
