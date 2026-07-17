import { describe, it, expect } from 'vitest';
import {
  calculateGDPGrowth,
  calculateFiscalBalance,
  isFiscalHealthy,
  calculateParkOutput,
  getEconomicSnapshot,
} from '../economy';
import type { AdminLineConfig } from '../../../types/config';

const config: AdminLineConfig = {
  investmentYieldRate: 0.05,
  projectCompletionBaseRate: 0.15,
  landRevenueMultiplier: 0.02,
  parkGrowthRate: 0.08,
  fiscalBalanceThreshold: 0.9,
};

describe('calculateGDPGrowth', () => {
  it('所有指标为 0 → 仅基础增长 ×0.1', () => {
    const result = calculateGDPGrowth(0, 0, 0, 0.05);
    expect(result).toBeCloseTo(0.005, 4);
  });

  it('全满指标 → 增长接近 1', () => {
    const result = calculateGDPGrowth(100, 100, 100, 1.0);
    // 0.3 + 0.4 + 0.2 + 0.1 = 1.0
    expect(result).toBeCloseTo(1.0, 4);
  });

  it('一半指标 → 合理中值', () => {
    const result = calculateGDPGrowth(50, 50, 50, 0.05);
    // 0.15 + 0.2 + 0.1 + 0.005 = 0.455
    expect(result).toBeCloseTo(0.455, 3);
  });

  it('投资到位率单独影响', () => {
    const r1 = calculateGDPGrowth(0, 100, 100, 0);
    const r2 = calculateGDPGrowth(100, 100, 100, 0);
    expect(r2).toBeGreaterThan(r1);
    expect(r2 - r1).toBeCloseTo(0.3, 4);
  });
});

describe('calculateFiscalBalance', () => {
  it('收支相等 → 1.0', () => {
    expect(calculateFiscalBalance(1000, 1000)).toBe(1.0);
  });

  it('收入大于支出 → >1.0', () => {
    expect(calculateFiscalBalance(1200, 1000)).toBe(1.2);
  });

  it('支出为 0 → 1.0（安全除零）', () => {
    expect(calculateFiscalBalance(500, 0)).toBe(1.0);
  });

  it('赤字 → <1.0', () => {
    expect(calculateFiscalBalance(800, 1000)).toBe(0.8);
  });
});

describe('isFiscalHealthy', () => {
  it('达到阈值 → 健康', () => {
    expect(isFiscalHealthy(0.9, 0.9)).toBe(true);
    expect(isFiscalHealthy(0.95, 0.9)).toBe(true);
  });

  it('低于阈值 → 不健康', () => {
    expect(isFiscalHealthy(0.89, 0.9)).toBe(false);
    expect(isFiscalHealthy(0.5, 0.9)).toBe(false);
  });
});

describe('calculateParkOutput', () => {
  it('零企业 → 零产出', () => {
    expect(calculateParkOutput(0, 0.3, 50, config)).toBe(0);
  });

  it('满指标产出封顶 100', () => {
    const result = calculateParkOutput(20, 0.5, 100, config);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('低基建拖低产出', () => {
    const high = calculateParkOutput(10, 0.3, 90, config);
    const low = calculateParkOutput(10, 0.3, 10, config);
    expect(high).toBeGreaterThan(low);
  });
});

describe('getEconomicSnapshot', () => {
  it('空 KPI → 全是零', () => {
    const snap = getEconomicSnapshot({}, config);
    expect(snap.gdpGrowth).toBeCloseTo(0.005, 4);
    expect(snap.investmentRate).toBe(0);
    expect(snap.industrialOutput).toBe(0);
  });

  it('部分 KPI → 正确聚合', () => {
    const snap = getEconomicSnapshot(
      {
        investment_attraction: 80,
        industrial_output: 70,
        land_revenue: 60,
        fiscal_revenue: 5000,
      },
      config,
    );
    expect(snap.investmentRate).toBe(80);
    expect(snap.industrialOutput).toBe(70);
    expect(snap.gdpGrowth).toBeGreaterThan(0.5);
    // 财政支出按 105% 估算
    expect(snap.fiscalBalance).toBeCloseTo(5000 / 5250, 3);
  });
});
