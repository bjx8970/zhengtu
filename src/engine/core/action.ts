/**
 * 行动队列引擎
 *
 * 核心职责：
 * 1. startAction — 校验并将行动放入槽位（扣预算、占槽位）
 * 2. completeActions — 推进时间后检查到期行动并返回效果
 *
 * 纯函数，不修改输入参数。
 */

import type { SlotState, SlotTierKey } from '../../types/player';
import type { ActionTemplate } from '../../types/config';
import type {
  StartActionInput,
  StartActionResult,
  CompletedSlotAction,
  KPIEffectChange,
  PlayerEffectChange,
} from '../../types/game';

const TIER_ORDER: SlotTierKey[] = ['primary', 'secondary', 'reserve'];

/**
 * 判断是否存在尚未完成的行动。
 *
 * @param slotState - 当前槽位状态
 * @returns 任一槽位被占用时返回 true
 */
export function hasActiveActions(slotState: SlotState): boolean {
  return TIER_ORDER.some((tierKey) => slotState[tierKey].occupants.some((occupant) => occupant));
}

/**
 * 校验分类、预算、重复性、冷却和玩家选择的槽位。
 *
 * @param input - 行动、部门、冷却及玩家选择槽位的不可变输入
 * @returns 成功时返回槽位位置；失败时返回错误信息
 */
export function startAction(input: StartActionInput): StartActionResult {
  const { action, slotState, remainingBudget, currentDay, deptId, tierKey, cooldownUntilDay } =
    input;

  if (action.category === 'major' && tierKey !== 'primary') {
    return { success: false, error: '重大行动只能使用主要槽位' };
  }

  if (remainingBudget < action.budgetDelta) {
    return { success: false, error: '预算不足' };
  }

  if (action.category !== 'routine') {
    const duplicate = TIER_ORDER.some((key) =>
      slotState[key].occupants.some(
        (occupant) => occupant?.actionId === action.id && occupant.deptId === deptId,
      ),
    );
    if (duplicate) {
      return { success: false, error: '该部门的行动已在执行中' };
    }
    if (currentDay < cooldownUntilDay) {
      return { success: false, error: `行动冷却中，需等待至第 ${cooldownUntilDay} 天` };
    }
  }

  const slotIndex = slotState[tierKey].occupants.findIndex((occupant) => occupant === null);
  if (slotIndex === -1) {
    return { success: false, error: '所选槽位等级无空闲槽位' };
  }

  return { success: true, tierKey, slotIndex };
}

/**
 * 推进时间后检查所有槽位，收集已完成的行动。
 *
 * @param slotState - 当前槽位状态
 * @param currentDay - 推进后的游戏天数
 * @returns 已完成行动的列表（含槽位位置 + 占用记录）
 */
export function completeActions(slotState: SlotState, currentDay: number): CompletedSlotAction[] {
  const completed: CompletedSlotAction[] = [];

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
 * @param _rng - 可选的随机数生成器（仅测试用，默认 Math.random）
 * @returns KPI 增量列表 + 玩家属性增量列表，含操作模式
 */
export function resolveActionEffects(
  actionConfig: ActionTemplate,
  _rng?: () => number,
): {
  kpiChanges: KPIEffectChange[];
  playerChanges: PlayerEffectChange[];
} {
  const kpiChanges: KPIEffectChange[] = [];
  const playerChanges: PlayerEffectChange[] = [];

  for (const effect of actionConfig.effects) {
    const rand = _rng ?? Math.random;
    const delta = effect.range
      ? Math.floor(rand() * (effect.range.max - effect.range.min + 1)) + effect.range.min
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
