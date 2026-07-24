/**
 * 领域信号驱动的事件编排器
 *
 * 纯函数 processDomainSignal：根据领域信号检查所有事件候选、
 * 评估触发条件、应用重复/冷却/互斥策略，创建事件实例或计划事件，
 * 并递归处理自动事件产生的后续信号。
 *
 * 设计要点：
 * - 所有函数为纯函数，不访问 localStorage、不调用 Date.now()、不使用 Math.random()
 * - 随机性和 ID 生成通过注入的 rng 和 idFactory 实现
 * - 递归深度和单次事务信号数有硬上限防止无限循环
 */

import type { PlayerSave } from '../../types/player';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { EventDefinition } from '../../domain/events/definition';
import type {
  EventInstance,
  ScheduledEventInstance,
  EventChainInstance,
  EventExecutableSnapshot,
} from '../../domain/events/state';
import type { EventCooldownRecord } from '../../domain/events/types';
import type { EventOrchestrationDiagnostic } from '../../domain/events/types';
import { evaluateCondition } from './condition-interpreter';
import { deriveEventSourceKey } from './source-key';
import { CURRENT_CONTENT_VERSION } from '../../types/save';

const MAX_SIGNAL_DEPTH = 16;
const MAX_SIGNALS_PER_TRANSACTION = 100;

/** 编排器输入 */
export interface EventOrchestrationInput {
  state: Readonly<PlayerSave>;
  signal: DomainSignalSnapshot;
  currentDay: number;
  definitions: readonly EventDefinition[];
  rng: () => number;
  idFactory: () => string;
}

/** 编排器输出 */
export interface EventOrchestrationResult {
  createdInstances: EventInstance[];
  scheduledInstances: ScheduledEventInstance[];
  newProcessedSignalIds: string[];
  emittedSignals: DomainSignalSnapshot[];
  updatedCooldowns: EventCooldownRecord[];
  updatedChainInstances: EventChainInstance[];
  diagnostics: EventOrchestrationDiagnostic[];
}

/**
 * 从 EventDefinition 构建事件可执行快照。
 *
 * @param def 事件定义
 * @returns 可执行快照
 */
export function createEventSnapshot(def: EventDefinition): EventExecutableSnapshot {
  return {
    eventId: def.id,
    title: def.title,
    description: def.description,
    category: def.category,
    priority: def.priority,
    presentation: def.presentation,
    options: structuredClone(def.options),
    automaticOutcome: def.automaticOutcome ? structuredClone(def.automaticOutcome) : null,
    mutexGroup: def.mutexGroup ?? def.trigger.mutexGroup ?? null,
    contentVersion: def.contentVersion ?? CURRENT_CONTENT_VERSION,
    deadlineDays: def.activation.deadlineDays ?? null,
    chainId: def.chainId ?? null,
    nodeId: def.nodeId ?? null,
    repeatPolicy: structuredClone(def.repeatPolicy),
  };
}

/**
 * 构建条件评估所需的上下文。
 *
 * @param state 游戏状态
 * @param signal 触发信号
 * @param currentDay 当前绝对游戏日
 * @returns 条件评估上下文
 */
function buildEventEvalContext(
  state: Readonly<PlayerSave>,
  signal: DomainSignalSnapshot,
  currentDay: number,
) {
  return { signal, state, currentDay, daysPerYear: 360 };
}

/**
 * 计算事件激活日期（考虑延迟配置）。
 *
 * @param occurredAtDay 信号发生的游戏日
 * @param def 事件定义
 * @param rng 随机数生成器
 * @returns 激活日期
 */
function calculateActivateDay(
  occurredAtDay: number,
  def: EventDefinition,
  rng: () => number,
): number {
  const act = def.activation;
  if (act.delayRange) {
    const rangeSize = act.delayRange.max - act.delayRange.min + 1;
    const offset = Math.floor(rng() * rangeSize);
    return occurredAtDay + act.delayRange.min + offset;
  }
  return occurredAtDay + (act.delayDays ?? 0);
}

/**
 * 检查事件重复规则。
 *
 * @param state 游戏状态
 * @param def 事件定义
 * @param sourceKey 来源键
 * @param allNewInstances 当前事务已创建的实例
 * @param chainInstance 链实例
 * @returns 是否被重复规则阻止
 */
function checkEventRepeatability(
  state: Readonly<PlayerSave>,
  def: EventDefinition,
  sourceKey: string,
  allNewInstances: EventInstance[],
  chainInstance: EventChainInstance | null,
): boolean {
  const policy = def.repeatPolicy;

  switch (policy.mode) {
    case 'once': {
      const exists =
        state.events.history.some((h) => h.eventId === def.id) ||
        state.events.pending.some((p) => p.eventId === def.id) ||
        state.events.scheduled.some((s) => s.eventId === def.id) ||
        allNewInstances.some((i) => i.eventId === def.id);
      return exists;
    }
    case 'once_per_source': {
      const exists =
        state.events.history.some((h) => h.eventId === def.id && h.sourceKey === sourceKey) ||
        state.events.pending.some((p) => p.eventId === def.id && p.sourceKey === sourceKey) ||
        state.events.scheduled.some((s) => s.eventId === def.id && s.sourceKey === sourceKey) ||
        allNewInstances.some((i) => i.eventId === def.id && i.sourceKey === sourceKey);
      return exists;
    }
    case 'once_per_chain': {
      // 尚未物化的目标链没有可比较的 chainInstanceId；入选后才创建链。
      // 禁止退化为全局 eventId 检查，否则不同来源的独立链会互相阻塞。
      if (!def.chainId || !chainInstance) return false;
      if (chainInstance.completedNodeIds.includes(def.nodeId ?? def.id)) return true;
      const exists =
        state.events.history.some(
          (h) => h.eventId === def.id && h.chainInstanceId === chainInstance.instanceId,
        ) ||
        state.events.pending.some(
          (p) => p.eventId === def.id && p.chainInstanceId === chainInstance.instanceId,
        ) ||
        state.events.scheduled.some(
          (s) => s.eventId === def.id && s.chainInstanceId === chainInstance.instanceId,
        );
      return exists;
    }
    case 'repeatable': {
      if (policy.maxActivations == null) return false;
      const total =
        state.events.history.filter((h) => h.eventId === def.id).length +
        state.events.pending.filter((p) => p.eventId === def.id).length +
        state.events.scheduled.filter((s) => s.eventId === def.id).length +
        allNewInstances.filter((i) => i.eventId === def.id).length;
      return total >= policy.maxActivations;
    }
    default:
      return false;
  }
}

/**
 * 检查事件冷却。
 *
 * @param cooldowns 冷却记录数组
 * @param def 事件定义
 * @param sourceKey 来源键
 * @param chainInstanceId 链实例 ID
 * @param currentDay 当前绝对游戏日
 * @returns 如果被阻止，返回 untilDay；否则返回 null
 */
function checkEventCooldown(
  cooldowns: EventCooldownRecord[],
  def: EventDefinition,
  sourceKey: string,
  chainInstanceId: string | null,
  currentDay: number,
): number | null {
  for (const cd of cooldowns) {
    if (cd.eventId !== def.id) continue;
    if (cd.untilDay <= currentDay) continue;
    switch (cd.scope) {
      case 'global':
        return cd.untilDay;
      case 'source':
        if (cd.scopeId === sourceKey) return cd.untilDay;
        break;
      case 'chain':
        if (cd.scopeId === chainInstanceId) return cd.untilDay;
        break;
    }
  }
  return null;
}

/**
 * 加权随机选择互斥组优胜者。
 *
 * @param candidates 互斥组内候选事件
 * @param rng 随机数生成器
 * @returns 选中的事件（null 无候选）
 */
function selectMutexGroupWinner(
  candidates: EventDefinition[],
  rng: () => number,
): EventDefinition | null {
  if (candidates.length === 0) return null;
  // noUncheckedIndexedAccess: 已通过 length 检查保证索引有效
  if (candidates.length === 1) return candidates[0]!;

  const weights = candidates.map((d) => d.trigger.weight ?? 1);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return null;

  let r = rng() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

/**
 * 在已有状态和事务映射中查找链实例（只读，不创建新链）。
 *
 * 用于资格检查阶段——避免在候选事件被条件/冷却/概率淘汰时残留 ghost chain。
 *
 * @param state 游戏状态
 * @param chainId 链定义 ID
 * @param sourceKey 来源键
 * @param allChains 当前事务中已创建的链实例映射
 * @returns 事件链实例（如果存在）；null 表示尚未创建
 */
function findExistingChainInstance(
  state: Readonly<PlayerSave>,
  chainId: string,
  sourceKey: string,
  allChains: Map<string, EventChainInstance>,
): EventChainInstance | null {
  for (const ci of allChains.values()) {
    if (ci.chainId === chainId && ci.sourceKey === sourceKey) return ci;
  }
  const existing = Object.values(state.events.chainInstances).find(
    (ci) => ci.chainId === chainId && ci.sourceKey === sourceKey,
  );
  return existing ?? null;
}

/**
 * 查找或创建事件链实例（资格通过后才调用）。
 *
 * 先查事务级 allChains，再查持久化 state，避免重复创建链实例。
 *
 * @param state 游戏状态
 * @param chainId 事件链 ID
 * @param sourceKey 来源键
 * @param currentDay 当前游戏日
 * @param idFactory ID 工厂
 * @param allChains 当前事务中已创建的链实例映射
 * @returns 事件链实例（新创建的为克隆副本，避免调用方直接修改共享引用）
 */
function findOrCreateChainInstance(
  state: Readonly<PlayerSave>,
  chainId: string,
  sourceKey: string,
  currentDay: number,
  idFactory: () => string,
  allChains: Map<string, EventChainInstance>,
): EventChainInstance {
  // 先查事务级映射
  for (const ci of allChains.values()) {
    if (ci.chainId === chainId && ci.sourceKey === sourceKey) return ci;
  }

  // 再查持久化状态；必须浅克隆以避免调用方直接修改持久化引用
  const existing = Object.values(state.events.chainInstances).find(
    (ci) => ci.chainId === chainId && ci.sourceKey === sourceKey,
  );
  if (existing) {
    const clone: EventChainInstance = {
      ...existing,
      activeNodeIds: [...existing.activeNodeIds],
      completedNodeIds: [...existing.completedNodeIds],
    };
    allChains.set(clone.instanceId, clone);
    return clone;
  }

  const newChain: EventChainInstance = {
    instanceId: idFactory(),
    chainId,
    status: 'active',
    sourceKey,
    activeNodeIds: [],
    completedNodeIds: [],
    startedAtDay: currentDay,
    completedAtDay: null,
  };
  allChains.set(newChain.instanceId, newChain);
  return newChain;
}

/**
 * 检查信号是否已被处理过（通过 signalId 去重）。
 *
 * @param state 游戏状态
 * @param signalId 信号唯一 ID
 * @param allNewInstances 当前事务已创建的实例
 * @param processedIds 当前事务中已处理的信号 ID 集合
 * @returns 已处理返回 true
 */
function isSignalProcessed(
  state: Readonly<PlayerSave>,
  signalId: string,
  _allNewInstances: EventInstance[],
  processedIds: ReadonlySet<string>,
): boolean {
  if (processedIds.has(signalId)) return true;
  return state.events.processedSignalIds.includes(signalId);
}

/**
 * 解析单个信号的候选事件并创建实例（内部递归辅助）。
 *
 * @param sig 信号快照
 * @param state 游戏状态
 * @param currentDay 当前游戏日
 * @param defs 事件定义
 * @param rng 随机数生成器
 * @param idFactory ID 工厂
 * @param allNewInstances 当前事务中已创建实例（可变累加）
 * @param allScheduled 当前事务中已计划事件（可变累加）
 * @param allEmittedSignals 已发出的级联信号（可变累加）
 * @param allCooldowns 冷却记录（可变累加）
 * @param allChains 链实例（可变累加）
 * @param allDiagnostics 诊断信息（可变累加）
 * @param processedIds 当前事务中已处理的信号 ID 集合（可变累加）
 * @returns 本轮新发出的信号（需在下一深度处理）
 */
function resolveSingleSignal(
  sig: DomainSignalSnapshot,
  state: Readonly<PlayerSave>,
  currentDay: number,
  defs: readonly EventDefinition[],
  rng: () => number,
  idFactory: () => string,
  allNewInstances: EventInstance[],
  allScheduled: ScheduledEventInstance[],
  _allEmittedSignals: DomainSignalSnapshot[],
  allCooldowns: EventCooldownRecord[],
  allChains: Map<string, EventChainInstance>,
  allDiagnostics: EventOrchestrationDiagnostic[],
  processedIds: Set<string>,
): DomainSignalSnapshot[] {
  const nextSignals: DomainSignalSnapshot[] = [];

  // 信号去重
  if (isSignalProcessed(state, sig.signalId, allNewInstances, processedIds)) {
    allDiagnostics.push({ type: 'duplicate_signal', signalId: sig.signalId });
    return nextSignals;
  }

  // 记录此信号为已处理
  processedIds.add(sig.signalId);

  const resolvedParent =
    sig.signalType === 'event.resolved'
      ? state.events.history.find((item) => item.instanceId === sig.data.eventInstanceId)
      : null;
  const sourceKey = resolvedParent?.sourceKey ?? deriveEventSourceKey(sig);

  // 按稳定 ID 排序候选
  const candidates = defs
    .filter((d) => !d.trigger.scheduledOnly && d.trigger.sources.includes(sig.signalType))
    .sort((a, b) => a.id.localeCompare(b.id));

  const mutexGroupCandidates = new Map<string, EventDefinition[]>();
  const nonMutexCandidates: EventDefinition[] = [];

  for (const def of candidates) {
    const chainInstance = def.chainId
      ? findExistingChainInstance(state, def.chainId, sourceKey, allChains)
      : null;

    if (checkEventRepeatability(state, def, sourceKey, allNewInstances, chainInstance)) {
      allDiagnostics.push({ type: 'repeat_blocked', eventId: def.id });
      continue;
    }

    const allCd = [...state.events.cooldowns, ...allCooldowns];
    const cdUntil = checkEventCooldown(
      allCd,
      def,
      sourceKey,
      chainInstance?.instanceId ?? null,
      currentDay,
    );
    if (cdUntil !== null) {
      allDiagnostics.push({ type: 'cooldown_blocked', eventId: def.id, untilDay: cdUntil });
      continue;
    }

    if (def.trigger.condition) {
      const ctx = buildEventEvalContext(state, sig, currentDay);
      try {
        if (!evaluateCondition(def.trigger.condition, ctx)) {
          allDiagnostics.push({ type: 'condition_failed', eventId: def.id });
          continue;
        }
      } catch {
        allDiagnostics.push({ type: 'condition_failed', eventId: def.id });
        continue;
      }
    }

    const probability = def.trigger.probability ?? 1;
    if (probability < 1 && rng() >= probability) {
      allDiagnostics.push({ type: 'probability_failed', eventId: def.id });
      continue;
    }

    const mutexGroup = def.mutexGroup ?? def.trigger.mutexGroup;
    if (mutexGroup) {
      const group = mutexGroupCandidates.get(mutexGroup) ?? [];
      group.push(def);
      mutexGroupCandidates.set(mutexGroup, group);
    } else {
      nonMutexCandidates.push(def);
    }
  }

  const selectedDefs: EventDefinition[] = [...nonMutexCandidates];
  for (const [, group] of mutexGroupCandidates) {
    const winner = selectMutexGroupWinner(group, rng);
    if (winner) {
      for (const def of group) {
        if (def.id !== winner.id) {
          allDiagnostics.push({
            type: 'mutex_not_selected',
            eventId: def.id,
            selectedEventId: winner.id,
          });
        }
      }
      selectedDefs.push(winner);
    }
  }

  // 每个信号最多一个 blocking 事件标记为 active，其余标记为 pending
  // 如果持久化状态中已有活跃阻塞事件，本次 signal 触发的 blocking 事件亦标记为 pending
  let hasBlockingActive = state.events.activeBlockingEventId !== null;

  for (const def of selectedDefs) {
    const instanceId = idFactory();
    const activateDay = calculateActivateDay(sig.occurredAtDay, def, rng);
    const snapshot = createEventSnapshot(def);

    const deadlineDays = def.activation.deadlineDays;
    const deadlineDay = deadlineDays ? activateDay + deadlineDays : null;

    let chainInstanceId: string | null = null;
    if (def.chainId) {
      const ci = findOrCreateChainInstance(
        state,
        def.chainId,
        sourceKey,
        currentDay,
        idFactory,
        allChains,
      );
      chainInstanceId = ci.instanceId;
      if (!ci.activeNodeIds.includes(def.nodeId ?? def.id)) {
        // 创建新数组避免修改共享引用
        ci.activeNodeIds = [...ci.activeNodeIds, def.nodeId ?? def.id];
        // 终态链被后续信号重新推进时，必须恢复为活跃状态。
        ci.status = 'active';
        ci.completedAtDay = null;
      }
    }

    const delay = def.activation.delayDays ?? 0;
    const delayRange = def.activation.delayRange;
    const hasDelay = delay > 0 || delayRange != null;

    if (hasDelay) {
      allScheduled.push({
        instanceId,
        eventId: def.id,
        scheduledAtDay: currentDay,
        activateAtDay: activateDay,
        triggerContext: sig,
        sourceKey,
        chainInstanceId,
        snapshot,
      });
    } else {
      // 首个 blocking 事件标记为 active；同一信号内的后续 blocking 事件标记为 pending
      const status: 'active' | 'pending' =
        def.presentation === 'blocking' && !hasBlockingActive ? 'active' : 'pending';
      if (def.presentation === 'blocking') {
        hasBlockingActive = true;
      }
      const inst: EventInstance = {
        instanceId,
        eventId: def.id,
        status,
        triggeredAtDay: sig.occurredAtDay,
        activatedAtDay: activateDay,
        deadlineDay,
        triggerContext: sig,
        sourceKey,
        chainInstanceId,
        snapshot,
      };

      // All events (including automatic) go into createdInstances;
      // automatic events are handled by the reducer via handleAutoEventInstance.
      allNewInstances.push(inst);

      allDiagnostics.push({ type: 'instance_created', eventId: def.id, instanceId });
    }
  }

  return nextSignals;
}

/**
 * 核心信号处理器：领域信号驱动的事件编排入口。
 *
 * 采用广度优先迭代处理信号队列（而非深度递归），
 * 每个深度级别最多处理 MAX_SIGNALS_PER_TRANSACTION 个信号，
 * 递归深度限制为 MAX_SIGNAL_DEPTH。
 *
 * 对自动事件产生的级联 event.resolved 信号在同一事务内立即编排。
 *
 * @param input 编排器输入
 * @returns 编排结果
 */
export function processDomainSignal(input: EventOrchestrationInput): EventOrchestrationResult {
  const { state, signal, currentDay, definitions, rng, idFactory } = input;

  const allNewInstances: EventInstance[] = [];
  const allScheduled: ScheduledEventInstance[] = [];
  const allEmittedSignals: DomainSignalSnapshot[] = [];
  const allCooldowns: EventCooldownRecord[] = [];
  const allChains = new Map<string, EventChainInstance>();
  const allDiagnostics: EventOrchestrationDiagnostic[] = [];
  const processedIds = new Set<string>();

  let queue: DomainSignalSnapshot[] = [signal];
  let totalProcessed = 0;

  for (let depth = 0; depth <= MAX_SIGNAL_DEPTH; depth++) {
    if (queue.length === 0) break;
    if (totalProcessed >= MAX_SIGNALS_PER_TRANSACTION) break;

    const nextQueue: DomainSignalSnapshot[] = [];

    for (const sig of queue) {
      totalProcessed++;
      if (totalProcessed > MAX_SIGNALS_PER_TRANSACTION) break;

      const cascaded = resolveSingleSignal(
        sig,
        state,
        currentDay,
        definitions,
        rng,
        idFactory,
        allNewInstances,
        allScheduled,
        allEmittedSignals,
        allCooldowns,
        allChains,
        allDiagnostics,
        processedIds,
      );
      nextQueue.push(...cascaded);
    }

    queue = nextQueue;
  }

  // 收集未消费的级联信号
  allEmittedSignals.push(
    ...queue.filter((s) => !isSignalProcessed(state, s.signalId, allNewInstances, processedIds)),
  );

  return {
    createdInstances: allNewInstances,
    scheduledInstances: allScheduled,
    newProcessedSignalIds: Array.from(processedIds),
    emittedSignals: allEmittedSignals,
    updatedCooldowns: allCooldowns,
    updatedChainInstances: Array.from(allChains.values()),
    diagnostics: allDiagnostics,
  };
}
