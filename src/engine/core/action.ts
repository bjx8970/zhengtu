/**
 * 行动执行引擎
 *
 * 核心职责：
 * 1. 校验行动是否可执行（槽位、冷却、预算）
 * 2. 解析行动效果为 KPI 变化和玩家属性变化
 * 3. 返回 ActionResult 供 store 层应用到 state
 *
 * 纯函数，不修改输入参数。所有校验和计算均通过参数化进行。
 */

import type { ActionResult, ActionEffectResult } from '../../types/game';
import type { ActionTemplate, GameConfig } from '../../types/config';
import type { DepartmentState } from '../../types/player';

/**
 * 执行一个行动。校验前置条件并计算效果。
 *
 * @param actionConfig    行动配置
 * @param deptState       部门当前状态（用于检查冷却）
 * @param slotAvailable   当前剩余槽位数
 * @param remainingBudget 当前剩余预算
 * @param gameDay         当前游戏日（用于冷却计算）
 * @param config          游戏配置常量
 * @returns 执行结果，success=false 时 error 字段说明原因
 */
export function executeAction(
  actionConfig: ActionTemplate,
  deptState: DepartmentState,
  slotAvailable: number,
  remainingBudget: number,
  gameDay: number,
  config: GameConfig,
): ActionResult {
  // 校验：槽位
  if (slotAvailable < actionConfig.slotCost) {
    return emptyResult(false, `槽位不足（需${actionConfig.slotCost}，剩${slotAvailable}）`);
  }

  // 校验：冷却
  const cooldownEnd = deptState.actionCooldowns[actionConfig.id] ?? 0;
  if (gameDay < cooldownEnd) {
    const remaining = cooldownEnd - gameDay;
    return emptyResult(false, `冷却中，剩余${remaining}天`);
  }

  // 校验：预算
  if (remainingBudget < actionConfig.budgetDelta) {
    return emptyResult(false, '预算不足');
  }

  // 解析每个 effect 的目标和数值
  const kpiChanges: { indicatorId: string; delta: number }[] = [];
  const playerChanges: { attr: string; delta: number }[] = [];

  for (const effect of actionConfig.effects) {
    const value = resolveEffectValue(effect, actionConfig);

    if (effect.target.startsWith('dept.kpi.')) {
      const kpiId = effect.target.replace('dept.kpi.', '');
      kpiChanges.push({ indicatorId: kpiId, delta: value });
    } else if (effect.target.startsWith('player.')) {
      const attr = effect.target.replace('player.', '');
      playerChanges.push({ attr, delta: value });
    }
  }

  // 天数消耗：每 slotCost 约 1.5 天
  const daysAdvanced = Math.max(1, Math.ceil(actionConfig.slotCost * config.daysPerSlotUnit));

  return {
    success: true,
    slotCost: actionConfig.slotCost,
    budgetDelta: actionConfig.budgetDelta,
    kpiChanges,
    playerChanges,
    newCooldown: {
      actionId: actionConfig.id,
      expiresAt: gameDay + actionConfig.cooldownDays,
    },
    daysAdvanced,
  };
}

/** 解析效果值：有 range 时随机，否则返回固定值 */
function resolveEffectValue(
  effect: { value: number; range?: { min: number; max: number } },
  _actionConfig: ActionTemplate,
): number {
  if (effect.range) {
    return Math.floor(Math.random() * (effect.range.max - effect.range.min + 1)) + effect.range.min;
  }
  return effect.value;
}

/** 构建失败结果 */
function emptyResult(success: boolean, error: string): ActionResult {
  return {
    success,
    error,
    slotCost: 0,
    budgetDelta: 0,
    kpiChanges: [],
    playerChanges: [],
    newCooldown: { actionId: '', expiresAt: 0 },
    daysAdvanced: 0,
  };
}

/**
 * 合并多个 ActionEffectResult 为聚合的 KPI/玩家变化。
 * 按 target 分组汇总，供 store 层一次性应用。
 *
 * @deprecated Phase 2 实现：后续多行动并行执行时启用
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function resolveEffects(_effects: ActionEffectResult[]): {
  kpiChanges: Record<string, number>;
  playerChanges: Record<string, number>;
} {
  const kpiChanges: Record<string, number> = {};
  const playerChanges: Record<string, number> = {};

  for (const eff of _effects) {
    if (eff.target.startsWith('dept.kpi.')) {
      const kpiId = eff.target.replace('dept.kpi.', '');
      kpiChanges[kpiId] = (kpiChanges[kpiId] ?? 0) + eff.delta;
    } else if (eff.target.startsWith('player.')) {
      const attr = eff.target.replace('player.', '');
      playerChanges[attr] = (playerChanges[attr] ?? 0) + eff.delta;
    }
  }

  return { kpiChanges, playerChanges };
}

/** 获取指定推进粒度下的最大槽位数 */
export function getSlotLimits(granularity: 'day' | 'week' | 'month', config: GameConfig): number {
  return config.slotLimits[granularity];
}
