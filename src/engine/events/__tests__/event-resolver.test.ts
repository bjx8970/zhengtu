/**
 * 事件选项结算器测试
 *
 * 覆盖 resolveEventOption 的所有路径：
 * 有效选项、无效选项、过期、效果、调度、信号生成。
 */
import { describe, it, expect } from 'vitest';
import { resolveEventOption } from '../event-resolver';
import { createEventSnapshot } from '../event-orchestrator';
import { createInitialState } from '../../../store/game-store';
import type { PlayerSave } from '../../../types/player';
import type { EventInstance, EventExecutableSnapshot } from '../../../domain/events/state';
import type { EventDefinition } from '../../../domain/events/definition';

function makeSignal() {
  return {
    signalId: 'sig_resolve_test',
    signalType: 'world.metric_changed' as const,
    occurredAtDay: 50,
    data: { metricId: 'gdp_growth', value: 5.5 },
  };
}

function makeEventDef(overrides?: Partial<EventDefinition>): EventDefinition {
  return {
    id: 'evt_resolve_target',
    chainId: null,
    nodeId: null,
    title: 'Resolve Test Event',
    description: 'Testing resolution',
    category: 'governance',
    priority: 'normal',
    presentation: 'inbox',
    trigger: { sources: ['world.metric_changed'] },
    repeatPolicy: { mode: 'once' },
    activation: { deadlineDays: 30 },
    options: [
      {
        id: 'opt_a',
        label: '选项A',
        description: '效果选项A',
        effects: [{ target: 'character', field: 'vigor', operation: 'add', value: 10 }],
      },
      {
        id: 'opt_b',
        label: '选项B',
        description: '效果选项B',
        effects: [{ target: 'character', field: 'ambition', operation: 'set', value: 80 }],
      },
    ],
    ...overrides,
  };
}

function makeInstance(
  snapshot: EventExecutableSnapshot,
  overrides?: Partial<EventInstance>,
): EventInstance {
  return {
    instanceId: 'inst_resolve_001',
    eventId: snapshot.eventId,
    status: 'pending',
    triggeredAtDay: 50,
    activatedAtDay: 50,
    deadlineDay: 80,
    triggerContext: makeSignal(),
    sourceKey: 'test_key',
    chainInstanceId: null,
    snapshot,
    ...overrides,
  };
}

function makeStateWithPending(instance: EventInstance): PlayerSave {
  return {
    ...createInitialState(),
    events: {
      ...createInitialState().events,
      pending: [instance],
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expectSuccess(result: any) {
  if (!result.success) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error(`Expected success but got failure: ${(result as any).reason}`);
  }
}

describe('resolveEventOption - 成功路径', () => {
  let idCounter = 0;

  it('valid option selection returns success with history', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot);
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.history.eventId).toBe('evt_resolve_target');
      expect(result.history.finalStatus).toBe('resolved');
      expect(result.history.chosenOptionId).toBe('opt_a');
      expect(result.history.chosenOptionLabel).toBe('选项A');
      expect(result.history.completedAtDay).toBe(60);
      expect(result.effectsToApply).toHaveLength(1);
      expect(result.effectsToApply[0]!.target).toBe('character');
    }
  });

  it('option with cooldown generates cooldownUpdate', () => {
    const def = makeEventDef({
      options: [
        {
          id: 'opt_cd',
          label: 'Cooled Option',
          description: 'With cooldown',
          effects: [],
          cooldownDays: 5,
        },
      ],
    });
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot);
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_cd',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.cooldownUpdate).not.toBeNull();
      expect(result.cooldownUpdate!.untilDay).toBe(65);
      expect(result.cooldownUpdate!.scope).toBe('global');
    }
  });

  it('option with schedule creates follow-up scheduled instances', () => {
    const def = makeEventDef({
      options: [
        {
          id: 'opt_sched',
          label: 'Scheduling Option',
          description: 'Schedules followup',
          effects: [],
          schedule: [{ eventId: 'evt_follow', delayDays: 10 }],
        },
      ],
    });
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot);
    const state = makeStateWithPending(instance);

    const followDef = makeEventDef({ id: 'evt_follow' });
    const result = resolveEventOption({
      state,
      definitions: [def, followDef],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_sched',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.scheduledInstances).toHaveLength(1);
      expect(result.scheduledInstances[0]!.eventId).toBe('evt_follow');
    }
  });

  it('event.resolved signal emitted', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot);
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      const eventResolvedSig = result.emittedSignals.find((s) => s.signalType === 'event.resolved');
      expect(eventResolvedSig).toBeDefined();
      if (eventResolvedSig && eventResolvedSig.signalType === 'event.resolved') {
        expect(eventResolvedSig.data.eventInstanceId).toBe('inst_resolve_001');
        expect(eventResolvedSig.data.eventId).toBe('evt_resolve_target');
        expect(eventResolvedSig.data.optionId).toBe('opt_a');
      }
    }
  });

  it('effects list captured correctly', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot);
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.effectsToApply).toEqual([
        { target: 'character', field: 'vigor', operation: 'add', value: 10 },
      ]);
    }
  });
});

describe('resolveEventOption - 失败路径', () => {
  let idCounter = 0;

  it('invalid option → option_not_found', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot);
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_nonexistent',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('option_not_found');
    }
  });

  it('event not found → event_not_found', () => {
    const state = createInitialState();
    const def = makeEventDef();

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_nonexistent',
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('event_not_found');
    }
  });

  it('event not active → event_not_active', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    // Instance with resolved status (should not be in pending, but test the check)
    const instance = makeInstance(snapshot, { status: 'resolved' });
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('event_not_active');
    }
  });

  it('event expired → event_expired', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot, { deadlineDay: 50 });
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_a',
      currentDay: 60, // past deadline of 50
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('event_expired');
    }
  });

  it('event without deadline (null) is not expired', () => {
    const def = makeEventDef({ activation: {} });
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot, { deadlineDay: null });
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_a',
      currentDay: 100,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
  });

  it('event expired at exact deadline day is not expired', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot, { deadlineDay: 60 });
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_a',
      currentDay: 60, // exactly at deadline
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    // Deadline check: currentDay > deadlineDay means expired, so 60 > 60 is false
    expectSuccess(result);
  });
});

describe('resolveEventOption - 链实例更新', () => {
  let idCounter = 0;

  it('chainUpdate returned when chainInstanceId present', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [
          makeInstance(snapshot, {
            instanceId: 'inst_chain_001',
            chainInstanceId: 'ci_001',
            eventId: 'evt_resolve_target',
          }),
        ],
        chainInstances: {
          ci_001: {
            instanceId: 'ci_001',
            chainId: 'chain_test',
            status: 'active',
            sourceKey: 'test_key',
            activeNodeIds: ['evt_resolve_target', 'other_node'],
            completedNodeIds: [],
            startedAtDay: 50,
            completedAtDay: null,
          },
        },
      },
    };

    const result = resolveEventOption({
      state,
      definitions: [def],
      eventInstanceId: 'inst_chain_001',
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      const chainUpdate = result.chainUpdates.find((chain) => chain.instanceId === 'ci_001');
      expect(chainUpdate).toBeDefined();
      expect(chainUpdate!.activeNodeIds).toEqual(['other_node']);
      expect(chainUpdate!.completedNodeIds).toEqual(['evt_resolve_target']);
    }
  });
});

describe('resolveEventOption - 结算后后续语义', () => {
  it('uses post-effect state and the real resolved option signal for follow-up conditions', () => {
    const parent = makeEventDef({
      id: 'evt_post_effect_parent',
      options: [
        {
          id: 'unlock',
          label: '解锁',
          description: '',
          effects: [
            { target: 'world_fact', factId: 'followup_unlocked', operation: 'set', value: true },
          ],
          schedule: [
            {
              eventId: 'evt_post_effect_child',
              delayDays: 1,
              condition: {
                all: [
                  { fact: 'followup_unlocked', op: 'is_true' },
                  { signalField: 'optionId', op: 'eq', value: 'unlock' },
                ],
              },
            },
          ],
        },
      ],
    });
    const child = makeEventDef({ id: 'evt_post_effect_child' });
    const instance = makeInstance(createEventSnapshot(parent));
    const state = makeStateWithPending(instance);
    const conditionState = structuredClone(state);
    conditionState.world.facts['followup_unlocked'] = true;

    const result = resolveEventOption({
      state,
      conditionState,
      definitions: [parent, child],
      eventInstanceId: instance.instanceId,
      optionId: 'unlock',
      currentDay: 60,
      rng: () => 0,
      idFactory: (() => {
        let id = 0;
        return () => `post_${id++}`;
      })(),
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.scheduledInstances).toHaveLength(1);
      expect(result.scheduledInstances[0]!.triggerContext).toEqual(result.emittedSignals[0]);
    }
  });

  it('returns zero-delay follow-ups as immediate instances', () => {
    const parent = makeEventDef({
      options: [
        {
          id: 'instant',
          label: '立即',
          description: '',
          effects: [],
          schedule: [{ eventId: 'evt_instant_child', delayDays: 0 }],
        },
      ],
    });
    const child = makeEventDef({ id: 'evt_instant_child' });
    const instance = makeInstance(createEventSnapshot(parent));
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [parent, child],
      eventInstanceId: instance.instanceId,
      optionId: 'instant',
      currentDay: 60,
      rng: () => 0,
      idFactory: () => 'instant_id',
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.immediateInstances).toHaveLength(1);
      expect(result.scheduledInstances).toHaveLength(0);
      expect(result.immediateInstances[0]!.activatedAtDay).toBe(60);
    }
  });

  it('uses the snapshotted repeat policy for scoped cooldowns', () => {
    const definition = makeEventDef({
      repeatPolicy: { mode: 'once_per_source', cooldownDays: 9 },
    });
    const instance = makeInstance(createEventSnapshot(definition));
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
      definitions: [makeEventDef({ id: definition.id, repeatPolicy: { mode: 'repeatable' } })],
      eventInstanceId: instance.instanceId,
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0,
      idFactory: () => 'cooldown_id',
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.cooldownUpdate).toEqual({
        eventId: definition.id,
        scope: 'source',
        scopeId: instance.sourceKey,
        untilDay: 69,
      });
    }
  });

  it('registers same-chain children before completing the parent node', () => {
    const parent = makeEventDef({
      id: 'evt_parent',
      chainId: 'chain_a',
      nodeId: 'parent',
      options: [
        {
          id: 'continue',
          label: '继续',
          description: '',
          effects: [],
          schedule: [{ eventId: 'evt_child', delayDays: 2 }],
        },
      ],
    });
    const child = makeEventDef({
      id: 'evt_child',
      chainId: 'chain_a',
      nodeId: 'child',
      repeatPolicy: { mode: 'once_per_chain' },
    });
    const instance = makeInstance(createEventSnapshot(parent), {
      eventId: parent.id,
      chainInstanceId: 'chain_instance',
    });
    const state = makeStateWithPending(instance);
    state.events.chainInstances['chain_instance'] = {
      instanceId: 'chain_instance',
      chainId: 'chain_a',
      status: 'active',
      sourceKey: instance.sourceKey,
      activeNodeIds: ['parent'],
      completedNodeIds: [],
      startedAtDay: 50,
      completedAtDay: null,
    };

    const result = resolveEventOption({
      state,
      definitions: [parent, child],
      eventInstanceId: instance.instanceId,
      optionId: 'continue',
      currentDay: 60,
      rng: () => 0,
      idFactory: () => 'child_instance',
    });

    expectSuccess(result);
    if (result.success) {
      const chain = result.chainUpdates.find((item) => item.instanceId === 'chain_instance');
      expect(chain?.activeNodeIds).toEqual(['child']);
      expect(chain?.completedNodeIds).toEqual(['parent']);
      expect(chain?.status).toBe('active');
      expect(chain?.completedAtDay).toBeNull();
      expect(result.scheduledInstances[0]!.chainInstanceId).toBe('chain_instance');
    }
  });

  it('creates a distinct target chain for cross-chain follow-ups', () => {
    const parent = makeEventDef({
      id: 'evt_cross_parent',
      chainId: 'chain_parent',
      nodeId: 'parent',
      options: [
        {
          id: 'branch',
          label: '分支',
          description: '',
          effects: [],
          schedule: [{ eventId: 'evt_cross_child', delayDays: 1 }],
        },
      ],
    });
    const child = makeEventDef({
      id: 'evt_cross_child',
      chainId: 'chain_child',
      nodeId: 'child',
      repeatPolicy: { mode: 'once_per_chain' },
    });
    const instance = makeInstance(createEventSnapshot(parent), {
      eventId: parent.id,
      chainInstanceId: 'parent_instance',
    });
    const state = makeStateWithPending(instance);
    state.events.chainInstances['parent_instance'] = {
      instanceId: 'parent_instance',
      chainId: 'chain_parent',
      status: 'active',
      sourceKey: instance.sourceKey,
      activeNodeIds: ['parent'],
      completedNodeIds: [],
      startedAtDay: 50,
      completedAtDay: null,
    };
    let sequence = 0;

    const result = resolveEventOption({
      state,
      definitions: [parent, child],
      eventInstanceId: instance.instanceId,
      optionId: 'branch',
      currentDay: 60,
      rng: () => 0,
      idFactory: () => `cross_${sequence++}`,
    });

    expectSuccess(result);
    if (result.success) {
      const target = result.chainUpdates.find((item) => item.chainId === 'chain_child');
      const source = result.chainUpdates.find((item) => item.instanceId === 'parent_instance');
      expect(target?.instanceId).not.toBe('parent_instance');
      expect(target?.activeNodeIds).toEqual(['child']);
      expect(result.scheduledInstances[0]!.chainInstanceId).toBe(target?.instanceId);
      expect(source?.status).toBe('completed');
    }
  });

  it('selects exactly one weighted mutex follow-up at both RNG boundaries', () => {
    const parent = makeEventDef({
      id: 'evt_mutex_parent',
      options: [
        {
          id: 'resolve',
          label: '结算',
          description: '',
          effects: [],
          schedule: [
            { eventId: 'evt_confirmed', delayDays: 2, probability: 0.7, mutexGroup: 'outcome' },
            { eventId: 'evt_cleared', delayDays: 2, probability: 0.3, mutexGroup: 'outcome' },
          ],
        },
      ],
    });
    const confirmed = makeEventDef({ id: 'evt_confirmed' });
    const cleared = makeEventDef({ id: 'evt_cleared' });
    const resolveWith = (rng: () => number) => {
      const instance = makeInstance(createEventSnapshot(parent), { eventId: parent.id });
      return resolveEventOption({
        state: makeStateWithPending(instance),
        definitions: [parent, confirmed, cleared],
        eventInstanceId: instance.instanceId,
        optionId: 'resolve',
        currentDay: 60,
        rng,
        idFactory: () => 'mutex_child',
      });
    };

    const low = resolveWith(() => 0);
    const high = resolveWith(() => 0.999);
    expectSuccess(low);
    expectSuccess(high);
    if (low.success && high.success) {
      expect(low.scheduledInstances.map((item) => item.eventId)).toEqual(['evt_confirmed']);
      expect(high.scheduledInstances.map((item) => item.eventId)).toEqual(['evt_cleared']);
    }
  });
});
