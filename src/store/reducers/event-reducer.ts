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
import type { EventInstance, EventHistoryRecord } from '../../domain/events/state';
import type { ScheduledEventCancellation } from '../../domain/events/types';
import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { applyEffects } from '../../engine/events/effect-executor';
import { resolveEventOption } from '../../engine/events/event-resolver';
import {
  processDomainSignal,
  processScheduledFollowups,
} from '../../engine/events/event-orchestrator';
import type { EventOrchestrationResult } from '../../engine/events/event-orchestrator';
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
  let idCounter = 0;
  const idFactory = payload._idFactory ?? (() => `auto_id_${idCounter++}`);

  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();

  // 1. 调用 resolveEventOption 获取结算计划
  const plan = resolveEventOption({
    state: draft as Readonly<PlayerSave>,
    eventInstanceId: payload.eventInstanceId,
    optionId: payload.optionId,
    currentDay,
    rng,
    idFactory,
    definitions,
  });

  if (!plan.success) {
    return null;
  }

  // 2. 构建效果执行上下文并原子应用效果
  const instance = draft.events.pending.find((p) => p.instanceId === payload.eventInstanceId);
  if (!instance) return null;

  const signal = instance.triggerContext;

  const effectCtx = {
    signal,
    currentDay,
    attributeBounds: cfg.attributeBounds,
    knownInstitutionIds: new Set<string>(),
    knownRegionIds: new Set<string>(),
  };

  const result = applyEffects(draft, plan.effectsToApply, effectCtx);

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

  // 5. 添加调度事件
  for (const sched of plan.scheduled) {
    draft.events.scheduled.push(sched);
  }

  // 6. 应用链更新
  if (plan.chainUpdate) {
    draft.events.chainInstances[plan.chainUpdate.instanceId] = plan.chainUpdate;
  }

  // 7. 从 pending 移除
  const pendingIndex = draft.events.pending.findIndex(
    (p) => p.instanceId === payload.eventInstanceId,
  );
  if (pendingIndex !== -1) {
    draft.events.pending.splice(pendingIndex, 1);
  }

  // 8. 推进阻塞指针
  advanceBlockingPointer(draft);

  // 9. 构建并写入历史
  const history: EventHistoryRecord = {
    ...plan.history,
    appliedEffects,
  };
  draft.events.history.push(history);

  // 10. 处理级联信号（event.resolved → 新事件编排）并递归处理产生的自动事件
  processCascadeSignals(draft, plan.emittedSignals, currentDay, rng, idFactory, definitions);

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
): { history: EventHistoryRecord; cascadeSignals: DomainSignalSnapshot[] } {
  const outcome = instance.snapshot.automaticOutcome;
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();

  // 应用效果
  const effects = outcome?.effects ?? [];
  const effectCtx = {
    signal: instance.triggerContext,
    currentDay,
    attributeBounds: cfg.attributeBounds,
    knownInstitutionIds: new Set<string>(),
    knownRegionIds: new Set<string>(),
  };

  const result = applyEffects(draft, effects, effectCtx);

  const appliedEffects = result.applied.map((rec) => ({
    target: rec.effect.target,
    field: 'field' in rec.effect ? (rec.effect as unknown as { field: string }).field : undefined,
    operation: rec.effect.operation,
    value: rec.newValue,
    label: rec.targetDescription,
  }));

  // 冷却记录
  const def = definitions.find((d) => d.id === instance.eventId);
  if (def) {
    const cooldownDays = def.repeatPolicy.cooldownDays;
    if (cooldownDays && cooldownDays > 0) {
      const scope: 'global' | 'source' | 'chain' =
        def.repeatPolicy.mode === 'once_per_source'
          ? 'source'
          : def.repeatPolicy.mode === 'once_per_chain'
            ? 'chain'
            : 'global';
      const scopeId =
        scope === 'source'
          ? instance.sourceKey
          : scope === 'chain'
            ? instance.chainInstanceId
            : null;
      draft.events.cooldowns.push({
        eventId: instance.eventId,
        scope,
        scopeId,
        untilDay: currentDay + cooldownDays,
      });
    }
  }

  // 处理 schedule（仅创建计划事件，不发出级联信号）
  const cascadeSignals: DomainSignalSnapshot[] = [];
  if (outcome?.schedule) {
    const schedResult = processScheduledFollowups(
      outcome.schedule,
      instance.sourceKey,
      instance.chainInstanceId,
      currentDay,
      definitions,
      rng,
      idFactory,
    );
    for (const sched of schedResult) {
      draft.events.scheduled.push(sched);
    }
  }

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

  // 发出 event.resolved 信号
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
  cascadeSignals.push(resolvedSignal);

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

  return { history, cascadeSignals };
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
  const allCascadeSignals: DomainSignalSnapshot[] = [];

  // 自动事件：立即结算（不级联）
  for (const inst of plan.createdInstances) {
    if (inst.snapshot.presentation === 'automatic') {
      const { history, cascadeSignals } = handleAutoEventInstance(
        draft,
        inst,
        currentDay,
        rng,
        idFactory,
        definitions,
      );
      histories.push(history);
      allCascadeSignals.push(...cascadeSignals);
    } else {
      draft.events.pending.push(inst);
      // 更新阻塞指针
      if (
        inst.snapshot.presentation === 'blocking' &&
        draft.events.activeBlockingEventId === null
      ) {
        draft.events.activeBlockingEventId = inst.instanceId;
      }
    }
  }

  // 调度事件
  for (const sched of plan.scheduledInstances) {
    draft.events.scheduled.push(sched);
  }

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

  // 已处理信号 ID（去重追加）
  for (const sid of plan.newProcessedSignalIds) {
    if (!draft.events.processedSignalIds.includes(sid)) {
      draft.events.processedSignalIds.push(sid);
    }
  }

  return { histories, cascadeSignals: allCascadeSignals };
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
function processCascadeSignals(
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
      // 检查信号是否已被处理（通过 processedSignalIds + pending + scheduled）
      if (
        draft.events.processedSignalIds.includes(sig.signalId) ||
        draft.events.pending.some((p) => p.triggerContext.signalId === sig.signalId) ||
        draft.events.scheduled.some((s) => s.triggerContext.signalId === sig.signalId)
      ) {
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
