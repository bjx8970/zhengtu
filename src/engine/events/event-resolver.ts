/**
 * 事件选项结算器
 *
 * 纯函数 resolveEventOption：验证事件实例、解析选项效果、
 * 记录历史、生成调度计划和冷却记录。
 *
 * 效果的实际执行由 applyEffects 在 reducer 中完成，
 * 本函数仅返回待执行的 effect 列表和元数据。
 */

import type { PlayerSave } from '../../types/player';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { EffectDefinition } from '../../domain/conditions';
import type { EventInstance, EventHistoryRecord } from '../../domain/events/state';
import type { EventCooldownRecord, ScheduledEventCancellation } from '../../domain/events/types';
import type { EventOptionDefinition, EventDefinition } from '../../domain/events/definition';
import { planEventFollowups } from './event-followup-planner';
import { buildEventCooldownRecord } from './event-cooldown';

/** 选项结算输入 */
export interface ResolveEventOptionInput {
  state: Readonly<PlayerSave>;
  eventInstanceId: string;
  optionId: string;
  currentDay: number;
  rng: () => number;
  idFactory: () => string;
  definitions: readonly EventDefinition[];
  /** 已应用当前选项效果的只读状态，仅用于后续条件评估 */
  conditionState?: Readonly<PlayerSave>;
}

/** 选项结算结果 */
export type ResolveEventOptionResult =
  | {
      success: true;
      history: EventHistoryRecord;
      emittedSignals: DomainSignalSnapshot[];
      cooldownUpdate: EventCooldownRecord | null;
      immediateInstances: EventInstance[];
      scheduledInstances: import('../../domain/events/state').ScheduledEventInstance[];
      chainUpdates: import('../../domain/events/state').EventChainInstance[];
      effectsToApply: EffectDefinition[];
      cancellations: ScheduledEventCancellation[];
    }
  | {
      success: false;
      reason: 'event_not_found' | 'event_not_active' | 'event_expired' | 'option_not_found';
    };

/**
 * 结算玩家选择的事件选项。
 *
 * 验证事件实例存在且可结算，解析选项效果和调度，
 * 返回全套结算元数据供 reducer 应用。
 *
 * @param input 结算输入
 * @returns 结算结果
 */
export function resolveEventOption(input: ResolveEventOptionInput): ResolveEventOptionResult {
  const {
    state,
    eventInstanceId,
    optionId,
    currentDay,
    rng,
    idFactory,
    definitions,
    conditionState,
  } = input;

  // 查找事件实例
  const pendingIndex = state.events.pending.findIndex((p) => p.instanceId === eventInstanceId);
  if (pendingIndex === -1) {
    return { success: false, reason: 'event_not_found' };
  }

  const instance: EventInstance = state.events.pending[pendingIndex]!;

  // 验证状态
  const isBlocking = instance.snapshot.presentation === 'blocking';
  const canResolve = isBlocking
    ? instance.status === 'active' && state.events.activeBlockingEventId === instance.instanceId
    : instance.snapshot.presentation === 'inbox' &&
      (instance.status === 'active' || instance.status === 'pending');
  if (!canResolve) {
    return { success: false, reason: 'event_not_active' };
  }

  // 验证未过期
  if (instance.deadlineDay != null && currentDay > instance.deadlineDay) {
    return { success: false, reason: 'event_expired' };
  }

  // 查找选项
  const option: EventOptionDefinition | undefined = instance.snapshot.options.find(
    (o) => o.id === optionId,
  );
  if (!option) {
    return { success: false, reason: 'option_not_found' };
  }

  // 效果列表
  const effectsToApply: EffectDefinition[] = option.effects;

  // 构建 effect 记录
  const appliedEffects = effectsToApply.map((eff) => ({
    target: eff.target,
    field: 'field' in eff ? (eff as unknown as { field: string }).field : undefined,
    operation: eff.operation,
    value: eff.value,
    label: eff.target,
  }));

  // 取消规范
  const cancellations: ScheduledEventCancellation[] = [...(option.cancelScheduled ?? [])];
  // 兼容旧 cancelScheduledEvents 格式
  if (option.cancelScheduledEvents) {
    for (const eventId of option.cancelScheduledEvents) {
      cancellations.push({ eventId, scope: 'all' });
    }
  }

  // 生成 event.resolved 信号（仅在当前事件结算时发出，用于级联）
  const resolvedSignal: DomainSignalSnapshot = {
    signalId: idFactory(),
    signalType: 'event.resolved',
    occurredAtDay: currentDay,
    data: {
      eventInstanceId: instance.instanceId,
      eventId: instance.eventId,
      optionId,
      occurredAtDay: currentDay,
    },
  };

  const followups = planEventFollowups({
    schedules: option.schedule,
    parentInstance: instance,
    resolvedSignal,
    state: conditionState ?? state,
    currentDay,
    definitions,
    rng,
    idFactory,
  });

  // 历史记录
  const history: EventHistoryRecord = {
    eventId: instance.eventId,
    instanceId: instance.instanceId,
    finalStatus: 'resolved',
    triggeredAtDay: instance.triggeredAtDay,
    completedAtDay: currentDay,
    sourceKey: instance.sourceKey,
    chainInstanceId: instance.chainInstanceId,
    titleSnapshot: instance.snapshot.title,
    chosenOptionId: optionId,
    chosenOptionLabel: option.label,
    appliedEffects,
  };

  return {
    success: true,
    history,
    emittedSignals: [resolvedSignal],
    cooldownUpdate: buildEventCooldownRecord(instance, option.cooldownDays, currentDay),
    immediateInstances: followups.immediateInstances,
    scheduledInstances: followups.scheduledInstances,
    chainUpdates: followups.chainUpdates,
    effectsToApply,
    cancellations,
  };
}
