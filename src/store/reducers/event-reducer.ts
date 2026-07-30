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
import type {
  EventChainInstance,
  EventContinuation,
  EventInstance,
  EventHistoryRecord,
} from '../../domain/events/state';
import type { ScheduledEventCancellation } from '../../domain/events/types';
import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { applyEffects } from '../../engine/events/effect-executor';
import { deriveMetricSignalsFromEffects } from '../../engine/events/metric-signal-bridge';
import { resolveEventOption } from '../../engine/events/event-resolver';
import { buildEventCooldownRecord } from '../../engine/events/event-cooldown';
import { processDomainSignal } from '../../engine/events/event-orchestrator';
import type { EventOrchestrationResult } from '../../engine/events/event-orchestrator';
import { planEventFollowups } from '../../engine/events/event-followup-planner';
import { processCareerOpportunitySignal } from '../../engine/career/opportunity-orchestrator';
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
  // 级联预算失败时不能留下半个已结算事件：整次选择在副本上规划并提交。
  const transaction = structuredClone(unwrap(draft));
  const history = reduceChooseEventOptionInternal(transaction, payload, currentDay);
  if (history) Object.assign(draft, transaction);
  return history;
}

function reduceChooseEventOptionInternal(
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
    careerExperienceQualificationRules: getConfigLoader().getCareerExperienceQualificationRules(),
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
    field: 'field' in rec.effect ? rec.effect.field : undefined,
    operation: rec.effect.operation,
    value: rec.newValue,
    label: rec.targetDescription,
  }));

  // 3. 应用冷却
  if (plan.cooldownUpdate) {
    draft.events.cooldowns.push(plan.cooldownUpdate);
  }

  // 4. 先落地完整 follow-up 计划，再执行取消。取消需要观察本次刚创建的
  // 链节点和计划实例；反过来会被基于结算前状态生成的 chainUpdates 覆盖。
  for (const chain of plan.chainUpdates) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }
  for (const sched of plan.scheduledInstances) {
    draft.events.scheduled.push(sched);
  }

  // 与 automatic outcome 一致，零延迟 follow-up 必须在取消前进入一个
  // 可变的事务视图。否则本次选项同时 schedule/cancel 某目标时，取消看不到
  // 该目标，稍后它仍会被 continuation worker 执行。
  const immediateInstances = [...plan.immediateInstances];
  for (const cancellation of plan.cancellations) {
    cancelScheduledByScope(
      draft,
      cancellation,
      instance.sourceKey,
      instance.chainInstanceId,
      currentDay,
      undefined,
      immediateInstances,
    );
  }

  // 5. 从 pending 移除
  const pendingIndex = draft.events.pending.findIndex(
    (p) => p.instanceId === payload.eventInstanceId,
  );
  if (pendingIndex !== -1) {
    draft.events.pending.splice(pendingIndex, 1);
  }

  // 6. 构建并写入历史
  const history: EventHistoryRecord = {
    ...plan.history,
    appliedEffects,
  };
  draft.events.history.push(history);

  const metricSignals = deriveMetricSignalsFromEffects(
    result.applied,
    { currentDay, policies: draft.governance.policies },
    idFactory,
  );

  // 7. 移除当前 blocker 后立即提升下一项。即时后续必须位于当前
  // event.resolved 之前；只有刚结算的 blocker 结果应抢在旧暂停尾部之前，
  // 普通 inbox 结算仍追加，避免越过先前已暂停的因果链。
  advanceBlockingPointer(draft);
  processEventContinuations(
    draft,
    [
      ...immediateInstances.map((instance) => ({
        kind: 'instance' as const,
        instance,
        cascadeDepth: 0,
      })),
      ...metricSignals.map((signal) => ({
        kind: 'signal' as const,
        signal,
        cascadeDepth: 0,
      })),
      ...plan.emittedSignals.map((signal) => ({
        kind: 'signal' as const,
        signal,
        cascadeDepth: 0,
      })),
    ],
    currentDay,
    rng,
    idFactory,
    definitions,
    instance.snapshot.presentation === 'blocking' ? 'front' : 'back',
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
 * @param inFlightContinuations 当前 worker 尚未消费的 continuation 队列
 * @param inFlightImmediateInstances 当前即时批次尚未消费的实例
 * @returns 历史记录和发出的 cascade 信号
 */
export function handleAutoEventInstance(
  draft: PlayerSave,
  instance: EventInstance,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
  inFlightContinuations?: EventContinuation[],
  inFlightImmediateInstances?: EventInstance[],
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
    field: 'field' in rec.effect ? rec.effect.field : undefined,
    operation: rec.effect.operation,
    value: rec.newValue,
    label: rec.targetDescription,
  }));

  const cooldown = buildEventCooldownRecord(instance, undefined, currentDay);
  if (cooldown) {
    draft.events.cooldowns.push(cooldown);
  }

  const metricSignals = deriveMetricSignalsFromEffects(
    result.applied,
    { currentDay, policies: draft.governance.policies },
    idFactory,
  );
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
    careerExperienceQualificationRules: getConfigLoader().getCareerExperienceQualificationRules(),
    transactionInstances: [
      ...(inFlightContinuations ?? []).flatMap((continuation) =>
        continuation.kind === 'instance' ? [continuation.instance] : [],
      ),
      ...(inFlightImmediateInstances ?? []),
    ],
  });
  for (const chain of followups.chainUpdates) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }
  draft.events.scheduled.push(...followups.scheduledInstances);

  // 零延迟后续必须在取消规则前加入同一事务队列。否则同一个 outcome
  // 同时 schedule/cancel 某目标时，目标会在取消完成后才入队并继续执行。
  // 由调用方传入的队列已是可变的未消费实例视图，后续取消会同步移除
  // 这些实例、写入取消历史并收尾其链节点。
  if (inFlightImmediateInstances) {
    inFlightImmediateInstances.unshift(...followups.immediateInstances);
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

  // 处理旧 cancelScheduledEvents 格式
  if (outcome?.cancelScheduledEvents) {
    for (const eventId of outcome.cancelScheduledEvents) {
      cancelScheduledByScope(
        draft,
        { eventId, scope: 'all' },
        instance.sourceKey,
        instance.chainInstanceId,
        currentDay,
        inFlightContinuations,
        inFlightImmediateInstances,
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
      inFlightContinuations,
      inFlightImmediateInstances,
    );
  }

  return {
    history,
    cascadeSignals: [...metricSignals, resolvedSignal],
    // 已插入当前事务队列的实例不能再次返回给调用方入队，否则会重复执行。
    immediateInstances: inFlightImmediateInstances ? [] : followups.immediateInstances,
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
  cascadeDepth = 0,
  budget?: EventInstanceBudget,
  inFlightContinuations?: EventContinuation[],
): { histories: EventHistoryRecord[]; cascadeSignals: DomainSignalSnapshot[] } {
  // 即时自动链超过预算时，调用方必须能回滚整个批次，而不能丢弃尾部实例。
  const transaction = structuredClone(unwrap(draft));
  const result = applyEventInstancesInternal(
    transaction,
    instances,
    currentDay,
    rng,
    idFactory,
    definitions,
    cascadeDepth,
    budget,
    inFlightContinuations,
  );
  Object.assign(draft, transaction);
  return result;
}

interface EventInstanceBudget {
  consumed: number;
  readonly limit: number;
}

function applyEventInstancesInternal(
  draft: PlayerSave,
  instances: readonly EventInstance[],
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
  cascadeDepth = 0,
  budget: EventInstanceBudget = { consumed: 0, limit: 100 },
  inFlightContinuations?: EventContinuation[],
): { histories: EventHistoryRecord[]; cascadeSignals: DomainSignalSnapshot[] } {
  const histories: EventHistoryRecord[] = [];
  const cascadeSignals: DomainSignalSnapshot[] = [];
  const queue = [...instances];

  while (queue.length > 0) {
    if (budget.consumed >= budget.limit) {
      throw new Error(
        `Immediate event budget exceeded (${budget.limit}); transaction was not committed`,
      );
    }
    budget.consumed += 1;
    const instance = queue.shift();
    if (!instance) continue;
    if (instance.snapshot.presentation === 'automatic') {
      const settled = handleAutoEventInstance(
        draft,
        instance,
        currentDay,
        rng,
        idFactory,
        definitions,
        inFlightContinuations,
        queue,
      );
      histories.push(settled.history);
      cascadeSignals.push(...settled.cascadeSignals);
      // 先处理自动事件的零延迟后续，才能保证它产生的 blocker 会中断尚未消费的兄弟实例。
      queue.unshift(...settled.immediateInstances);
    } else {
      draft.events.pending.push(instance);
      if (instance.snapshot.presentation === 'blocking') {
        advanceBlockingPointer(draft);
        deferImmediateInstances(draft, queue, cascadeDepth);
        break;
      }
    }
  }

  advanceBlockingPointer(draft);
  return { histories, cascadeSignals };
}

/**
 * 将因 blocker 暂停的即时实例写入统一 continuation 队列。
 *
 * 不能将它们伪装成 scheduled：事件本身与其后续 resolved 信号必须在
 * 解除 blocker 后按原有因果顺序一并恢复。
 *
 * @param draft 游戏状态草稿
 * @param instances 尚未消费的实例
 * @returns void
 */
function deferImmediateInstances(
  draft: PlayerSave,
  instances: readonly EventInstance[],
  cascadeDepth: number,
): void {
  deferEventContinuations(
    draft,
    instances.map((instance) => ({ kind: 'instance', instance, cascadeDepth })),
    'front',
  );
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
  cascadeDepth = 0,
  budget?: EventInstanceBudget,
  inFlightContinuations?: EventContinuation[],
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
    cascadeDepth,
    budget,
    inFlightContinuations,
  );
  histories.push(...instanceResult.histories);
  return { histories, cascadeSignals: instanceResult.cascadeSignals };
}

/**
 * 处理级联信号，并恢复已暂停的实例/信号 continuation。
 *
 * 新到信号追加在已暂停工作之后；玩家刚结算 blocker 时会通过
 * processEventContinuations 的 front 模式将当前结果放到旧尾部之前。
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
  processEventContinuations(
    draft,
    signals.map((signal) => ({ kind: 'signal', signal, cascadeDepth: 0 })),
    currentDay,
    rng,
    idFactory,
    definitions,
    'back',
  );
}

/**
 * 在调用方持有的事务副本上处理级联信号。
 *
 * 此入口不会再次克隆状态；调用方必须确保异常时丢弃传入的 draft，
 * 成功后再自行提交，避免嵌套事务重复深拷贝完整存档。
 *
 * @param draft 调用方创建的游戏状态事务副本
 * @param signals 待处理的级联信号列表
 * @param currentDay 当前绝对游戏日
 * @param rng 随机数生成器
 * @param idFactory ID 工厂
 * @param definitions 事件定义列表
 * @returns void
 */
export function processCascadeSignalsInTransaction(
  draft: PlayerSave,
  signals: DomainSignalSnapshot[],
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): void {
  processEventContinuationsInternal(
    draft,
    signals.map((signal) => ({ kind: 'signal', signal, cascadeDepth: 0 })),
    currentDay,
    rng,
    idFactory,
    definitions,
    'back',
  );
}

/**
 * 以统一、可持久化的队列处理事件实例和级联信号。
 *
 * @param draft 游戏状态草稿
 * @param continuations 本次新增的恢复工作
 * @param currentDay 当前绝对游戏日
 * @param rng 随机数生成器
 * @param idFactory 事务共享 ID 工厂
 * @param definitions 事件定义列表
 * @param placement front 表示当前 blocker 的结果先于旧尾部恢复
 * @returns void
 */
export function processEventContinuations(
  draft: PlayerSave,
  continuations: readonly EventContinuation[],
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
  placement: 'front' | 'back' = 'back',
): void {
  // 让超限的级联保持原子性；成功时才替换调用方草稿。
  const transaction = structuredClone(unwrap(draft));
  processEventContinuationsInternal(
    transaction,
    continuations,
    currentDay,
    rng,
    idFactory,
    definitions,
    placement,
  );
  Object.assign(draft, transaction);
}

const MAX_CASCADE_DEPTH = 16;

function continuationIdentity(continuation: EventContinuation): string {
  return continuation.kind === 'instance'
    ? `instance:${continuation.instance.instanceId}`
    : `signal:${continuation.signal.signalId}`;
}

function deduplicateContinuations(
  continuations: readonly EventContinuation[],
): EventContinuation[] {
  const known = new Set<string>();
  return continuations.filter((continuation) => {
    const identity = continuationIdentity(continuation);
    if (known.has(identity)) return false;
    known.add(identity);
    return true;
  });
}

function normalizeLegacyDeferredSignals(draft: PlayerSave): void {
  if (draft.events.deferredSignals.length === 0) return;
  const legacy = draft.events.deferredSignals.map((signal) => ({
    kind: 'signal' as const,
    signal,
    cascadeDepth: 0,
  }));
  draft.events.deferredContinuations = deduplicateContinuations([
    ...legacy,
    ...draft.events.deferredContinuations,
  ]);
  draft.events.deferredSignals = [];
}

function deferEventContinuations(
  draft: PlayerSave,
  continuations: readonly EventContinuation[],
  placement: 'front' | 'back',
): void {
  normalizeLegacyDeferredSignals(draft);
  const unprocessed = continuations.filter(
    (continuation) =>
      continuation.kind !== 'signal' ||
      !draft.events.processedSignalIds.includes(continuation.signal.signalId),
  );
  const combined =
    placement === 'front'
      ? [...unprocessed, ...draft.events.deferredContinuations]
      : [...draft.events.deferredContinuations, ...unprocessed];
  draft.events.deferredContinuations = deduplicateContinuations(combined);
}

function processEventContinuationsInternal(
  draft: PlayerSave,
  continuations: readonly EventContinuation[],
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
  placement: 'front' | 'back',
): void {
  normalizeLegacyDeferredSignals(draft);
  const deferred = draft.events.deferredContinuations;
  draft.events.deferredContinuations = [];
  const queue =
    placement === 'front' ? [...continuations, ...deferred] : [...deferred, ...continuations];
  const budget: EventInstanceBudget = { consumed: 0, limit: 100 };

  while (queue.length > 0) {
    if (draft.events.activeBlockingEventId !== null) {
      deferEventContinuations(draft, queue, 'back');
      return;
    }

    const continuation = queue.shift();
    if (!continuation) continue;
    if (continuation.kind === 'instance') {
      const { cascadeSignals } = applyEventInstances(
        draft,
        [continuation.instance],
        currentDay,
        rng,
        idFactory,
        definitions,
        continuation.cascadeDepth,
        budget,
        queue,
      );
      queue.push(
        ...cascadeSignals.map((signal) => ({
          kind: 'signal' as const,
          signal,
          cascadeDepth: continuation.cascadeDepth,
        })),
      );
      continue;
    }

    if (draft.events.processedSignalIds.includes(continuation.signal.signalId)) {
      continue;
    }
    if (continuation.cascadeDepth >= MAX_CASCADE_DEPTH) {
      throw new Error(
        `Cascade depth exceeded (${MAX_CASCADE_DEPTH}); transaction was not committed`,
      );
    }

    // Domain signals have two independent consumers. Keeping opportunity generation
    // in this shared transaction ensures every producer (policy, rank, events and
    // timeline) observes the same contract instead of relying on ad-hoc callers.
    dispatchCareerOpportunitiesForSignal(draft, continuation.signal, currentDay, idFactory);

    const orchestration = processDomainSignal({
      state: draft as Readonly<PlayerSave>,
      signal: continuation.signal,
      currentDay,
      definitions,
      rng,
      idFactory,
      transactionInstances: queue.flatMap((item) =>
        item.kind === 'instance' ? [item.instance] : [],
      ),
      careerExperienceQualificationRules: getConfigLoader().getCareerExperienceQualificationRules(),
    });
    const { cascadeSignals } = applyEventOrchestrationPlan(
      draft,
      orchestration,
      currentDay,
      rng,
      idFactory,
      definitions,
      continuation.cascadeDepth + 1,
      budget,
      queue,
    );
    const nextDepth = continuation.cascadeDepth + 1;
    queue.push(
      ...orchestration.emittedSignals.map((signal) => ({
        kind: 'signal' as const,
        signal,
        cascadeDepth: nextDepth,
      })),
      ...cascadeSignals.map((signal) => ({
        kind: 'signal' as const,
        signal,
        cascadeDepth: nextDepth,
      })),
    );
  }
}

function dispatchCareerOpportunitiesForSignal(
  draft: PlayerSave,
  signal: DomainSignalSnapshot,
  currentDay: number,
  idFactory: () => string,
): void {
  const loader = getConfigLoader();
  const result = processCareerOpportunitySignal({
    state: draft,
    signal,
    currentDay,
    idFactory,
    definitions: loader.getCareerOpportunityDefinitionsBySignal(signal.signalType),
    positions: loader.getAllPositions(),
    institutions: loader.getAllInstitutions(),
    daysPerYear: loader.getGameConfig().daysPerMonth * loader.getGameConfig().monthsPerYear,
    careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
  });
  draft.career.opportunities.push(...result.created);
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
 * @param currentDay 当前绝对游戏日
 * @param inFlightContinuations 当前 worker 尚未消费的 continuation 队列
 * @param inFlightImmediateInstances 当前即时批次尚未消费的实例
 */
export function cancelScheduledByScope(
  draft: PlayerSave,
  cancellation: ScheduledEventCancellation,
  sourceKey: string,
  chainInstanceId: string | null,
  currentDay: number,
  inFlightContinuations?: EventContinuation[],
  inFlightImmediateInstances?: EventInstance[],
): void {
  const { eventId, scope } = cancellation;
  const matchesScope = (instance: {
    eventId: string;
    sourceKey: string;
    chainInstanceId: string | null;
  }): boolean => {
    if (instance.eventId !== eventId) return false;
    switch (scope) {
      // 无链父事件没有可比较的“同链”范围，不能误伤全部无链计划事件。
      case 'same_chain':
        return chainInstanceId !== null && instance.chainInstanceId === chainInstanceId;
      case 'same_source':
        return instance.sourceKey === sourceKey;
      case 'all':
        return true;
    }
  };
  const candidates = [
    ...draft.events.scheduled.filter(matchesScope).map((instance) => ({
      instance,
      triggeredAtDay: instance.scheduledAtDay,
    })),
    ...draft.events.deferredContinuations.flatMap((continuation) =>
      continuation.kind === 'instance' && matchesScope(continuation.instance)
        ? [
            {
              instance: continuation.instance,
              triggeredAtDay: continuation.instance.triggeredAtDay,
            },
          ]
        : [],
    ),
    ...(inFlightContinuations ?? []).flatMap((continuation) =>
      continuation.kind === 'instance' && matchesScope(continuation.instance)
        ? [
            {
              instance: continuation.instance,
              triggeredAtDay: continuation.instance.triggeredAtDay,
            },
          ]
        : [],
    ),
    ...(inFlightImmediateInstances ?? [])
      .filter(matchesScope)
      .map((instance) => ({ instance, triggeredAtDay: instance.triggeredAtDay })),
  ];
  const cancelled = [
    ...new Map(candidates.map((item) => [item.instance.instanceId, item])).values(),
  ];
  if (cancelled.length === 0) return;
  draft.events.scheduled = draft.events.scheduled.filter((scheduled) => !matchesScope(scheduled));
  draft.events.deferredContinuations = draft.events.deferredContinuations.filter(
    (continuation) => continuation.kind !== 'instance' || !matchesScope(continuation.instance),
  );
  if (inFlightContinuations) {
    for (let index = inFlightContinuations.length - 1; index >= 0; index--) {
      const continuation = inFlightContinuations[index]!;
      if (continuation.kind === 'instance' && matchesScope(continuation.instance)) {
        inFlightContinuations.splice(index, 1);
      }
    }
  }
  if (inFlightImmediateInstances) {
    for (let index = inFlightImmediateInstances.length - 1; index >= 0; index--) {
      if (matchesScope(inFlightImmediateInstances[index]!)) {
        inFlightImmediateInstances.splice(index, 1);
      }
    }
  }

  const chains = new Map<string, EventChainInstance>();
  for (const { instance: cancelledInstance, triggeredAtDay } of cancelled) {
    draft.events.history.push({
      eventId: cancelledInstance.eventId,
      instanceId: cancelledInstance.instanceId,
      finalStatus: 'cancelled',
      triggeredAtDay,
      completedAtDay: currentDay,
      sourceKey: cancelledInstance.sourceKey,
      chainInstanceId: cancelledInstance.chainInstanceId,
      titleSnapshot: cancelledInstance.snapshot.title,
      chosenOptionId: null,
      chosenOptionLabel: null,
      appliedEffects: [],
    });
    if (!cancelledInstance.chainInstanceId) continue;
    const persisted =
      chains.get(cancelledInstance.chainInstanceId) ??
      draft.events.chainInstances[cancelledInstance.chainInstanceId];
    if (!persisted) continue;
    const chain = chains.get(persisted.instanceId) ?? {
      ...persisted,
      activeNodeIds: [...persisted.activeNodeIds],
      completedNodeIds: [...persisted.completedNodeIds],
    };
    const nodeId = cancelledInstance.snapshot.nodeId ?? cancelledInstance.eventId;
    chain.activeNodeIds = chain.activeNodeIds.filter((id) => id !== nodeId);
    if (chain.activeNodeIds.length === 0) {
      chain.status = 'abandoned';
      chain.completedAtDay = currentDay;
    }
    chains.set(chain.instanceId, chain);
  }
  for (const chain of chains.values()) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }
}
