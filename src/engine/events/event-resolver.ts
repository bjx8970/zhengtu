/**
 * 事件选项结算器
 *
 * 纯函数 resolveEventOption：验证事件实例、解析选项效果、
 * 记录历史、生成调度信号和冷却记录。
 *
 * 效果的实际执行由 applyEffects 在 reducer 中完成，
 * 本函数仅返回待执行的 effect 列表和元数据。
 */

import type { PlayerSave } from '../../types/player';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { EffectDefinition } from '../../domain/conditions';
import type {
  EventInstance,
  ScheduledEventInstance,
  EventHistoryRecord,
  EventChainInstance,
} from '../../domain/events/state';
import type { EventCooldownRecord, ScheduledEventCancellation } from '../../domain/events/types';
import type {
  EventOptionDefinition,
  ScheduledFollowupDefinition,
} from '../../domain/events/definition';
import { createEventSnapshot } from './event-orchestrator';

/** 选项结算输入 */
export interface ResolveEventOptionInput {
  state: Readonly<PlayerSave>;
  eventInstanceId: string;
  optionId: string;
  currentDay: number;
  rng: () => number;
  idFactory: () => string;
}

/** 选项结算结果 */
export type ResolveEventOptionResult =
  | {
      success: true;
      history: EventHistoryRecord;
      scheduled: ScheduledEventInstance[];
      emittedSignals: DomainSignalSnapshot[];
      cooldownUpdate: EventCooldownRecord | null;
      chainUpdate: EventChainInstance | null;
      effectsToApply: EffectDefinition[];
      cancellations: ScheduledEventCancellation[];
    }
  | {
      success: false;
      reason: 'event_not_found' | 'event_not_active' | 'event_expired' | 'option_not_found';
    };

/**
 * 处理调度定义，创建 ScheduledEventInstance 列表。
 */
function resolveSchedule(
  schedules: readonly ScheduledFollowupDefinition[] | undefined,
  _sourceSignal: DomainSignalSnapshot,
  sourceKey: string,
  chainInstanceId: string | null,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
): { scheduled: ScheduledEventInstance[]; signals: DomainSignalSnapshot[] } {
  const scheduled: ScheduledEventInstance[] = [];
  const signals: DomainSignalSnapshot[] = [];

  if (!schedules) return { scheduled, signals };

  for (const sched of schedules) {
    if (sched.probability != null && rng() >= sched.probability) continue;

    const signalId = idFactory();
    const activateAtDay = currentDay + sched.delayDays;

    scheduled.push({
      instanceId: idFactory(),
      eventId: sched.eventId,
      scheduledAtDay: currentDay,
      activateAtDay,
      triggerContext: {
        signalId,
        signalType: 'event.resolved',
        occurredAtDay: currentDay,
        data: {
          eventInstanceId: `scheduled_${sched.eventId}`,
          eventId: sched.eventId,
          optionId: null,
          occurredAtDay: currentDay,
        },
      },
      sourceKey,
      chainInstanceId,
      snapshot: createEventSnapshot({
        id: sched.eventId,
        chainId: null,
        nodeId: null,
        title: '',
        description: '',
        category: 'governance',
        priority: 'normal',
        presentation: 'inbox',
        trigger: { sources: ['event.resolved'], probability: 1 },
        repeatPolicy: { mode: 'once' },
        activation: {},
        options: [],
      }),
    });

    signals.push({
      signalId,
      signalType: 'event.resolved',
      occurredAtDay: currentDay,
      data: {
        eventInstanceId: `scheduled_${sched.eventId}`,
        eventId: sched.eventId,
        optionId: null,
        occurredAtDay: currentDay,
      },
    });
  }

  return { scheduled, signals };
}

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
  const { state, eventInstanceId, optionId, currentDay, rng, idFactory } = input;

  // 查找事件实例
  const pendingIndex = state.events.pending.findIndex((p) => p.instanceId === eventInstanceId);
  if (pendingIndex === -1) {
    return { success: false, reason: 'event_not_found' };
  }

  const instance: EventInstance = state.events.pending[pendingIndex]!;

  // 验证状态
  if (instance.status !== 'active' && instance.status !== 'pending') {
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

  // 冷却计算
  let cooldownUpdate: EventCooldownRecord | null = null;
  if (option.cooldownDays && option.cooldownDays > 0) {
    cooldownUpdate = {
      eventId: instance.eventId,
      scope: 'global',
      scopeId: null,
      untilDay: currentDay + option.cooldownDays,
    };
  }

  // 调度后续事件
  const { scheduled, signals: scheduledSignals } = resolveSchedule(
    option.schedule,
    instance.triggerContext,
    instance.sourceKey,
    instance.chainInstanceId,
    currentDay,
    rng,
    idFactory,
  );

  // 取消规范
  const cancellations: ScheduledEventCancellation[] = option.cancelScheduled ?? [];
  // 兼容旧 cancelScheduledEvents 格式
  if (option.cancelScheduledEvents) {
    for (const eventId of option.cancelScheduledEvents) {
      cancellations.push({ eventId, scope: 'all' });
    }
  }

  // 事件链更新
  let chainUpdate: EventChainInstance | null = null;
  if (instance.chainInstanceId) {
    const ci = state.events.chainInstances[instance.chainInstanceId];
    if (ci) {
      chainUpdate = {
        ...ci,
        activeNodeIds: ci.activeNodeIds.filter((n) => n !== instance.eventId),
        completedNodeIds: [...ci.completedNodeIds, instance.eventId],
        completedAtDay: ci.activeNodeIds.length <= 1 ? currentDay : ci.completedAtDay,
      };
    }
  }

  // 生成 event.resolved 信号
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
    scheduled,
    emittedSignals: [resolvedSignal, ...scheduledSignals],
    cooldownUpdate,
    chainUpdate,
    effectsToApply,
    cancellations,
  };
}
