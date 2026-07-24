/**
 * 事件调度器与过期处理测试
 *
 * 覆盖 activateScheduledEvents 和 expireEventInstances 的全部路径。
 */
import { describe, it, expect } from 'vitest';
import { activateScheduledEvents, expireEventInstances } from '../event-scheduler';
import { createEventSnapshot } from '../event-orchestrator';
import { createInitialState } from '../../../store/game-store';
import type { PlayerSave } from '../../../types/player';
import type { ScheduledEventInstance, EventInstance } from '../../../domain/events/state';

/** 创建触发信号 */
function makeSignal(signalId = 'sig_sched') {
  return {
    signalId,
    signalType: 'world.metric_changed' as const,
    occurredAtDay: 100,
    data: { metricId: 'gdp_growth', value: 5.5 },
  };
}

/** 创建 ScheduledEventInstance */
function makeScheduled(
  instanceId: string,
  eventId: string,
  activateAtDay: number,
  scheduledAtDay: number,
  overrides?: Partial<ScheduledEventInstance>,
): ScheduledEventInstance {
  return {
    instanceId,
    eventId,
    scheduledAtDay,
    activateAtDay,
    triggerContext: makeSignal(),
    sourceKey: 'test_key',
    chainInstanceId: null,
    snapshot: createEventSnapshot({
      id: eventId,
      chainId: null,
      nodeId: null,
      title: `Event ${eventId}`,
      description: '',
      category: 'governance',
      priority: overrides?.snapshot?.priority ?? 'normal',
      presentation: overrides?.snapshot?.presentation ?? 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 7 },
      options: [],
    }),
    ...overrides,
  };
}

describe('activateScheduledEvents', () => {
  it('activateAtDay <= currentDay → activated', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [makeScheduled('sched_1', 'evt_a', 50, 45)],
      },
    };

    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.activatedInstances).toHaveLength(1);
    expect(result.activatedInstances[0]!.instanceId).toBe('sched_1');
    expect(result.activatedInstances[0]!.status).toBe('pending');
  });

  it('activateAtDay > currentDay → not activated', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [makeScheduled('sched_2', 'evt_b', 90, 80)],
      },
    };

    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.activatedInstances).toHaveLength(0);
  });

  it('activateAtDay equal to currentDay → activated', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [makeScheduled('sched_3', 'evt_c', 55, 50)],
      },
    };

    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.activatedInstances).toHaveLength(1);
  });

  it('multiple scheduled sorted by activateAtDay', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [
          makeScheduled('sched_late', 'evt_late', 40, 30),
          makeScheduled('sched_early', 'evt_early', 20, 10),
          makeScheduled('sched_mid', 'evt_mid', 30, 20),
        ],
      },
    };

    const result = activateScheduledEvents(
      state,
      50,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.activatedInstances).toHaveLength(3);
    // Should be sorted by activateAtDay
    expect(result.activatedInstances[0]!.instanceId).toBe('sched_early');
    expect(result.activatedInstances[1]!.instanceId).toBe('sched_mid');
    expect(result.activatedInstances[2]!.instanceId).toBe('sched_late');
  });

  it('blocking events set as active status', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [
          makeScheduled('sched_block', 'evt_block', 50, 40, {
            snapshot: createEventSnapshot({
              id: 'evt_block',
              chainId: null,
              nodeId: null,
              title: 'Blocking Event',
              description: '',
              category: 'governance',
              priority: 'urgent',
              presentation: 'blocking',
              trigger: { sources: ['world.metric_changed'] },
              repeatPolicy: { mode: 'once' },
              activation: { deadlineDays: 7 },
              options: [{ id: 'opt_a', label: 'A', description: '', effects: [] }],
            }),
          }),
        ],
      },
    };

    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.activatedInstances).toHaveLength(1);
    expect(result.activatedInstances[0]!.status).toBe('active');
  });

  it('newlyBlockingInstanceId returned for first blocking event', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [
          makeScheduled('sched_a', 'evt_a', 50, 40),
          makeScheduled('sched_block1', 'evt_block1', 52, 42, {
            snapshot: createEventSnapshot({
              id: 'evt_block1',
              chainId: null,
              nodeId: null,
              title: 'Block 1',
              description: '',
              category: 'governance',
              priority: 'normal',
              presentation: 'blocking',
              trigger: { sources: ['world.metric_changed'] },
              repeatPolicy: { mode: 'once' },
              activation: { deadlineDays: 7 },
              options: [{ id: 'opt_a', label: 'A', description: '', effects: [] }],
            }),
          }),
        ],
      },
    };

    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.newlyBlockingInstanceId).toBe('sched_block1');
  });

  it('no blocking events → newlyBlockingInstanceId is null', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [makeScheduled('sched_p', 'evt_p', 50, 40)],
      },
    };

    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.newlyBlockingInstanceId).toBeNull();
  });

  it('scheduled events with equal activateAtDay sorted by priority then instanceId', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [
          makeScheduled('sched_z', 'evt_z', 50, 40, {
            snapshot: createEventSnapshot({
              id: 'evt_z',
              chainId: null,
              nodeId: null,
              title: '',
              description: '',
              category: 'governance',
              priority: 'low',
              presentation: 'inbox',
              trigger: { sources: ['world.metric_changed'] },
              repeatPolicy: { mode: 'once' },
              activation: {},
              options: [],
            }),
          }),
          makeScheduled('sched_a', 'evt_a', 50, 40, {
            snapshot: createEventSnapshot({
              id: 'evt_a',
              chainId: null,
              nodeId: null,
              title: '',
              description: '',
              category: 'governance',
              priority: 'high',
              presentation: 'inbox',
              trigger: { sources: ['world.metric_changed'] },
              repeatPolicy: { mode: 'once' },
              activation: {},
              options: [],
            }),
          }),
        ],
      },
    };

    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.activatedInstances).toHaveLength(2);
    // high priority (1) before low priority (3)
    expect(result.activatedInstances[0]!.instanceId).toBe('sched_a');
    expect(result.activatedInstances[1]!.instanceId).toBe('sched_z');
  });

  it('empty scheduled returns empty result', () => {
    const state = createInitialState();
    const result = activateScheduledEvents(
      state,
      55,
      () => 0.5,
      () => 'id_x',
    );
    expect(result.activatedInstances).toHaveLength(0);
    expect(result.newlyBlockingInstanceId).toBeNull();
  });
});

describe('expireEventInstances', () => {
  function makePendingInstance(
    instanceId: string,
    eventId: string,
    deadlineDay: number | null,
    overrides?: Partial<EventInstance>,
  ): EventInstance {
    return {
      instanceId,
      eventId,
      status: 'pending',
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay,
      triggerContext: makeSignal(),
      sourceKey: 'test_key',
      chainInstanceId: null,
      snapshot: createEventSnapshot({
        id: eventId,
        chainId: null,
        nodeId: null,
        title: `Event ${eventId}`,
        description: '',
        category: 'governance',
        priority: 'normal',
        presentation: 'inbox',
        trigger: { sources: ['world.metric_changed'] },
        repeatPolicy: { mode: 'once' },
        activation: { deadlineDays: deadlineDay != null ? undefined : 7 },
        options: [],
      }),
      ...overrides,
    };
  }

  it('currentDay > deadlineDay → expired', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [makePendingInstance('p_001', 'evt_exp', 60)],
      },
    };

    const result = expireEventInstances(state, 70);
    expect(result.expiredRecords).toHaveLength(1);
    expect(result.expiredRecords[0]!.instanceId).toBe('p_001');
    expect(result.expiredRecords[0]!.finalStatus).toBe('expired');
    expect(result.expiredRecords[0]!.chosenOptionId).toBeNull();
    expect(result.expiredRecords[0]!.appliedEffects).toEqual([]);
  });

  it('currentDay <= deadlineDay → not expired', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [makePendingInstance('p_002', 'evt_not_exp', 80)],
      },
    };

    const result = expireEventInstances(state, 70);
    expect(result.expiredRecords).toHaveLength(0);
  });

  it('currentDay equal to deadlineDay → not expired', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [makePendingInstance('p_003', 'evt_eq', 70)],
      },
    };

    const result = expireEventInstances(state, 70);
    expect(result.expiredRecords).toHaveLength(0);
  });

  it('null deadline → never expires', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [makePendingInstance('p_004', 'evt_no_deadline', null)],
      },
    };

    const result = expireEventInstances(state, 999);
    expect(result.expiredRecords).toHaveLength(0);
  });

  it('multiple events: only expired removed', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [
          makePendingInstance('p_exp_1', 'evt_x1', 50),
          makePendingInstance('p_keep', 'evt_k', 100),
          makePendingInstance('p_exp_2', 'evt_x2', 40),
        ],
      },
    };

    const result = expireEventInstances(state, 60);
    expect(result.expiredRecords).toHaveLength(2);
    const expiredIds = result.expiredRecords.map((r) => r.instanceId);
    expect(expiredIds).toContain('p_exp_1');
    expect(expiredIds).toContain('p_exp_2');
    expect(expiredIds).not.toContain('p_keep');
  });

  it('chain updates for expired instances', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [
          makePendingInstance('p_chain_1', 'evt_chain_x', 50, {
            chainInstanceId: 'ci_exp',
            eventId: 'evt_chain_x',
          }),
        ],
        chainInstances: {
          ci_exp: {
            instanceId: 'ci_exp',
            chainId: 'chain_exp_test',
            status: 'active',
            sourceKey: 'test_key',
            activeNodeIds: ['evt_chain_x', 'other_node'],
            completedNodeIds: [],
            startedAtDay: 30,
            completedAtDay: null,
          },
        },
      },
    };

    const result = expireEventInstances(state, 60);
    expect(result.expiredRecords).toHaveLength(1);
    expect(result.chainsToUpdate).toHaveLength(1);
    expect(result.chainsToUpdate[0]!.activeNodeIds).toEqual(['other_node']);
  });

  it('last expired chain node marks the chain failed rather than completed', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [
          makePendingInstance('p_chain_terminal', 'evt_chain_terminal', 50, {
            chainInstanceId: 'ci_terminal',
            eventId: 'evt_chain_terminal',
          }),
        ],
        chainInstances: {
          ci_terminal: {
            instanceId: 'ci_terminal',
            chainId: 'chain_terminal',
            status: 'active',
            sourceKey: 'test_key',
            activeNodeIds: ['evt_chain_terminal'],
            completedNodeIds: [],
            startedAtDay: 30,
            completedAtDay: null,
          },
        },
      },
    };

    const result = expireEventInstances(state, 60);
    expect(result.chainsToUpdate[0]?.status).toBe('failed');
    expect(result.chainsToUpdate[0]?.completedAtDay).toBe(60);
    expect(result.chainsToUpdate[0]?.completedNodeIds).toEqual([]);
  });

  it('empty pending returns empty result', () => {
    const state = createInitialState();
    const result = expireEventInstances(state, 100);
    expect(result.expiredRecords).toHaveLength(0);
    expect(result.chainsToUpdate).toHaveLength(0);
  });

  it('expired history has titleSnapshot', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [makePendingInstance('p_title', 'evt_title_test', 50)],
      },
    };

    const result = expireEventInstances(state, 60);
    expect(result.expiredRecords).toHaveLength(1);
    expect(result.expiredRecords[0]!.titleSnapshot).toBe('Event evt_title_test');
  });

  it('expired history has completedAtDay = currentDay', () => {
    const state: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        pending: [makePendingInstance('p_day', 'evt_day_test', 50)],
      },
    };

    const result = expireEventInstances(state, 120);
    expect(result.expiredRecords).toHaveLength(1);
    expect(result.expiredRecords[0]!.completedAtDay).toBe(120);
  });
});
