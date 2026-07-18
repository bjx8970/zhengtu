/**
 * 行政线专属引擎 — 经济调控系统
 *
 * 提供行政线特有的经济指标计算：
 * 1. GDP 增长率 — 综合投资、工业产值、土地收入
 * 2. 财政收支平衡度 — 收入 vs 支出比率
 * 3. 产业园区产出 — 入驻企业 × 税收优惠 × 基建
 *
 * 所有函数为纯函数，依赖通过参数注入。
 */

import type { AdminLineConfig } from '../../types/config';

/** 经济引擎依赖的 KPI 指标 ID 常量 */
const KPI_IDS = {
  INVESTMENT_ATTRACTION: 'investment_attraction',
  INDUSTRIAL_OUTPUT: 'industrial_output',
  LAND_REVENUE: 'land_revenue',
  FISCAL_REVENUE: 'fiscal_revenue',
} as const;

/**
 * 计算 GDP 增长率。
 *
 * 公式：投资到位率×0.3 + 工业产值/100×0.4 + 土地收入/100×0.2 + 基础增长(baseline)×0.1
 *
 * @param investmentRate   招商引资到位率（0~100）
 * @param industrialOutput 规上工业产值完成率（0~100）
 * @param landRevenue      土地出让收入完成率（0~100）
 * @param baseline         基础自然增长率（默认取自 config）
 * @returns GDP 增长率（0.0 ~ 1.0）
 */
export function calculateGDPGrowth(
  investmentRate: number,
  industrialOutput: number,
  landRevenue: number,
  baseline: number,
): number {
  return (
    (investmentRate / 100) * 0.3 +
    (industrialOutput / 100) * 0.4 +
    (landRevenue / 100) * 0.2 +
    baseline * 0.1
  );
}

/**
 * 计算财政收支平衡度。
 *
 * 公式：年度收入 / 年度支出
 * - 1.0 = 收支平衡
 * - > 1.0 = 盈余（财政健康）
 * - < 1.0 = 赤字（财政风险）
 *
 * @param annualRevenue    年度财政总收入（万元）
 * @param annualExpenditure 年度财政总支出（万元）
 * @returns 收支平衡比率
 */
export function calculateFiscalBalance(annualRevenue: number, annualExpenditure: number): number {
  if (annualExpenditure <= 0) return 1.0;
  return annualRevenue / annualExpenditure;
}

/**
 * 判断财政是否健康（收支平衡度是否达到阈值）。
 *
 * @param balanceRatio 收支平衡比率
 * @param threshold    健康阈值（默认 0.9，即允许 ≤10% 赤字）
 * @returns true 表示财政健康
 */
export function isFiscalHealthy(balanceRatio: number, threshold: number): boolean {
  return balanceRatio >= threshold;
}

/**
 * 计算产业园区标准化产出指数。
 *
 * 公式：入驻企业数 × 税收优惠系数 × 基础设施系数 × parkGrowthRate
 *
 * @param fundedEnterprises 已入驻企业数量
 * @param taxIncentives     税收优惠力度（0~1，越接近 1 优惠越大）
 * @param infrastructure    基础设施完成率（0~100）
 * @param config            行政线配置常量
 * @returns 产业园区产出指数（0~100）
 */
export function calculateParkOutput(
  fundedEnterprises: number,
  taxIncentives: number,
  infrastructure: number,
  config: AdminLineConfig,
): number {
  return Math.min(
    fundedEnterprises * (1 + taxIncentives) * (infrastructure / 100) * config.parkGrowthRate * 100,
    100,
  );
}

/**
 * 汇总经济指标的快照视图。
 *
 * 将分散的各部门 KPI 值聚合为行政线独有的"经济仪表盘"。
 *
 * @param kpiValues KPI ID → 当前值的映射表
 * @param config   行政线配置常量
 * @returns 经济指标快照
 */
export function getEconomicSnapshot(
  kpiValues: Record<string, number>,
  config: AdminLineConfig,
): {
  gdpGrowth: number;
  fiscalBalance: number;
  isFiscalHealthy: boolean;
  investmentRate: number;
  industrialOutput: number;
} {
  const investmentRate = kpiValues[KPI_IDS.INVESTMENT_ATTRACTION] ?? 0;
  const industrialOutput = kpiValues[KPI_IDS.INDUSTRIAL_OUTPUT] ?? 0;
  const landRevenue = kpiValues[KPI_IDS.LAND_REVENUE] ?? 0;
  const fiscalRevenue = kpiValues[KPI_IDS.FISCAL_REVENUE] ?? 0;

  const gdpGrowth = calculateGDPGrowth(
    investmentRate,
    industrialOutput,
    landRevenue,
    config.investmentYieldRate,
  );

  // 财政支出按收入 × 估算系数 计算（略 >1 表示赤字倾向）
  const estimatedExpenditure = fiscalRevenue * config.expenditureEstimateRatio;
  const fiscalBalance = calculateFiscalBalance(fiscalRevenue, estimatedExpenditure);

  return {
    gdpGrowth,
    fiscalBalance,
    isFiscalHealthy: isFiscalHealthy(fiscalBalance, config.fiscalBalanceThreshold),
    investmentRate,
    industrialOutput,
  };
}
