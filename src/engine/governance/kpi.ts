/**
 * KPI 计算引擎
 *
 * 核心职责：
 * 1. 从各部门状态聚合同一 KPI 指标的当前值
 * 2. 按 calcType 计算每个指标的完成率和加权分
 * 3. 汇总总分并映射为 KPITier 等次
 *
 * 纯函数，所有依赖通过参数传入。
 */

import type { KPITemplate } from '../../types/config';
import type { DepartmentState } from '../../types/player';
import type { AssessmentResult, KPIResult } from '../../types/game';
import { KPITier } from '../../types/enums';

/**
 * 从所有部门状态中聚合指定 KPI 指标的当前值。
 *
 * 按部门遍历，取同标识 KPI 的当前值累加。
 *
 * @param kpiId     KPI 指标 ID
 * @param deptStates 所有部门的状态表
 * @returns 聚合后的当前值
 */
export function aggregateKPIValue(
  kpiId: string,
  deptStates: Record<string, DepartmentState>,
): number {
  let total = 0;
  for (const dept of Object.values(deptStates)) {
    if (dept.kpiValues[kpiId] !== undefined) {
      total += dept.kpiValues[kpiId];
    }
  }
  return total;
}

/**
 * 计算所有 KPI 指标，生成完整考核结果。
 *
 * 三种 calcType：
 * - ratio：完成率 = currentValue / targetValue（上限 1.5 防止溢出）
 * - inverse：反向指标（如事故率），完成率 = max((target - current) / target, 0)
 * - absolute：current >= target → 1.0，否则 current / target
 *
 * weightedScore = completionRate × weight × 100
 * totalScore = Σ weightedScore
 *
 * @param indicators 职位级 KPI 指标列表
 * @param deptStates 当前各部门运行时状态
 * @returns 完整考核结果
 */
export function calculateKPI(
  indicators: KPITemplate[],
  deptStates: Record<string, DepartmentState>,
): AssessmentResult {
  const results: KPIResult[] = indicators.map((ind) => {
    const currentValue = aggregateKPIValue(ind.id, deptStates);
    let completionRate: number;

    switch (ind.calcType) {
      case 'ratio':
        // targetValue 为 0 时视为已完成（避免除零）
        completionRate =
          ind.targetValue === 0 ? 1.0 : Math.min(currentValue / ind.targetValue, 1.5);
        break;
      case 'inverse':
        // 反向指标：targetValue 为 0 时视为已达成
        completionRate =
          ind.targetValue === 0
            ? 1.0
            : Math.max((ind.targetValue - currentValue) / ind.targetValue, 0);
        break;
      case 'absolute':
        completionRate = currentValue >= ind.targetValue ? 1.0 : currentValue / ind.targetValue;
        break;
      default: {
        // 穷举检查：新增 calcType 时在此编译期报错
        const _exhaustive: never = ind.calcType;
        throw new Error(`Unknown calcType: ${_exhaustive}`);
      }
    }

    return {
      indicatorId: ind.id,
      name: ind.name,
      currentValue,
      targetValue: ind.targetValue,
      completionRate,
      weight: ind.weight,
      weightedScore: completionRate * ind.weight * 100,
    };
  });

  const totalScore = results.reduce((sum, r) => sum + r.weightedScore, 0);
  const tier = scoreToKPITier(totalScore);

  return { totalScore, tier, indicators: results };
}

/**
 * 将综合评分映射为考核等次。
 *
 * - >= 90 → 优秀
 * - >= 75 → 称职
 * - >= 60 → 基本称职
 * - < 60  → 不称职
 */
export function scoreToKPITier(score: number): KPITier {
  if (score >= 90) return KPITier.Excellent;
  if (score >= 75) return KPITier.Competent;
  if (score >= 60) return KPITier.Basic;
  return KPITier.Incompetent;
}
