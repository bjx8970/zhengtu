/**
 * 行动队列引擎
 *
 * 核心职责：
 * 1. startAction — 校验并将行动放入槽位（扣预算、占槽位）
 * 2. completeActions — 推进时间后检查到期行动并返回效果
 *
 * 纯函数，不修改输入参数。
 */

import type { ActionTemplate } from '../../types/config';
import type { SlotState, SlotOccupant, SlotTierKey } from '../../types/player';
import type { StartActionResult } from '../../types/game';

const TIER_ORDER: SlotTierKey[] = ['primary', 'secondary', 'reserve'];

/**
 * 校验预算/重复性/槽位，将行动放入合适的槽位。
 *
 * @param actionConfig - 行动模板
 * @param slotState - 当前槽位状态
 * @param remainingBudget - 剩余预算
 * @param _currentDay - 当前游戏天数（预留）
 * @returns 成功时返回槽位位置；失败时返回错误信息
 */
export function startAction(
  actionConfig: ActionTemplate,
  slotState: SlotState,
  remainingBudget: number,
  _currentDay: number,
): StartActionResult {
  if (remainingBudget < actionConfig.budgetDelta) {
    return { success: false, error: '预算不足' };
  }

  for (const tierKey of TIER_ORDER) {
    const tier = slotState[tierKey];
    if (tier?.occupants.some((o) => o?.actionId === actionConfig.id)) {
      return { success: false, error: '该行动已在执行中' };
    }
  }

  const minTierIdx = TIER_ORDER.indexOf(actionConfig.minTier);

  for (const tierKey of TIER_ORDER) {
    const tierIdx = TIER_ORDER.indexOf(tierKey);
    if (tierIdx > minTierIdx) continue;
    const tier = slotState[tierKey];
    if (!tier) continue;
    const idx = tier.occupants.findIndex((o) => o === null);
    if (idx === -1) continue;

    return {
      success: true,
      tierKey,
      slotIndex: idx,
    };
  }

  return { success: false, error: '无空闲槽位' };
}

/**
 * 推进时间后检查所有槽位，收集已完成的行动。
 *
 * @param slotState - 当前槽位状态
 * @param currentDay - 推进后的游戏天数
 * @returns 已完成行动的列表（含槽位位置 + 占用记录）
 */
export function completeActions(
  slotState: SlotState,
  currentDay: number,
): { tierKey: SlotTierKey; slotIndex: number; occupant: SlotOccupant }[] {
  const completed: { tierKey: SlotTierKey; slotIndex: number; occupant: SlotOccupant }[] = [];

  for (const tierKey of TIER_ORDER) {
    const tier = slotState[tierKey];
    if (!tier) continue;
    for (let i = 0; i < tier.occupants.length; i++) {
      const occupant = tier.occupants[i];
      if (!occupant) continue;
      if (currentDay - occupant.startedAtDay >= occupant.durationDays) {
        completed.push({ tierKey, slotIndex: i, occupant });
      }
    }
  }

  return completed;
}

/**
 * 解析行动模板的效果，生成 KPI 变更和属性变更。
 *
 * @param actionConfig - 已完成行动的模板
 * @returns KPI 增量列表 + 玩家属性增量列表，含操作模式
 */
export function resolveActionEffects(actionConfig: ActionTemplate): {
  kpiChanges: { indicatorId: string; operation: 'add' | 'multiply' | 'set'; delta: number }[];
  playerChanges: { attr: string; operation: 'add' | 'multiply' | 'set'; delta: number }[];
} {
  const kpiChanges: {
    indicatorId: string;
    operation: 'add' | 'multiply' | 'set';
    delta: number;
  }[] = [];
  const playerChanges: { attr: string; operation: 'add' | 'multiply' | 'set'; delta: number }[] =
    [];

  for (const effect of actionConfig.effects) {
    const delta = effect.range
      ? Math.floor(Math.random() * (effect.range.max - effect.range.min + 1)) + effect.range.min
      : effect.value;

    if (effect.target.startsWith('dept.kpi.')) {
      kpiChanges.push({
        indicatorId: effect.target.replace('dept.kpi.', ''),
        operation: effect.operation,
        delta,
      });
    } else if (effect.target.startsWith('player.')) {
      playerChanges.push({
        attr: effect.target.replace('player.', ''),
        operation: effect.operation,
        delta,
      });
    }
  }

  return { kpiChanges, playerChanges };
}
