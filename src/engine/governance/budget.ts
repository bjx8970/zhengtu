/**
 * 预算引擎
 *
 * 核心职责：
 * 1. 计算单个部门的月度资金消耗
 * 2. 执行月末批量结算：扣除各部门消耗，检测是否超支
 *
 * 活跃度系统暂不实现（Phase 2 scope），乘积公式预留扩展点。
 * 纯函数，所有依赖通过参数传入。
 */

import type { DepartmentConfig } from '../../types/config';
import type { DepartmentState } from '../../types/player';

/**
 * 计算单个部门的月度资金消耗。
 *
 * 公式：baseConsumption × consumptionCoefficient
 * 注：活跃度系数（activityLevel）预留，Phase 2 暂不引入。
 *
 * @param dept   部门运行时状态
 * @param config 部门配置
 * @returns 当月消耗（万元）
 */
export function calculateMonthlyConsumption(
  _dept: DepartmentState,
  config: DepartmentConfig,
): number {
  return config.baseConsumption * config.consumptionCoefficient;
}

/**
 * 执行月末批量结算。
 *
 * 遍历所有配置的部门，扣减对应状态的月度消耗，
 * 汇总总消耗并从余额中扣除。
 *
 * @param departments     各部门运行时状态
 * @param configs         各部门配置列表
 * @param remainingBudget 当前剩余预算（万元）
 * @returns 新余额 + 各部门消耗明细 + 是否超支
 */
export function monthlySettlement(
  departments: Record<string, DepartmentState>,
  configs: DepartmentConfig[],
  remainingBudget: number,
): {
  newRemaining: number;
  deptConsumptions: Record<string, number>;
  isOverBudget: boolean;
} {
  const deptConsumptions: Record<string, number> = {};
  let totalConsumption = 0;

  for (const config of configs) {
    const state = departments[config.id];
    if (!state) continue;

    const consumption = calculateMonthlyConsumption(state, config);
    deptConsumptions[config.id] = consumption;
    totalConsumption += consumption;
  }

  const newRemaining = remainingBudget - totalConsumption;
  return {
    newRemaining,
    deptConsumptions,
    isOverBudget: newRemaining < 0,
  };
}

/**
 * 计算该部门本年度已使用的预算总额。
 *
 * @param state 部门状态
 * @returns 累计消耗（万元）
 */
export function getCumulativeConsumption(state: DepartmentState): number {
  return state.cumulativeConsumption;
}
