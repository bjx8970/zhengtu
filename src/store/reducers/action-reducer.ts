/**
 * 行动 Reducer（Schema 6）
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
import { CURRENT_CONTENT_VERSION } from '../../types/save';
import { createActionExecutableSnapshot } from '../action-executable-snapshot';
import { createRuntimeIdFactory } from '../runtime-id';

/**
 * 处理 START_ACTION 动作。
 *
 * 理念偏离倍率绑定到 SlotOccupant.runtimeSnapshot，
 * 不再使用玩家级 _pendingDeviationMultiplier。
 *
 * @param draft 当前游戏状态（mutable）
 * @param payload 动作参数
 */
export function reduceStartAction(draft: PlayerSave, payload: StartActionPayload): void {
  // 部门治理行动是领导职务专属：无领导职务阶段以个人任务为主要工作，
  // 引擎侧拒绝与 UI 侧隐藏双重封禁（issue #120）。
  if (draft.career.appointment.leadershipRank === 'none') return;

  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const positionId = draft.career.appointment.positionId;

  // 使用新版 ConfigLoader 按稳定 ID 查询
  const departments = loader.resolvePositionDepartments(positionId);
  const deptConfig = departments.find((d) => d.id === payload.deptId);
  if (!deptConfig) return;
  const actionConfig = deptConfig.actions.find((a) => a.id === payload.actionId);
  if (!actionConfig) return;

  const deptState = draft.actions.departmentStates[payload.deptId];
  const result = startAction({
    action: actionConfig,
    slotState: draft.actions.slots,
    remainingBudget: draft.remainingBudget,
    currentDay: draft.time.totalDaysPlayed,
    deptId: payload.deptId,
    tierKey: payload.tierKey,
    cooldownUntilDay: deptState?.actionCooldownUntilDays?.[payload.actionId] ?? 0,
  });

  if (!result.success) return;

  // 计算理念偏离快照并绑定到行动实例
  let runtimeSnapshot: ActionRuntimeSnapshot | undefined;
  if (actionConfig.styleAlignment) {
    const devResult = calculateDeviationPenalty(
      draft.character.philosophy.scores,
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
    instanceId: (payload._idFactory ?? createRuntimeIdFactory('action'))(),
    actionId: actionConfig.id,
    deptId: payload.deptId,
    actionName: actionConfig.name,
    originPositionId: draft.career.appointment.positionId,
    originInstitutionId: draft.career.appointment.institutionId,
    originRegionId: draft.career.appointment.regionId,
    category: actionConfig.category,
    startedAtDay: draft.time.totalDaysPlayed,
    durationDays: actionConfig.durationDays,
    cooldownDays: actionConfig.cooldownDays,
    executableSnapshot: createActionExecutableSnapshot(
      deptConfig,
      actionConfig,
      CURRENT_CONTENT_VERSION,
      cfg.attributeBounds,
    ),
    runtimeSnapshot,
  };

  const tierKey = result.tierKey;
  const slotIdx = result.slotIndex;
  draft.actions.slots[tierKey].occupants[slotIdx] = occupant;

  draft.remainingBudget -= actionConfig.budgetDelta;
  draft.actions.totalActions += 1;

  // 备用槽位惩罚
  if (tierKey === 'reserve') {
    const penalty = cfg.reservePenalty;
    draft.character.vigor = clampAttr(
      'vigor',
      (draft.character.vigor ?? 100) + penalty.vigor,
      cfg.attributeBounds,
    );
    draft.character.ambition = clampAttr(
      'ambition',
      (draft.character.ambition ?? 100) + penalty.ambition,
      cfg.attributeBounds,
    );
  }

  if (deptState) {
    deptState.lastActionDay = draft.time.totalDaysPlayed;
  }
}
