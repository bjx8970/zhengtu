/**
 * 显式事件后续规划测试
 *
 * 确保显式 schedule 与领域信号触发共用重复、冷却与互斥选择约束。
 */

import { describe, expect, it } from 'vitest';
import { planEventFollowups } from '../event-followup-planner';
import { createEventSnapshot } from '../event-orchestrator';
import { createInitialState } from '../../../store/game-store';
import type { EventDefinition } from '../../../domain/events/definition';
import type { ScheduledFollowupDefinition } from '../../../domain/events/definition';
import type { EventInstance } from '../../../domain/events/state';
import type { DomainSignalSnapshot } from '../../../domain/governance/types';

function signal(): DomainSignalSnapshot {
  return {
    signalId: 'resolved_signal',
    signalType: 'event.resolved',
    occurredAtDay: 10,
    data: {
      eventInstanceId: 'parent_instance',
      eventId: 'parent',
      optionId: 'continue',
      occurredAtDay: 10,
    },
  };
}

function definition(overrides: Partial<EventDefinition>): EventDefinition {
  return {
    id: 'target',
    chainId: null,
    nodeId: null,
    title: 'Target',
    description: '',
    category: 'story',
    priority: 'normal',
    presentation: 'inbox',
    trigger: { sources: ['event.resolved'] },
    repeatPolicy: { mode: 'repeatable' },
    activation: {},
    options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
    ...overrides,
  };
}

function parent(chainInstanceId: string | null = null): EventInstance {
  const parentDefinition = definition({ id: 'parent', chainId: 'chain', nodeId: 'parent_node' });
  return {
    instanceId: 'parent_instance',
    eventId: 'parent',
    status: 'active',
    triggeredAtDay: 10,
    activatedAtDay: 10,
    deadlineDay: null,
    triggerContext: signal(),
    sourceKey: 'source',
    chainInstanceId,
    snapshot: createEventSnapshot(parentDefinition),
  };
}

function plan(
  state = createInitialState(),
  target = definition({}),
  schedules: ScheduledFollowupDefinition[] = [{ eventId: 'target', delayDays: 1 }],
  definitions: readonly EventDefinition[] = [target],
) {
  let nextId = 0;
  return planEventFollowups({
    schedules,
    parentInstance: parent('chain_instance'),
    resolvedSignal: signal(),
    state,
    currentDay: 10,
    definitions,
    rng: () => 0,
    idFactory: () => `generated_${nextId++}`,
  });
}

describe('planEventFollowups', () => {
  it('does not reschedule an already completed once_per_chain target node', () => {
    const state = createInitialState();
    state.events.chainInstances.chain_instance = {
      instanceId: 'chain_instance',
      chainId: 'chain',
      status: 'active',
      sourceKey: 'source',
      activeNodeIds: ['parent_node'],
      completedNodeIds: ['target_node'],
      startedAtDay: 0,
      completedAtDay: null,
    };
    const target = definition({
      chainId: 'chain',
      nodeId: 'target_node',
      repeatPolicy: { mode: 'once_per_chain' },
    });

    const result = plan(state, target);

    expect(result.immediateInstances).toHaveLength(0);
    expect(result.scheduledInstances).toHaveLength(0);
  });

  it('does not schedule a target event while its cooldown is active', () => {
    const state = createInitialState();
    state.events.cooldowns.push({
      eventId: 'target',
      scope: 'global',
      scopeId: null,
      untilDay: 20,
    });

    const result = plan(state);

    expect(result.immediateInstances).toHaveLength(0);
    expect(result.scheduledInstances).toHaveLength(0);
  });

  it('applies once and max-activation repeat limits to explicit schedules', () => {
    const onceState = createInitialState();
    onceState.events.history.push({
      eventId: 'target',
      instanceId: 'prior_target',
      finalStatus: 'resolved',
      triggeredAtDay: 1,
      completedAtDay: 1,
      sourceKey: 'other_source',
      chainInstanceId: null,
      titleSnapshot: 'Target',
      chosenOptionId: null,
      chosenOptionLabel: null,
      appliedEffects: [],
    });
    const maxState = createInitialState();
    maxState.events.pending.push({
      instanceId: 'active_target',
      eventId: 'target',
      status: 'pending',
      triggeredAtDay: 1,
      activatedAtDay: 1,
      deadlineDay: null,
      triggerContext: signal(),
      sourceKey: 'source',
      chainInstanceId: null,
      snapshot: createEventSnapshot(definition({})),
    });

    expect(
      plan(onceState, definition({ repeatPolicy: { mode: 'once' } })).scheduledInstances,
    ).toHaveLength(0);
    expect(
      plan(maxState, definition({ repeatPolicy: { mode: 'repeatable', maxActivations: 1 } }))
        .scheduledInstances,
    ).toHaveLength(0);
  });

  it('skips zero-weight mutex schedules at the RNG lower boundary and skips all-zero groups', () => {
    const zero = definition({ id: 'zero' });
    const positive = definition({ id: 'positive' });
    const result = plan(
      createInitialState(),
      zero,
      [
        { eventId: 'zero', delayDays: 0, probability: 0, mutexGroup: 'outcome' },
        { eventId: 'positive', delayDays: 0, probability: 1, mutexGroup: 'outcome' },
      ],
      [zero, positive],
    );
    const allZero = plan(createInitialState(), zero, [
      { eventId: 'zero', delayDays: 0, probability: 0, mutexGroup: 'outcome' },
    ]);

    expect(result.immediateInstances.map((item) => item.eventId)).toEqual(['positive']);
    expect(allZero.immediateInstances).toHaveLength(0);
  });
});
