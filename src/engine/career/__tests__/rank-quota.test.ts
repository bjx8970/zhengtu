/** 年度公务员职级职数生产器测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import { KPITier } from '../../../types/enums';
import { grantAnnualCivilServiceRankQuota } from '../rank-quota';

describe('grantAnnualCivilServiceRankQuota', () => {
  const rule = getConfigLoader().getCivilServiceRankProgressionRule('clerk_2');

  it('grants one next-rank quota for a qualified assessment', () => {
    expect(grantAnnualCivilServiceRankQuota(rule, KPITier.Competent, 0)).toEqual({
      metricId: 'rank_quota.clerk_1',
      previousValue: 0,
      currentValue: 1,
      grantedValue: 1,
      assessmentEligible: true,
    });
  });

  it('caps quota stock at the configured maximum', () => {
    expect(grantAnnualCivilServiceRankQuota(rule, KPITier.Excellent, 1)).toMatchObject({
      previousValue: 1,
      currentValue: 1,
      grantedValue: 0,
      assessmentEligible: true,
    });
  });

  it('does not grant quota for a non-qualified assessment', () => {
    expect(grantAnnualCivilServiceRankQuota(rule, KPITier.Basic, 0)).toMatchObject({
      previousValue: 0,
      currentValue: 0,
      grantedValue: 0,
      assessmentEligible: false,
    });
  });

  it('returns null when the current rank has no quota-bearing progression rule', () => {
    expect(grantAnnualCivilServiceRankQuota(null, KPITier.Excellent, 0)).toBeNull();
  });
});
