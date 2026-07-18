import { describe, it, expect } from 'vitest';
import { calculateKPI, aggregateKPIValue, scoreToKPITier } from '../kpi';
import { getConfigLoader } from '../../../config/loader';
import type { KPITemplate } from '../../../types/config';
import type { DepartmentState } from '../../../types/player';
import { KPITier } from '../../../types/enums';

const cfg = getConfigLoader().getGameConfig();

function makeIndicator(overrides: Partial<KPITemplate> & { id: string }): KPITemplate {
  return {
    name: overrides.id,
    targetValue: 100,
    weight: 0.5,
    unit: '%',
    calcType: 'ratio',
    ...overrides,
  };
}

function makeDeptState(kpiValues: Record<string, number>): DepartmentState {
  return {
    id: 'test_dept',
    kpiValues,
    monthlyConsumption: 50,
    cumulativeConsumption: 0,
    lastActionDay: 0,
    actionCooldownUntilDays: {},
  };
}

describe('aggregateKPIValue', () => {
  it('从单个部门聚合 KPI 值', () => {
    const depts = { d1: makeDeptState({ gdp: 80 }) };
    expect(aggregateKPIValue('gdp', depts)).toBe(80);
  });

  it('从多个部门累加同一 KPI', () => {
    const depts = {
      d1: makeDeptState({ gdp: 30 }),
      d2: makeDeptState({ gdp: 45 }),
      d3: makeDeptState({ gdp: 15 }),
    };
    expect(aggregateKPIValue('gdp', depts)).toBe(90);
  });

  it('部门不包含该 KPI 时返回 0', () => {
    const depts = { d1: makeDeptState({ other: 50 }) };
    expect(aggregateKPIValue('gdp', depts)).toBe(0);
  });

  it('空部门列表返回 0', () => {
    expect(aggregateKPIValue('gdp', {})).toBe(0);
  });
});

describe('calculateKPI', () => {
  describe('ratio 型指标（上限 1.5）', () => {
    it('恰好达到目标：完成率 1.0', () => {
      const indicators = [makeIndicator({ id: 'gdp', targetValue: 100, weight: 1.0 })];
      const depts = { d1: makeDeptState({ gdp: 100 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(1.0);
      expect(result.indicators[0]!.weightedScore).toBeCloseTo(100);
    });

    it('超额完成：完成率上限 1.5', () => {
      const indicators = [makeIndicator({ id: 'gdp', targetValue: 100, weight: 1.0 })];
      const depts = { d1: makeDeptState({ gdp: 200 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(1.5);
      expect(result.indicators[0]!.weightedScore).toBeCloseTo(150);
    });

    it('未完成：完成率 0.5', () => {
      const indicators = [makeIndicator({ id: 'gdp', targetValue: 100, weight: 1.0 })];
      const depts = { d1: makeDeptState({ gdp: 50 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(0.5);
      expect(result.indicators[0]!.weightedScore).toBeCloseTo(50);
    });
  });

  describe('inverse 型指标（反向，如事故率）', () => {
    it('事故数为 0：完成率 1.0', () => {
      const indicators = [
        makeIndicator({ id: 'accidents', targetValue: 5, weight: 1.0, calcType: 'inverse' }),
      ];
      const depts = { d1: makeDeptState({ accidents: 0 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(1.0);
      expect(result.indicators[0]!.weightedScore).toBeCloseTo(100);
    });

    it('事故数在目标内：完成率 0.4', () => {
      const indicators = [
        makeIndicator({ id: 'accidents', targetValue: 5, weight: 1.0, calcType: 'inverse' }),
      ];
      const depts = { d1: makeDeptState({ accidents: 3 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(0.4);
    });

    it('事故数超出目标：完成率 0（不低于 0）', () => {
      const indicators = [
        makeIndicator({ id: 'accidents', targetValue: 5, weight: 1.0, calcType: 'inverse' }),
      ];
      const depts = { d1: makeDeptState({ accidents: 10 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(0);
    });
  });

  describe('absolute 型指标', () => {
    it('达到绝对值目标', () => {
      const indicators = [
        makeIndicator({ id: 'projects', targetValue: 5, weight: 1.0, calcType: 'absolute' }),
      ];
      const depts = { d1: makeDeptState({ projects: 5 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(1.0);
    });

    it('超过绝对值目标：完成率 1.0', () => {
      const indicators = [
        makeIndicator({ id: 'projects', targetValue: 5, weight: 1.0, calcType: 'absolute' }),
      ];
      const depts = { d1: makeDeptState({ projects: 10 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(1.0);
    });

    it('未达到绝对值目标', () => {
      const indicators = [
        makeIndicator({ id: 'projects', targetValue: 5, weight: 1.0, calcType: 'absolute' }),
      ];
      const depts = { d1: makeDeptState({ projects: 2 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(0.4);
    });
  });

  describe('多指标加权汇总', () => {
    it('总分 = 各 weightedScore 之和', () => {
      const indicators = [
        makeIndicator({ id: 'gdp', targetValue: 100, weight: 0.5 }),
        makeIndicator({ id: 'safety', targetValue: 5, weight: 0.3, calcType: 'inverse' }),
        makeIndicator({ id: 'morale', targetValue: 80, weight: 0.2 }),
      ];
      const depts = {
        d1: makeDeptState({ gdp: 100, safety: 2, morale: 80 }),
      };
      const result = calculateKPI(indicators, depts, cfg);
      // gdp: 1.0 × 0.5 × 100 = 50
      // safety: (5-2)/5 × 0.3 × 100 = 18
      // morale: 1.0 × 0.2 × 100 = 20
      // total = 88
      expect(result.totalScore).toBeCloseTo(88);
    });

    it('多个部门的同一 KPI 被聚合', () => {
      const indicators = [makeIndicator({ id: 'gdp', targetValue: 100, weight: 1.0 })];
      const depts = {
        d1: makeDeptState({ gdp: 30 }),
        d2: makeDeptState({ gdp: 40 }),
      };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.currentValue).toBe(70);
      expect(result.indicators[0]!.completionRate).toBe(0.7);
    });
  });

  describe('边界情况', () => {
    it('空指标列表：总分 0', () => {
      const result = calculateKPI([], {}, cfg);
      expect(result.totalScore).toBe(0);
      expect(result.indicators).toHaveLength(0);
    });

    it('targetValue 为 0 时返回完成（守卫除零）', () => {
      const indicators = [makeIndicator({ id: 'x', targetValue: 0, weight: 1.0 })];
      const depts = { d1: makeDeptState({ x: 0 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.completionRate).toBe(1.0);
    });

    it('weight 为 0 时不贡献分数', () => {
      const indicators = [makeIndicator({ id: 'gdp', targetValue: 100, weight: 0 })];
      const depts = { d1: makeDeptState({ gdp: 100 }) };
      const result = calculateKPI(indicators, depts, cfg);
      expect(result.indicators[0]!.weightedScore).toBe(0);
      expect(result.totalScore).toBe(0);
    });
  });
});

describe('scoreToKPITier', () => {
  it('>= 90 → 优秀', () => {
    expect(scoreToKPITier(90, cfg.kpiTierThresholds)).toBe(KPITier.Excellent);
    expect(scoreToKPITier(95, cfg.kpiTierThresholds)).toBe(KPITier.Excellent);
  });

  it('>= 75 → 称职', () => {
    expect(scoreToKPITier(75, cfg.kpiTierThresholds)).toBe(KPITier.Competent);
    expect(scoreToKPITier(89, cfg.kpiTierThresholds)).toBe(KPITier.Competent);
  });

  it('>= 60 → 基本称职', () => {
    expect(scoreToKPITier(60, cfg.kpiTierThresholds)).toBe(KPITier.Basic);
    expect(scoreToKPITier(74, cfg.kpiTierThresholds)).toBe(KPITier.Basic);
  });

  it('< 60 → 不称职', () => {
    expect(scoreToKPITier(59, cfg.kpiTierThresholds)).toBe(KPITier.Incompetent);
    expect(scoreToKPITier(0, cfg.kpiTierThresholds)).toBe(KPITier.Incompetent);
  });
});
