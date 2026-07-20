import { describe, it, expect } from 'vitest';
import { annualAssessment, isConsecutiveFailure } from '../assessment';
import { getConfigLoader } from '../../../config/loader';
import { KPITier } from '../../../types/enums';

const cfg = getConfigLoader().getGameConfig();

describe('annualAssessment', () => {
  describe('优秀 (≥90)', () => {
    it('晋升资格 true，无冻结', () => {
      const result = annualAssessment(95, KPITier.Excellent, 3, cfg);
      expect(result.score).toBe(95);
      expect(result.tier).toBe(KPITier.Excellent);
      expect(result.promotionEligible).toBe(true);
      expect(result.frozenPeriods).toBe(0);
    });
  });

  describe('称职 (≥75)', () => {
    it('晋升资格 true，无冻结', () => {
      const result = annualAssessment(80, KPITier.Competent, 2, cfg);
      expect(result.promotionEligible).toBe(true);
      expect(result.frozenPeriods).toBe(0);
    });
  });

  describe('基本称职 (≥60)', () => {
    it('晋升资格 false，无冻结', () => {
      const result = annualAssessment(65, KPITier.Basic, 1, cfg);
      expect(result.tier).toBe(KPITier.Basic);
      expect(result.promotionEligible).toBe(false);
      expect(result.frozenPeriods).toBe(0);
      expect(result.consequence).toContain('基本称职');
    });
  });

  describe('不称职 (<60)', () => {
    it('晋升资格 false，冻结 1 届', () => {
      const result = annualAssessment(40, KPITier.Incompetent, 2, cfg);
      expect(result.tier).toBe(KPITier.Incompetent);
      expect(result.promotionEligible).toBe(false);
      expect(result.frozenPeriods).toBe(1);
      expect(result.consequence).toContain('冻结');
    });
  });
});

describe('isConsecutiveFailure', () => {
  it('连续 2 次不称职 → true', () => {
    const history = [{ tier: KPITier.Incompetent }, { tier: KPITier.Incompetent }];
    expect(isConsecutiveFailure(history, 2)).toBe(true);
  });

  it('不连续不称职 → false', () => {
    const history = [
      { tier: KPITier.Incompetent },
      { tier: KPITier.Competent },
      { tier: KPITier.Incompetent },
    ];
    expect(isConsecutiveFailure(history, 2)).toBe(false);
  });

  it('历史不足 2 条 → false', () => {
    const history = [{ tier: KPITier.Incompetent }];
    expect(isConsecutiveFailure(history, 2)).toBe(false);
  });

  it('空历史 → false', () => {
    expect(isConsecutiveFailure([], 2)).toBe(false);
  });

  it('自定义连续阈值 3', () => {
    const history = [
      { tier: KPITier.Incompetent },
      { tier: KPITier.Incompetent },
      { tier: KPITier.Incompetent },
    ];
    expect(isConsecutiveFailure(history, 3)).toBe(true);
  });
});
