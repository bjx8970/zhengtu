/**
 * 事件 Reducer
 *
 * 处理 CHOOSE_EVENT_OPTION 动作：
 * - 调用 resolveEventOption 获取结算计划
 * - 原子应用效果、冷却、调度、取消、链更新
 * - 处理自动事件（立即执行效果、记录历史）
 * - 管理级联信号（event.resolved → 新事件编排）
 */

import type { PlayerSave } from '../../types/player';
import { unwrap } from 'solid-js/store';
import type { EventInstance, EventHistoryRecord } from '../../domain/events/state';
import type { ScheduledEventCancellation } from '../../domain/events/types';
import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { applyEffects } from '../../engine/events/effect-executor';
import { resolveEventOption } from '../../engine/events/event-resolver';
import { buildEventCooldownRecord } from '../../engine/events/event-cooldown';
import { processDomainSignal } from '../../engine/events/event-orchestrator';
import type { EventOrchestrationResult } from '../../engine/events/event-orchestrator';
import { planEventFollowups } from '../../engine/events/event-followup-planner';
import { getConfigLoader } from '../../config/loader';
import { createRuntimeIdFactory } from '../runtime-id';

/** CHOOSE_EVENT_OPTION 载荷 */
export interface ChooseEventOptionPayload {
  eventInstanceId: string;
  optionId: string;
  _rng?: () => number;
  _idFactory?: () => string;
}

function createEffectContext(signal: DomainSignalSnapshot, currentDay: number) {
  const loader = getConfigLoader();
  const institutions = loader.getAllInstitutions();
  return {
    signal,
    currentDay,
    attributeBounds: loader.getGameConfig().attributeBounds,
    knownInstitutionIds: new Set(institutions.map((institution) => institution.id)),
    knownRegionIds: new Set(institutions.map((institution) => institution.regionId)),
  };
}

/**
 * 处理玩家选择事件选项。
 *
 * 完整调用 resolveEventOption 获取结算计划，原子应用所有效果。
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
  const definitions = getConfigLoader().getAllEventDefinitions();
  const rng = payload._rng ?? Math.random;
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('event');

  const instance = draft.events.pending.find((item) => item.instanceId === payload.eventInstanceId);
  const option = instance?.snapshot.options.find((item) => item.id === payload.optionId);
  if (!instance || !option) return null;
  const blockingAllowed =
    instance.snapshot.presentation !== 'blocking' ||
    (instance.status === 'active' && draft.events.activeBlockingEventId === instance.instanceId);
  if (
    !blockingAllowed ||
    instance.snapshot.presentation === 'automatic' ||
    (instance.deadlineDay != null && currentDay > instance.deadlineDay)
  ) {
    return null;
  }

  // 先在事务克隆上应用效果，让后续条件观察结算后状态；真实 draft 尚未改变。
  const conditionState = structuredClone(unwrap(draft));
  applyEffects(
    conditionState,
    option.effects,
    createEffectContext(instance.triggerContext, currentDay),
  );

  // 1. 调用 resolveEventOption 获取结算计划
  const plan = resolveEventOption({
    state: draft as Readonly<PlayerSave>,
    eventInstanceId: payload.eventInstanceId,
    optionId: payload.optionId,
    currentDay,
    rng,
    idFactory,
    definitions,
    conditionState,
  });

  if (!plan.success) {
    return null;
  }

  // 2. 构建效果执行上下文并原子应用效果
  const result = applyEffects(
    draft,
    plan.effectsToApply,
    createEffectContext(instance.triggerContext, currentDay),
  );

  // 构建 appliedEffects 记录
  const appliedEffects = result.applied.map((rec) => ({
    target: rec.effect.target,
    field: 'field' in rec.effect ? (rec.effect as unknown as { field: string }).field : undefined,
    operation: rec.effect.operation,
    value: rec.newValue,
    label: rec.targetDescription,
  }));

  // 3. 应用冷却
  if (plan.cooldownUpdate) {
    draft.events.cooldowns.push(plan.cooldownUpdate);
  }

  // 4. 按作用域取消计划事件
  for (const cancellation of plan.cancellations) {
    cancelScheduledByScope(
      draft,
      cancellation,
      instance.sourceKey,
      instance.chainInstanceId,
      currentDay,
    );
  }

  // 5. 原子应用目标链更新，再添加调度事件
  for (const chain of plan.chainUpdates) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }
  for (const sched of plan.scheduledInstances) {
    draft.events.scheduled.push(sched);
  }

  // 6. 从 pending 移除
  const pendingIndex = draft.events.pending.findIndex(
    (p) => p.instanceId === payload.eventInstanceId,
  );
  if (pendingIndex !== -1) {
    draft.events.pending.splice(pendingIndex, 1);
  }

  // 7. 构建并写入历史
  const history: EventHistoryRecord = {
    ...plan.history,
    appliedEffects,
  };
  draft.events.history.push(history);

  // 8. 零延迟后续在当前有界事务内直接激活/结算
  const immediateResult = applyEventInstances(
    draft,
    plan.immediateInstances,
    currentDay,
    rng,
    idFactory,
    definitions,
  );

  // 9. 处理父事件和即时自动事件的级联信号
  advanceBlockingPointer(draft);
  processCascadeSignals(draft, plan.emittedSignals, currentDay, rng, idFactory, definitions);
  processCascadeSignals(
    draft,
    immediateResult.cascadeSignals,
    currentDay,
    rng,
    idFactory,
    definitions,
  );

  return history;
}

/**
 * 处理自动事件实例：立即应用效果、记录历史、处理调度。
 *
 * 不处理 cascade（event.resolved 级联由 applyEventOrchestrationPlan 统一处理）。
 *
 * @param draft 游戏状态草稿
 * @param instance 自动事件实例
 * @param currentDay 当前绝对游戏日
 * @param rng 随机数生成器
 * @param idFactory ID 工厂
 * @param definitions 事件定义列表
 * @returns 历史记录和发出的 cascade 信号
 */
export function handleAutoEventInstance(
  draft: PlayerSave,
  instance: EventInstance,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): {
  history: EventHistoryRecord;
  cascadeSignals: DomainSignalSnapshot[];
  immediateInstances: EventInstance[];
} {
  const outcome = instance.snapshot.automaticOutcome;

  // 应用效果
  const effects = outcome?.effects ?? [];
  const result = applyEffects(
    draft,
    effects,
    createEffectContext(instance.triggerContext, currentDay),
  );

  const appliedEffects = result.applied.map((rec) => ({
    target: rec.effect.target,
    field: 'field' in rec.effect ? (rec.effect as unknown as { field: string }).field : undefined,
    operation: rec.effect.operation,
    value: rec.newValue,
    label: rec.targetDescription,
  }));

  const cooldown = buildEventCooldownRecord(instance, undefined, currentDay);
  if (cooldown) {
    draft.events.cooldowns.push(cooldown);
  }

  const resolvedSignal: DomainSignalSnapshot = {
    signalId: idFactory(),
    signalType: 'event.resolved',
    occurredAtDay: currentDay,
    data: {
      eventInstanceId: instance.instanceId,
      eventId: instance.eventId,
      optionId: null,
      occurredAtDay: currentDay,
    },
  };

  // 效果成功后，使用真实 resolved 信号与结算后状态规划后续。
  const followups = planEventFollowups({
    schedules: outcome?.schedule,
    parentInstance: instance,
    resolvedSignal,
    state: draft as Readonly<PlayerSave>,
    currentDay,
    definitions,
    rng,
    idFactory,
  });
  for (const chain of followups.chainUpdates) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }
  draft.events.scheduled.push(...followups.scheduledInstances);

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
    chosenOptionId: null,
    chosenOptionLabel: null,
    appliedEffects,
  };
  draft.events.history.push(history);

  // 处理旧 cancelScheduledEvents 格式
  if (outcome?.cancelScheduledEvents) {
    for (const eventId of outcome.cancelScheduledEvents) {
      cancelScheduledByScope(
        draft,
        { eventId, scope: 'all' },
        instance.sourceKey,
        instance.chainInstanceId,
        currentDay,
      );
    }
  }

  // 按作用域取消计划事件
  for (const cancellation of outcome?.cancelScheduled ?? []) {
    cancelScheduledByScope(
      draft,
      cancellation,
      instance.sourceKey,
      instance.chainInstanceId,
      currentDay,
    );
  }

  return {
    history,
    cascadeSignals: [resolvedSignal],
    immediateInstances: followups.immediateInstances,
  };
}

/**
 * 在同一事务中应用即时事件实例，自动事件会继续处理零延迟后续。
 *
 * @param draft 游戏状态草稿
 * @param instances 待应用实例
 * @param currentDay 当前绝对游戏日
 * @param rng 随机数生成器
 * @param idFactory 事务共享 ID 工厂
 * @param definitions 事件定义
 * @returns 自动结算历史与级联信号
 */
export function applyEventInstances(
  draft: PlayerSave,
  instances: readonly EventInstance[],
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): { histories: EventHistoryRecord[]; cascadeSignals: DomainSignalSnapshot[] } {
  const histories: EventHistoryRecord[] = [];
  const cascadeSignals: DomainSignalSnapshot[] = [];
  const queue = [...instances];
  const maxImmediateInstances = 100;

  for (let index = 0; index < queue.length && index < maxImmediateInstances; index++) {
    const instance = queue[index]!;
    if (instance.snapshot.presentation === 'automatic') {
      const settled = handleAutoEventInstance(
        draft,
        instance,
        currentDay,
        rng,
        idFactory,
        definitions,
      );
      histories.push(settled.history);
      cascadeSignals.push(...settled.cascadeSignals);
      queue.push(...settled.immediateInstances);
    } else {
      draft.events.pending.push(instance);
    }
  }

  advanceBlockingPointer(draft);
  return { histories, cascadeSignals };
}

/**
 * 将事件编排结果应用到游戏状态草稿。
 *
 * 处理 processDomainSignal 返回的所有变更：
 * 自动实例立即结算（不级联），非自动实例加入 pending。
 * 调度/冷却/链/信号 ID 合并。级联信号返回给调用方。
 *
 * @param draft 游戏状态草稿
 * @param plan 编排结果
 * @param currentDay 当前绝对游戏日
 * @param rng 随机数生成器
 * @param idFactory ID 工厂
 * @param definitions 事件定义列表
 * @returns 聚合历史记录和待处理的级联信号
 */
export function applyEventOrchestrationPlan(
  draft: PlayerSave,
  plan: EventOrchestrationResult,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): { histories: EventHistoryRecord[]; cascadeSignals: DomainSignalSnapshot[] } {
  const histories: EventHistoryRecord[] = [];

  // 冷却记录（去重合并）
  for (const cd of plan.updatedCooldowns) {
    const exists = draft.events.cooldowns.some(
      (existing) =>
        existing.eventId === cd.eventId &&
        existing.scope === cd.scope &&
        existing.scopeId === cd.scopeId,
    );
    if (!exists) {
      draft.events.cooldowns.push(cd);
    }
  }

  // 链实例
  for (const chain of plan.updatedChainInstances) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }

  // 调度事件必须先落地，后续 resolved signal 才能按链精确去重。
  draft.events.scheduled.push(...plan.scheduledInstances);

  // 已处理信号 ID（去重追加）
  for (const sid of plan.newProcessedSignalIds) {
    if (!draft.events.processedSignalIds.includes(sid)) {
      draft.events.processedSignalIds.push(sid);
    }
  }

  const instanceResult = applyEventInstances(
    draft,
    plan.createdInstances,
    currentDay,
    rng,
    idFactory,
    definitions,
  );
  histories.push(...instanceResult.histories);
  return { histories, cascadeSignals: instanceResult.cascadeSignals };
}

/**
 * 处理级联信号：对每个信号调用 processDomainSignal 并应用结果。
 * 使用 BFS 队列防止自动事件产生的无限级联。
 *
 * @param draft 游戏状态草稿
 * @param signals 待处理的级联信号列表
 * @param currentDay 当前绝对游戏日
 * @param rng 随机数生成器
 * @param idFactory ID 工厂
 * @param definitions 事件定义列表
 */
export function processCascadeSignals(
  draft: PlayerSave,
  signals: DomainSignalSnapshot[],
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): void {
  const MAX_CASCADE_ITERATIONS = 5;
  let queue = signals;

  for (let i = 0; i < MAX_CASCADE_ITERATIONS && queue.length > 0; i++) {
    const nextSignals: DomainSignalSnapshot[] = [];

    for (const sig of queue) {
      if (draft.events.processedSignalIds.includes(sig.signalId)) {
        continue;
      }

      const orchResult = processDomainSignal({
        state: draft as Readonly<PlayerSave>,
        signal: sig,
        currentDay,
        definitions,
        rng,
        idFactory,
      });

      const { cascadeSignals } = applyEventOrchestrationPlan(
        draft,
        orchResult,
        currentDay,
        rng,
        idFactory,
        definitions,
      );
      nextSignals.push(...cascadeSignals);
    }

    queue = nextSignals;
  }
}

/**
 * 推进阻塞指针：从 pending 中找下一个 blocking 事件设为 activeBlockingEventId。
 *
 * 供 time-reducer（过期事件移除后）复用。
 *
 * @param draft 游戏状态草稿
 */
export function advanceBlockingPointer(draft: PlayerSave): void {
  const blockingInstances = draft.events.pending.filter(
    (item) => item.snapshot.presentation === 'blocking',
  );
  const pointed = blockingInstances.find(
    (item) => item.instanceId === draft.events.activeBlockingEventId,
  );
  const nextBlocking = pointed ?? blockingInstances[0];
  draft.events.activeBlockingEventId = nextBlocking?.instanceId ?? null;
  for (const instance of blockingInstances) {
    instance.status = instance.instanceId === nextBlocking?.instanceId ? 'active' : 'pending';
  }
}

/**
 * 按作用域取消计划事件。
 *
 * @param draft 游戏状态草稿
 * @param cancellation 取消规范
 * @param sourceKey 当前事件实例的来源键
 * @param chainInstanceId 当前事件实例的链实例 ID
 * @param _currentDay 当前绝对游戏日（保留参数）
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
