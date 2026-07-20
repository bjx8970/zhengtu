/**
 * 行动 Reducer
 *
 * 处理 START_ACTION 动作：
 * - 校验行动合法性（分类、预算、冷却、槽位）
 * - 计算理念偏离快照并绑定到行动实例
 * - 将行动放入槽位
 */

import type { PlayerSave, SlotOccupant } from '../../types/player';
import type { ActionRuntimeSnapshot } from '../../types/game';
import type { StartActionPayload } from '../../types/actions';
import { startAction } from '../../engine/core/action';
import { calculateDeviationPenalty } from '../../engine/career/deviation-penalty';
import { getConfigLoader } from '../../config/loader';
import { clampAttr } from '../../utils/math';
import { extractPositionIndex } from './shared';

/**
 * 处理 START_ACTION 动作。
 *
 * v4 变更：理念偏离倍率绑定到 SlotOccupant.runtimeSnapshot，
 * 不再使用玩家级 _pendingDeviationMultiplier。
 *
 * @param draft 当前游戏状态（mutable）
 * @param payload 动作参数
 */
export function reduceStartAction(draft: PlayerSave, payload: StartActionPayload): void {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const positionIndex = extractPositionIndex(draft.currentPositionId);
  const position = loader.getPosition(draft.currentCareerLine, draft.currentLevel, positionIndex);
  if (!position) return;

  const deptConfig = position.departments.find((d) => d.id === payload.deptId);
  if (!deptConfig) return;
  const actionConfig = deptConfig.actions.find((a) => a.id === payload.actionId);
  if (!actionConfig) return;

  const deptState = draft.departmentStates[payload.deptId];
  const result = startAction({
    action: actionConfig,
    slotState: draft.slots,
    remainingBudget: draft.remainingBudget,
    currentDay: draft.totalDaysPlayed,
    deptId: payload.deptId,
    tierKey: payload.tierKey,
    cooldownUntilDay: deptState?.actionCooldownUntilDays?.[payload.actionId] ?? 0,
  });

  if (!result.success) return;

  // v4: 计算理念偏离快照并绑定到行动实例
  let runtimeSnapshot: ActionRuntimeSnapshot | undefined;
  if (actionConfig.styleAlignment) {
    const devResult = calculateDeviationPenalty(
      draft.philosophy.scores,
      actionConfig.styleAlignment,
      loader.getLeadershipStyleConfig().styleSpectrums,
      loader.getLeadershipStyleConfig().deviationPenalty,
    );
    runtimeSnapshot = {
      effectivenessMultiplier: devResult.effectivenessMultiplier,
      styleConflictTriggered: devResult.styleConflictTriggered,
      styleAlignment: actionConfig.styleAlignment,
    };
  }

  const occupant: SlotOccupant = {
    actionId: actionConfig.id,
    deptId: payload.deptId,
    actionName: actionConfig.name,
    category: actionConfig.category,
    startedAtDay: draft.totalDaysPlayed,
    durationDays: actionConfig.durationDays,
    cooldownDays: actionConfig.cooldownDays,
    runtimeSnapshot,
  };

  const tierKey = result.tierKey;
  const slotIdx = result.slotIndex;
  draft.slots[tierKey].occupants[slotIdx] = occupant;

  draft.remainingBudget -= actionConfig.budgetDelta;
  draft.totalActions += 1;

  // 备用槽位惩罚
  if (tierKey === 'reserve') {
    const penalty = cfg.reservePenalty;
    draft.vigor = clampAttr('vigor', (draft.vigor ?? 100) + penalty.vigor, cfg.attributeBounds);
    draft.ambition = clampAttr(
      'ambition',
      (draft.ambition ?? 100) + penalty.ambition,
      cfg.attributeBounds,
    );
  }

  if (deptState) {
    deptState.lastActionDay = draft.totalDaysPlayed;
  }
}
