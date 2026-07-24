/**
 * 事件冷却记录构造
 *
 * 始终从事件实例快照读取重复策略，避免内容更新改变既有实例语义。
 */

import type { EventInstance } from '../../domain/events/state';
import type { EventCooldownRecord } from '../../domain/events/types';

/**
 * 从实例快照构造事件冷却记录。
 *
 * @param instance 已结算事件实例
 * @param optionCooldownDays 选项级冷却覆盖
 * @param currentDay 当前绝对游戏日
 * @returns 冷却记录；无有效冷却时返回 null
 */
export function buildEventCooldownRecord(
  instance: EventInstance,
  optionCooldownDays: number | undefined,
  currentDay: number,
): EventCooldownRecord | null {
  const cooldownDays = optionCooldownDays ?? instance.snapshot.repeatPolicy.cooldownDays;
  if (!cooldownDays || cooldownDays <= 0) return null;

  const mode = instance.snapshot.repeatPolicy.mode;
  const scope =
    mode === 'once_per_source' ? 'source' : mode === 'once_per_chain' ? 'chain' : 'global';
  const scopeId =
    scope === 'source' ? instance.sourceKey : scope === 'chain' ? instance.chainInstanceId : null;
  if (scope === 'chain' && scopeId === null) return null;
  return {
    eventId: instance.eventId,
    scope,
    scopeId,
    untilDay: currentDay + cooldownDays,
  };
}
