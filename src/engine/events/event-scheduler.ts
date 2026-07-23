/**
 * 事件调度器与过期处理
 *
 * 纯函数：
 * - activateScheduledEvents：将到期计划事件激活为 EventInstance
 * - expireEventInstances：将过期事件标记为 expired 并记录历史
 */

import type { PlayerSave } from '../../types/player';
import type {
  EventInstance,
  EventHistoryRecord,
  EventChainInstance,
} from '../../domain/events/state';

/** 计划事件激活结果 */
export interface ScheduledActivationResult {
  activatedInstances: EventInstance[];
  newlyBlockingInstanceId: string | null;
}

/** 事件过期结果 */
export interface EventExpirationResult {
  expiredRecords: EventHistoryRecord[];
  chainsToUpdate: EventChainInstance[];
}

/**
 * 激活到期的计划事件。
 *
 * 从 state.events.scheduled 中筛选 activateAtDay <= currentDay 的事件，
 * 按激活日期、优先级、实例 ID 排序后创建 EventInstance。
 *
 * @param state 游戏状态（只读）
 * @param currentDay 当前绝对游戏日
 * @param rng 随机数生成器（用于自动事件结算，暂未实现）
 * @param idFactory ID 工厂（用于自动事件结算，暂未实现）
 * @returns 激活结果
 */
export function activateScheduledEvents(
  state: Readonly<PlayerSave>,
  currentDay: number,
  _rng: () => number,
  _idFactory: () => string,
): ScheduledActivationResult {
  const due = state.events.scheduled.filter((s) => s.activateAtDay <= currentDay);

  // 按 activateAtDay, 优先级（快照中）, instanceId 排序
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  due.sort((a, b) => {
    if (a.activateAtDay !== b.activateAtDay) return a.activateAtDay - b.activateAtDay;
    const pa = priorityOrder[a.snapshot.priority] ?? 2;
    const pb = priorityOrder[b.snapshot.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.instanceId.localeCompare(b.instanceId);
  });

  const activated: EventInstance[] = [];

  for (const sched of due) {
    const inst: EventInstance = {
      instanceId: sched.instanceId,
      eventId: sched.eventId,
      status: sched.snapshot.presentation === 'blocking' ? 'active' : 'pending',
      triggeredAtDay: sched.scheduledAtDay,
      activatedAtDay: sched.activateAtDay,
      deadlineDay: null, // 计划事件无截止（从定义中复制缺失）
      triggerContext: sched.triggerContext,
      sourceKey: sched.sourceKey,
      chainInstanceId: sched.chainInstanceId,
      snapshot: sched.snapshot,
    };
    activated.push(inst);
  }

  // 首个 blocking 事件设为 activeBlockingEventId
  const blocking = activated.find(
    (i) => i.snapshot.presentation === 'blocking' && i.status === 'active',
  );
  const newlyBlockingInstanceId = blocking?.instanceId ?? null;

  return { activatedInstances: activated, newlyBlockingInstanceId };
}

/**
 * 将已过期事件实例标记为 expired。
 *
 * 从 state.events.pending 中筛选 currentDay > deadlineDay 的实例，
 * 记录为过期历史并从 pending 中移除。
 * 阻塞事件过期时处理 activeBlockingEventId。
 *
 * @param state 游戏状态（只读）
 * @param currentDay 当前绝对游戏日
 * @returns 过期结果
 */
export function expireEventInstances(
  state: Readonly<PlayerSave>,
  currentDay: number,
): EventExpirationResult {
  const expiredRecords: EventHistoryRecord[] = [];
  const chainsToUpdate: EventChainInstance[] = [];

  for (const inst of state.events.pending) {
    if (inst.deadlineDay == null || currentDay <= inst.deadlineDay) continue;

    // 记录过期历史
    expiredRecords.push({
      eventId: inst.eventId,
      instanceId: inst.instanceId,
      finalStatus: 'expired',
      triggeredAtDay: inst.triggeredAtDay,
      completedAtDay: currentDay,
      sourceKey: inst.sourceKey,
      chainInstanceId: inst.chainInstanceId,
      titleSnapshot: inst.snapshot.title,
      chosenOptionId: null,
      chosenOptionLabel: null,
      appliedEffects: [],
    });

    // 更新链实例
    if (inst.chainInstanceId) {
      const ci = state.events.chainInstances[inst.chainInstanceId];
      if (ci) {
        chainsToUpdate.push({
          ...ci,
          activeNodeIds: ci.activeNodeIds.filter((n) => n !== inst.eventId),
        });
      }
    }
  }

  return { expiredRecords, chainsToUpdate };
}
