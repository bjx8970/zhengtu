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
import type { SlotState, SlotOccupant } from '../../types/player';
import type { StartActionResult } from '../../types/game';

const TIER_ORDER: ('primary' | 'secondary' | 'reserve')[] = ['primary', 'secondary', 'reserve'];

/** 校验并启动一个行动 */
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
    const idx = tier.occupants.findIndex((o: unknown) => o === null);
    if (idx === -1) continue;

    return {
      success: true,
      tierKey,
      slotIndex: idx,
    };
  }

  return { success: false, error: '无空闲槽位' };
}

/** 推进时间后检查并收集已完成行动的效果 */
export function completeActions(
  slotState: SlotState,
  currentDay: number,
): { tierKey: string; slotIndex: number; occupant: SlotOccupant }[] {
  const completed: { tierKey: string; slotIndex: number; occupant: SlotOccupant }[] = [];

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

export function resolveActionEffects(actionConfig: ActionTemplate): {
  kpiChanges: { indicatorId: string; delta: number }[];
  playerChanges: { attr: string; delta: number }[];
} {
  const kpiChanges: { indicatorId: string; delta: number }[] = [];
  const playerChanges: { attr: string; delta: number }[] = [];

  for (const effect of actionConfig.effects) {
    const value = effect.range
      ? Math.floor(Math.random() * (effect.range.max - effect.range.min + 1)) + effect.range.min
      : effect.value;

    if (effect.target.startsWith('dept.kpi.')) {
      kpiChanges.push({ indicatorId: effect.target.replace('dept.kpi.', ''), delta: value });
    } else if (effect.target.startsWith('player.')) {
      playerChanges.push({ attr: effect.target.replace('player.', ''), delta: value });
    }
  }

  return { kpiChanges, playerChanges };
}
