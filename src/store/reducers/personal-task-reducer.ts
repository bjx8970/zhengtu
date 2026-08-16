/**
 * 个人任务 Reducer
 *
 * 处理 START_PERSONAL_TASK 动作：
 * - 校验任务前置条件与承接合法性（分类、预算、重复、冷却、槽位）
 * - 冻结任务可执行快照并占用日程槽位
 *
 * 个人任务与部门行动共用槽位调度与预算/备用槽惩罚规则；
 * 无 styleAlignment，故不产生理念偏离快照。
 */

import type { PlayerSave, SlotOccupant } from '../../types/player';
import { PERSONAL_TASK_LEDGER_ID } from '../../types/player';
import type { StartPersonalTaskPayload } from '../../types/actions';
import {
  describePersonalTaskAvailability,
  validatePersonalTaskStart,
} from '../../engine/tasks/personal-task';
import { getConfigLoader } from '../../config/loader';
import { clampAttr } from '../../utils/math';
import { CURRENT_CONTENT_VERSION } from '../../types/save';
import { createPersonalTaskExecutableSnapshot } from '../action-executable-snapshot';
import { createRuntimeIdFactory } from '../runtime-id';

/**
 * 处理 START_PERSONAL_TASK 动作。
 *
 * @param draft 当前游戏状态（mutable）
 * @param payload 动作参数
 */
export function reduceStartPersonalTask(
  draft: PlayerSave,
  payload: StartPersonalTaskPayload,
): void {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const task = loader.getPersonalTaskTemplate(payload.taskId);
  if (!task) return;

  const availability = describePersonalTaskAvailability(task, {
    leadershipRank: draft.career.appointment.leadershipRank,
    civilServiceRank: draft.career.civilServiceRank,
    totalCompletedTasks: draft.actions.personalTasks.totalCompleted,
    facts: draft.world.facts,
  });
  if (!availability.available) return;

  const result = validatePersonalTaskStart({
    task,
    slotState: draft.actions.slots,
    remainingBudget: draft.remainingBudget,
    currentDay: draft.time.totalDaysPlayed,
    tierKey: payload.tierKey,
    cooldownUntilDay: draft.actions.personalTasks.cooldownUntilDays[task.id] ?? 0,
    completedCount: draft.actions.personalTasks.completedCounts[task.id] ?? 0,
  });

  if (!result.success) return;

  const occupant: SlotOccupant = {
    instanceId: (payload._idFactory ?? createRuntimeIdFactory('task'))(),
    actionId: task.id,
    deptId: PERSONAL_TASK_LEDGER_ID,
    actionName: task.name,
    originPositionId: draft.career.appointment.positionId,
    originInstitutionId: draft.career.appointment.institutionId,
    originRegionId: draft.career.appointment.regionId,
    category: task.category,
    startedAtDay: draft.time.totalDaysPlayed,
    durationDays: task.durationDays,
    cooldownDays: task.cooldownDays,
    executableSnapshot: createPersonalTaskExecutableSnapshot(
      task,
      CURRENT_CONTENT_VERSION,
      cfg.attributeBounds,
    ),
  };

  draft.actions.slots[result.tierKey].occupants[result.slotIndex] = occupant;

  draft.remainingBudget -= task.budgetDelta;
  draft.actions.totalActions += 1;

  // 备用槽位惩罚（与部门行动同规）
  if (result.tierKey === 'reserve') {
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
}
