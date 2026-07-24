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
    return true;
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
    const totalWeight = group.reduce((sum, schedule) => sum + (schedule.probability ?? 1), 0);
    let roll = input.rng() * totalWeight;
    for (const schedule of group) {
      roll -= schedule.probability ?? 1;
      if (roll <= 0) {
        selectedSchedules.push(schedule);
        break;
      }
    }
  }

  for (const schedule of selectedSchedules) {
    const definition = input.definitions.find((item) => item.id === schedule.eventId);
    if (!definition) continue;

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

  completeParentNode(input, chains);
  return {
    immediateInstances,
    scheduledInstances,
    chainUpdates: [...chains.values()],
  };
}
