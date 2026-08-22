/**
 * 年度公务员职级职数生产器。
 *
 * 根据当前职级的相邻晋升规则和年度考核等次计算下一职级库存，
 * 不读取或修改 Store。
 */

import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import type { AnnualRankQuotaGrant } from '../../types/career';
import type { KPITier } from '../../types/enums';

/**
 * 按年度考核结果生产当前职级的下一等级职数。
 *
 * @param rule 当前职级的相邻晋升规则；最高职级可为空
 * @param assessmentTier 本次年度考核等次
 * @param currentValue 当前职数库存
 * @returns 职数生产结果；无职数规则时返回 null
 */
export function grantAnnualCivilServiceRankQuota(
  rule: CivilServiceRankProgressionRule | null,
  assessmentTier: KPITier,
  currentValue: number,
): AnnualRankQuotaGrant | null {
  const quota = rule?.quotaRequirement;
  if (!quota) return null;
  const previousValue = Number.isFinite(currentValue) ? Math.max(0, currentValue) : 0;
  const boundedPrevious = Math.min(previousValue, quota.maxValue);
  const assessmentEligible = quota.grantAssessmentTiers.includes(assessmentTier);
  const nextValue = assessmentEligible
    ? Math.min(boundedPrevious + quota.annualGrant, quota.maxValue)
    : boundedPrevious;
  return {
    metricId: quota.metricId,
    previousValue,
    currentValue: nextValue,
    grantedValue: Math.max(nextValue - boundedPrevious, 0),
    assessmentEligible,
  };
}
