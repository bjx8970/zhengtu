/**
 * 事件后续规划器
 *
 * 在父事件效果已经应用的状态上评估条件，并原子规划即时/延迟后续及事件链更新。
 */

import type { PlayerSave } from '../../types/player';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { EventDefinition, ScheduledFollowupDefinition } from '../../domain/events/definition';
import type {
  EventChainInstance,
  EventInstance,
  ScheduledEventInstance,
} from '../../domain/events/state';
import { evaluateCondition } from './condition-interpreter';
import { createEventSnapshot } from './event-orchestrator';
import { findEventCooldownEndDay, isEventRepeatBlocked } from './event-eligibility';
import { compareEventInstanceExecutionOrder } from './event-execution-order';

/** 后续事件规划结果 */
export interface EventFollowupPlan {
  immediateInstances: EventInstance[];
  scheduledInstances: ScheduledEventInstance[];
  chainUpdates: EventChainInstance[];
}

/** 后续事件规划输入 */
export interface PlanEventFollowupsInput {
  schedules: readonly ScheduledFollowupDefinition[] | undefined;
  parentInstance: EventInstance;
  resolvedSignal: DomainSignalSnapshot;
  state: Readonly<PlayerSave>;
  currentDay: number;
  definitions: readonly EventDefinition[];
  rng: () => number;
  idFactory: () => string;
  /** 当前事务中已排队但尚未消费的实例（例如同一信号生成的兄弟实例）。 */
  transactionInstances?: readonly EventInstance[];
}

function cloneChain(chain: EventChainInstance): EventChainInstance {
  return {
    ...chain,
    activeNodeIds: [...chain.activeNodeIds],
    completedNodeIds: [...chain.completedNodeIds],
  };
}

function findOrCreateTargetChain(
  input: PlanEventFollowupsInput,
  chainId: string,
  chains: Map<string, EventChainInstance>,
): EventChainInstance {
  const { parentInstance, state, currentDay, idFactory } = input;
  if (parentInstance.snapshot.chainId === chainId && parentInstance.chainInstanceId) {
    const parent =
      chains.get(parentInstance.chainInstanceId) ??
      state.events.chainInstances[parentInstance.chainInstanceId];
    if (parent) {
      const copy = chains.get(parent.instanceId) ?? cloneChain(parent);
      chains.set(copy.instanceId, copy);
      return copy;
    }
  }

  const existing = [...chains.values(), ...Object.values(state.events.chainInstances)].find(
    (chain) => chain.chainId === chainId && chain.sourceKey === parentInstance.sourceKey,
  );
  if (existing) {
    const copy = chains.get(existing.instanceId) ?? cloneChain(existing);
    chains.set(copy.instanceId, copy);
    return copy;
  }

  const created: EventChainInstance = {
    instanceId: idFactory(),
    chainId,
    status: 'active',
    sourceKey: parentInstance.sourceKey,
    activeNodeIds: [],
    completedNodeIds: [],
    startedAtDay: currentDay,
    completedAtDay: null,
  };
  chains.set(created.instanceId, created);
  return created;
}

function findExistingTargetChain(
  input: PlanEventFollowupsInput,
  chainId: string,
  chains: ReadonlyMap<string, EventChainInstance>,
): EventChainInstance | null {
  const { parentInstance, state } = input;
  if (parentInstance.snapshot.chainId === chainId && parentInstance.chainInstanceId) {
    return (
      chains.get(parentInstance.chainInstanceId) ??
      state.events.chainInstances[parentInstance.chainInstanceId] ??
      null
    );
  }
  return (
    [...chains.values(), ...Object.values(state.events.chainInstances)].find(
      (chain) => chain.chainId === chainId && chain.sourceKey === parentInstance.sourceKey,
    ) ?? null
  );
}

function registerNode(chain: EventChainInstance, nodeId: string): void {
  if (!chain.activeNodeIds.includes(nodeId) && !chain.completedNodeIds.includes(nodeId)) {
    chain.activeNodeIds.push(nodeId);
  }
  chain.status = 'active';
  chain.completedAtDay = null;
}

function completeParentNode(
  input: PlanEventFollowupsInput,
  chains: Map<string, EventChainInstance>,
): void {
  const { parentInstance, state, currentDay } = input;
  if (!parentInstance.chainInstanceId) return;
  const persisted = state.events.chainInstances[parentInstance.chainInstanceId];
  if (!persisted) return;

  const chain = chains.get(persisted.instanceId) ?? cloneChain(persisted);
  chains.set(chain.instanceId, chain);
  const nodeId = parentInstance.snapshot.nodeId ?? parentInstance.eventId;
  chain.activeNodeIds = chain.activeNodeIds.filter((id) => id !== nodeId);
  if (!chain.completedNodeIds.includes(nodeId)) chain.completedNodeIds.push(nodeId);
  const completed = chain.activeNodeIds.length === 0;
  chain.status = completed ? 'completed' : 'active';
  chain.completedAtDay = completed ? currentDay : null;
}

/**
 * 在结算后状态上规划后续事件和链状态。
 *
 * @param input 规划输入
 * @returns 即时实例、延迟实例和链更新
 */
export function planEventFollowups(input: PlanEventFollowupsInput): EventFollowupPlan {
  const immediateInstances: EventInstance[] = [];
  const scheduledInstances: ScheduledEventInstance[] = [];
  const chains = new Map<string, EventChainInstance>();
  const transactionInstances = [input.parentInstance, ...(input.transactionInstances ?? [])];

  const eligibleSchedules = (input.schedules ?? []).filter((schedule) => {
    if (schedule.condition) {
      try {
        const matches = evaluateCondition(schedule.condition, {
          signal: input.resolvedSignal,
          state: input.state,
          currentDay: input.currentDay,
          daysPerYear: 360,
        });
        if (!matches) return false;
      } catch {
        return false;
      }
    }
    const definition = input.definitions.find((item) => item.id === schedule.eventId);
    if (!definition) return false;
    const existingChain = definition.chainId
      ? findExistingTargetChain(input, definition.chainId, chains)
      : null;
    if (
      isEventRepeatBlocked(
        input.state,
        definition,
        input.parentInstance.sourceKey,
        transactionInstances,
        existingChain,
      )
    ) {
      return false;
    }
    return (
      findEventCooldownEndDay(
        input.state.events.cooldowns,
        definition,
        input.parentInstance.sourceKey,
        existingChain?.instanceId ?? null,
        input.currentDay,
      ) === null
    );
  });

  const selectedSchedules: ScheduledFollowupDefinition[] = [];
  const mutexGroups = new Map<string, ScheduledFollowupDefinition[]>();
  for (const schedule of eligibleSchedules) {
    if (!schedule.mutexGroup) {
      if (schedule.probability == null || input.rng() < schedule.probability) {
        selectedSchedules.push(schedule);
      }
      continue;
    }
    const group = mutexGroups.get(schedule.mutexGroup) ?? [];
    group.push(schedule);
    mutexGroups.set(schedule.mutexGroup, group);
  }
  for (const group of mutexGroups.values()) {
    const weightedSchedules = group.filter((schedule) => (schedule.probability ?? 1) > 0);
    const totalWeight = weightedSchedules.reduce(
      (sum, schedule) => sum + (schedule.probability ?? 1),
      0,
    );
    if (totalWeight <= 0) continue;
    let roll = input.rng() * totalWeight;
    for (const schedule of weightedSchedules) {
      roll -= schedule.probability ?? 1;
      if (roll < 0) {
        selectedSchedules.push(schedule);
        break;
      }
    }
  }

  for (const schedule of selectedSchedules) {
    const definition = input.definitions.find((item) => item.id === schedule.eventId);
    if (!definition) continue;

    const existingChain = definition.chainId
      ? findExistingTargetChain(input, definition.chainId, chains)
      : null;
    // 自动事件尚未写入 history，不能让它在结算 outcome 时绕过自己的
    // once / once_per_source / maxActivations 限制再次创建自身。
    const scheduledTransactionInstances = [
      ...transactionInstances,
      ...immediateInstances,
      ...scheduledInstances,
    ];
    if (
      isEventRepeatBlocked(
        input.state,
        definition,
        input.parentInstance.sourceKey,
        scheduledTransactionInstances,
        existingChain,
      )
    ) {
      continue;
    }
    if (
      findEventCooldownEndDay(
        input.state.events.cooldowns,
        definition,
        input.parentInstance.sourceKey,
        existingChain?.instanceId ?? null,
        input.currentDay,
      ) !== null
    ) {
      continue;
    }

    const chain = definition.chainId
      ? findOrCreateTargetChain(input, definition.chainId, chains)
      : null;
    if (chain) registerNode(chain, definition.nodeId ?? definition.id);

    const instanceId = input.idFactory();
    const snapshot = createEventSnapshot(definition);
    if (schedule.delayDays === 0) {
      immediateInstances.push({
        instanceId,
        eventId: definition.id,
        status: 'pending',
        triggeredAtDay: input.currentDay,
        activatedAtDay: input.currentDay,
        deadlineDay:
          snapshot.deadlineDays == null ? null : input.currentDay + snapshot.deadlineDays,
        triggerContext: input.resolvedSignal,
        sourceKey: input.parentInstance.sourceKey,
        chainInstanceId: chain?.instanceId ?? null,
        snapshot,
      });
    } else {
      scheduledInstances.push({
        instanceId,
        eventId: definition.id,
        scheduledAtDay: input.currentDay,
        activateAtDay: input.currentDay + schedule.delayDays,
        triggerContext: input.resolvedSignal,
        sourceKey: input.parentInstance.sourceKey,
        chainInstanceId: chain?.instanceId ?? null,
        snapshot,
      });
    }
  }

  // 显式 schedule 的发现顺序包含配置顺序和 mutex 选中顺序；在真正进入
  // 即时执行队列前统一按 blocker-first 规则整理，保证不会让 automatic
  // 效果越过同批 blocker。
  immediateInstances.sort(compareEventInstanceExecutionOrder);

  completeParentNode(input, chains);
  return {
    immediateInstances,
    scheduledInstances,
    chainUpdates: [...chains.values()],
  };
}
