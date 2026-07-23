/**
 * 事件 Reducer
 *
 * 处理 CHOOSE_EVENT_OPTION 动作：
 * - 验证事件实例状态
 * - 使用 applyEffects 原子应用效果
 * - 管理冷却、调度、取消计划事件
 * - 写入历史并更新阻塞指针
 */

import type { PlayerSave } from '../../types/player';
import type { EventHistoryRecord } from '../../domain/events/state';
import type { EventCooldownRecord, ScheduledEventCancellation } from '../../domain/events/types';
import { applyEffects } from '../../engine/events/effect-executor';
import { getConfigLoader } from '../../config/loader';

/** CHOOSE_EVENT_OPTION 载荷 */
export interface ChooseEventOptionPayload {
  eventInstanceId: string;
  optionId: string;
  _rng?: () => number;
  _idFactory?: () => string;
}

/**
 * 处理玩家选择事件选项。
 *
 * 原子操作：先验证再执行，所有效果要么全应用，要么全不应用。
 *
 * @param draft 游戏状态草稿（可变）
 * @param payload 选项参数
 * @param currentDay 当前绝对游戏日
 * @returns 历史记录（null 表示失败）
 */
export function reduceChooseEventOption(
  draft: PlayerSave,
  payload: ChooseEventOptionPayload,
  currentDay: number,
): EventHistoryRecord | null {
  // 查找事件实例
  const pendingIndex = draft.events.pending.findIndex(
    (p) => p.instanceId === payload.eventInstanceId,
  );
  if (pendingIndex === -1) return null;

  const instance = draft.events.pending[pendingIndex]!;

  // 验证状态
  if (instance.status !== 'active' && instance.status !== 'pending') return null;

  // 验证未过期
  if (instance.deadlineDay != null && currentDay > instance.deadlineDay) return null;

  // 查找选项
  const option = instance.snapshot.options.find((o) => o.id === payload.optionId);
  if (!option) return null;

  // 构建效果执行上下文
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();

  const signal = instance.triggerContext;

  const effectCtx = {
    signal,
    currentDay,
    attributeBounds: cfg.attributeBounds,
    knownInstitutionIds: new Set<string>(),
    knownRegionIds: new Set<string>(),
  };

  // 原子应用效果（失败则抛错，不修改状态）
  const result = applyEffects(draft, option.effects, effectCtx);

  // 构建 appliedEffects 记录
  const appliedEffects = result.applied.map((rec) => ({
    target: rec.effect.target,
    field: 'field' in rec.effect ? (rec.effect as unknown as { field: string }).field : undefined,
    operation: rec.effect.operation,
    value: rec.newValue,
    label: rec.targetDescription,
  }));

  // 冷却记录
  if (option.cooldownDays && option.cooldownDays > 0) {
    const cooldown: EventCooldownRecord = {
      eventId: instance.eventId,
      scope: 'global',
      scopeId: null,
      untilDay: currentDay + option.cooldownDays,
    };
    draft.events.cooldowns.push(cooldown);
  }

  // 从 pending 移除
  draft.events.pending.splice(pendingIndex, 1);

  // 推进阻塞指针
  advanceBlockingPointer(draft);

  // 构建历史记录
  const history: EventHistoryRecord = {
    eventId: instance.eventId,
    instanceId: instance.instanceId,
    finalStatus: 'resolved',
    triggeredAtDay: instance.triggeredAtDay,
    completedAtDay: currentDay,
    sourceKey: instance.sourceKey,
    chainInstanceId: instance.chainInstanceId,
    titleSnapshot: instance.snapshot.title,
    chosenOptionId: payload.optionId,
    chosenOptionLabel: option.label,
    appliedEffects,
  };
  draft.events.history.push(history);

  return history;
}

/**
 * 推进阻塞指针：从 pending 中找下一个 blocking 事件设为 activeBlockingEventId。
 *
 * @param draft 游戏状态草稿
 */
function advanceBlockingPointer(draft: PlayerSave): void {
  const nextBlocking = draft.events.pending.find((p) => p.snapshot.presentation === 'blocking');
  draft.events.activeBlockingEventId = nextBlocking?.instanceId ?? null;
}

/**
 * 按作用域取消计划事件。
 *
 * @param draft 游戏状态草稿
 * @param cancellation 取消规范
 * @param sourceKey 当前事件实例的来源键
 * @param chainInstanceId 当前事件实例的链实例 ID
 * @param currentDay 当前绝对游戏日
 */
export function cancelScheduledByScope(
  draft: PlayerSave,
  cancellation: ScheduledEventCancellation,
  sourceKey: string,
  chainInstanceId: string | null,
  _currentDay: number,
): void {
  const { eventId, scope } = cancellation;

  draft.events.scheduled = draft.events.scheduled.filter((s) => {
    if (s.eventId !== eventId) return true;

    switch (scope) {
      case 'same_chain':
        return s.chainInstanceId !== chainInstanceId;
      case 'same_source':
        return s.sourceKey !== sourceKey;
      case 'all':
        return false;
      default:
        return true;
    }
  });
}
