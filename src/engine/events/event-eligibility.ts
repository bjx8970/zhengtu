/**
 * 事件触发资格判定
 *
 * 为领域信号编排与显式后续调度提供同一套重复和冷却约束，避免两条
 * 实例创建路径出现语义分叉。
 */

import type { EventDefinition } from '../../domain/events/definition';
import type {
  EventChainInstance,
  EventHistoryRecord,
  EventInstance,
  ScheduledEventInstance,
} from '../../domain/events/state';
import type { EventCooldownRecord } from '../../domain/events/types';
import type { PlayerSave } from '../../types/player';

type EventOccurrence = Pick<EventHistoryRecord, 'eventId' | 'sourceKey' | 'chainInstanceId'>;
type PlannedEventInstance = EventInstance | ScheduledEventInstance;

/**
 * 检查事件是否已被重复策略阻止。
 *
 * @param state 当前持久化状态
 * @param definition 目标事件定义
 * @param sourceKey 触发来源键
 * @param transactionInstances 当前事务已经创建的实例
 * @param chainInstance 目标链实例（尚未物化时为 null）
 * @returns 已触发重复限制时为 true
 */
export function isEventRepeatBlocked(
  state: Readonly<PlayerSave>,
  definition: EventDefinition,
  sourceKey: string,
  transactionInstances: readonly PlannedEventInstance[],
  chainInstance: EventChainInstance | null,
): boolean {
  const exists = (predicate: (instance: EventOccurrence) => boolean): boolean =>
    state.events.history.some(predicate) ||
    state.events.pending.some(predicate) ||
    state.events.scheduled.some(predicate) ||
    transactionInstances.some(predicate);

  switch (definition.repeatPolicy.mode) {
    case 'once':
      return exists((instance) => instance.eventId === definition.id);
    case 'once_per_source':
      return exists(
        (instance) => instance.eventId === definition.id && instance.sourceKey === sourceKey,
      );
    case 'once_per_chain':
      if (!definition.chainId || !chainInstance) return false;
      return (
        chainInstance.completedNodeIds.includes(definition.nodeId ?? definition.id) ||
        exists(
          (instance) =>
            instance.eventId === definition.id &&
            instance.chainInstanceId === chainInstance.instanceId,
        )
      );
    case 'repeatable': {
      if (definition.repeatPolicy.maxActivations == null) return false;
      const total =
        state.events.history.filter((item) => item.eventId === definition.id).length +
        state.events.pending.filter((item) => item.eventId === definition.id).length +
        state.events.scheduled.filter((item) => item.eventId === definition.id).length +
        transactionInstances.filter((item) => item.eventId === definition.id).length;
      return total >= definition.repeatPolicy.maxActivations;
    }
  }
}

/**
 * 返回仍然生效的目标事件冷却结束日。
 *
 * @param cooldowns 冷却记录
 * @param definition 目标事件定义
 * @param sourceKey 触发来源键
 * @param chainInstanceId 目标链实例 ID
 * @param currentDay 当前绝对游戏日
 * @returns 冷却结束日；未受冷却限制时为 null
 */
export function findEventCooldownEndDay(
  cooldowns: readonly EventCooldownRecord[],
  definition: EventDefinition,
  sourceKey: string,
  chainInstanceId: string | null,
  currentDay: number,
): number | null {
  for (const cooldown of cooldowns) {
    if (cooldown.eventId !== definition.id || cooldown.untilDay <= currentDay) continue;
    if (
      cooldown.scope === 'global' ||
      (cooldown.scope === 'source' && cooldown.scopeId === sourceKey) ||
      (cooldown.scope === 'chain' && cooldown.scopeId === chainInstanceId)
    ) {
      return cooldown.untilDay;
    }
  }
  return null;
}
