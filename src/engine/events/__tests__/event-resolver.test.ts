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

    const result = resolveEventOption({
      state,
      eventInstanceId: 'inst_resolve_001',
      optionId: 'opt_sched',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.scheduled).toHaveLength(1);
      expect(result.scheduled[0]!.eventId).toBe('evt_follow');
    }
  });

  it('event.resolved signal emitted', () => {
    const def = makeEventDef();
    const snapshot = createEventSnapshot(def);
    const instance = makeInstance(snapshot);
    const state = makeStateWithPending(instance);

    const result = resolveEventOption({
      state,
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

    const result = resolveEventOption({
      state,
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
      eventInstanceId: 'inst_chain_001',
      optionId: 'opt_a',
      currentDay: 60,
      rng: () => 0.5,
      idFactory: () => `id_${idCounter++}`,
    });

    expectSuccess(result);
    if (result.success) {
      expect(result.chainUpdate).not.toBeNull();
      expect(result.chainUpdate!.activeNodeIds).toEqual(['other_node']);
      expect(result.chainUpdate!.completedNodeIds).toEqual(['evt_resolve_target']);
    }
  });
});
