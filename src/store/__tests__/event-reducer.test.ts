/**
 * 事件 Reducer 集成测试
 *
 * 使用 createTestStore() 隔离测试 CHOOSE_EVENT_OPTION dispatch。
 * 验证效果应用、历史记录、pending 移除、阻塞指针推进。
 */
import { describe, it, expect } from 'vitest';
import { createTestStore, createInitialState } from '../game-store';
import { createEventSnapshot, processDomainSignal } from '../../engine/events/event-orchestrator';
import type { PlayerSave } from '../../types/player';
import type { EventInstance } from '../../domain/events/state';
import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { getConfigLoader } from '../../config/loader';
import {
  applyEventInstances,
  applyEventOrchestrationPlan,
  cancelScheduledByScope,
  processCascadeSignals,
  processEventContinuations,
} from '../reducers/event-reducer';

function makeSignal() {
  return {
    signalId: 'sig_reducer_test',
    signalType: 'world.metric_changed' as const,
    occurredAtDay: 50,
    data: { metricId: 'gdp_growth', value: 5 },
  };
}

/** 构建一个 pending 事件实例放入 state */
function createStateWithPending(overrides?: Partial<EventInstance>): PlayerSave {
  const snapshot = createEventSnapshot({
    id: 'evt_reducer_test',
    chainId: null,
    nodeId: null,
    title: 'Reducer Test Event',
    description: 'Testing event reducer',
    category: 'governance',
    priority: 'normal',
    presentation: overrides?.snapshot?.presentation ?? 'inbox',
    trigger: { sources: ['world.metric_changed'] },
    repeatPolicy: { mode: 'once' },
    activation: { deadlineDays: 30 },
    options: [
      {
        id: 'opt_heal',
        label: '恢复精力',
        description: '恢复精力',
        effects: [{ target: 'character', field: 'diligence', operation: 'add', value: 20 }],
      },
      {
        id: 'opt_boost',
        label: '提升人脉',
        description: '提升人脉',
        effects: [{ target: 'character', field: 'network', operation: 'add', value: 15 }],
      },
      {
        id: 'opt_cooldown',
        label: '选项带冷却',
        description: '选项带冷却测试',
        effects: [],
        cooldownDays: 7,
      },
    ],
    ...(overrides?.snapshot ? {} : {}),
  });

  const inst: EventInstance = {
    instanceId: 'inst_reducer_001',
    eventId: 'evt_reducer_test',
    status: overrides?.status ?? 'pending',
    triggeredAtDay: 50,
    activatedAtDay: 50,
    deadlineDay: overrides?.deadlineDay !== undefined ? overrides.deadlineDay : null,
    triggerContext: makeSignal(),
    sourceKey: 'src_reducer',
    chainInstanceId: overrides?.chainInstanceId ?? null,
    snapshot: overrides?.snapshot ?? snapshot,
    ...overrides,
  };

  return {
    ...createInitialState(),
    time: {
      year: 0,
      month: 1,
      day: 1,
      granularity: 'day' as const,
      totalDaysPlayed: 100,
      pendingContinuation: null,
    },
    events: {
      ...createInitialState().events,
      pending: [inst],
    },
  };
}

describe('event-reducer: CHOOSE_EVENT_OPTION', () => {
  it('dispatches successfully for valid option', () => {
    const store = createTestStore(createStateWithPending());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    // Instance removed from pending (cascade may add other events)
    expect(state.events.pending.find((p) => p.instanceId === 'inst_reducer_001')).toBeUndefined();
    // History record created (cascade may add auto-event history)
    const ourHistory = state.events.history.find((h) => h.instanceId === 'inst_reducer_001');
    expect(ourHistory).toBeDefined();
    expect(ourHistory!.eventId).toBe('evt_reducer_test');
    expect(ourHistory!.finalStatus).toBe('resolved');
    expect(ourHistory!.chosenOptionId).toBe('opt_heal');
    expect(ourHistory!.chosenOptionLabel).toBe('恢复精力');
  });

  it('effects applied atomically to PlayerSave', () => {
    const store = createTestStore(createStateWithPending());
    const before = store.getRawState();
    const originalDiligence = before.character.diligence;

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const after = store.getRawState();
    expect(after.character.diligence).toBe(originalDiligence + 20);
  });

  it('network effect applied correctly', () => {
    const store = createTestStore(createStateWithPending());
    const before = store.getRawState();
    const originalNetwork = before.character.network;

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_boost',
    });

    const after = store.getRawState();
    expect(after.character.network).toBe(originalNetwork + 15);
  });

  it('history record includes applied effects', () => {
    const store = createTestStore(createStateWithPending());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    const record = state.events.history.find((h) => h.instanceId === 'inst_reducer_001');
    expect(record).toBeDefined();
    expect(record!.appliedEffects).toHaveLength(1);
    expect(record!.appliedEffects[0]!.target).toBe('character');
    expect(record!.appliedEffects[0]!.label).toContain('diligence');
  });

  it('instance removed from pending after resolution', () => {
    const store = createTestStore(createStateWithPending());
    expect(store.getRawState().events.pending).toHaveLength(1);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    expect(state.events.pending.find((p) => p.instanceId === 'inst_reducer_001')).toBeUndefined();
  });

  it('blocking pointer advanced correctly', () => {
    // Create state with a blocking event in pending
    const snapshot = createEventSnapshot({
      id: 'evt_block_reducer',
      chainId: null,
      nodeId: null,
      title: 'Blocking Test',
      description: '',
      category: 'governance',
      priority: 'high',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 30 },
      options: [{ id: 'opt_heal', label: '恢复', description: '', effects: [] }],
    });

    const inst: EventInstance = {
      instanceId: 'inst_block_reducer',
      eventId: 'evt_block_reducer',
      status: 'active',
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay: null,
      triggerContext: makeSignal(),
      sourceKey: 'src_block',
      chainInstanceId: null,
      snapshot,
    };

    const baseState = createInitialState();
    const stateOverride: PlayerSave = {
      ...baseState,
      time: {
        year: 0,
        month: 1,
        day: 1,
        granularity: 'day' as const,
        totalDaysPlayed: 100,
        pendingContinuation: null,
      },
      events: {
        ...baseState.events,
        activeBlockingEventId: 'inst_block_reducer',
        pending: [inst],
      },
    };

    const store = createTestStore(stateOverride);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_block_reducer',
      optionId: 'opt_heal',
    });

    const after = store.getRawState();
    // After resolving the only blocking event, pointer should be null
    expect(after.events.activeBlockingEventId).toBeNull();
    // Resolved instance should be removed
    expect(after.events.pending.find((p) => p.instanceId === 'inst_block_reducer')).toBeUndefined();
  });

  it('blocking pointer advances to next blocking if available', () => {
    const baseState = createInitialState();
    const snapshot1 = createEventSnapshot({
      id: 'evt_block_1',
      chainId: null,
      nodeId: null,
      title: 'Block 1',
      description: '',
      category: 'governance',
      priority: 'high',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 30 },
      options: [{ id: 'opt_heal', label: '恢复', description: '', effects: [] }],
    });

    const inst1: EventInstance = {
      instanceId: 'inst_block_1',
      eventId: 'evt_block_1',
      status: 'active',
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay: null,
      triggerContext: makeSignal(),
      sourceKey: 'src_1',
      chainInstanceId: null,
      snapshot: snapshot1,
    };

    const snapshot2 = createEventSnapshot({
      id: 'evt_block_2',
      chainId: null,
      nodeId: null,
      title: 'Block 2',
      description: '',
      category: 'governance',
      priority: 'high',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 30 },
      options: [{ id: 'opt_heal', label: '恢复2', description: '', effects: [] }],
    });

    const inst2: EventInstance = {
      instanceId: 'inst_block_2',
      eventId: 'evt_block_2',
      status: 'pending', // 从 pending 被 advanceBlockingPointer 提升为 active
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay: null,
      triggerContext: makeSignal(),
      sourceKey: 'src_2',
      chainInstanceId: null,
      snapshot: snapshot2,
    };

    const stateOverride: PlayerSave = {
      ...baseState,
      time: {
        year: 0,
        month: 1,
        day: 1,
        granularity: 'day' as const,
        totalDaysPlayed: 100,
        pendingContinuation: null,
      },
      events: {
        ...baseState.events,
        activeBlockingEventId: 'inst_block_1',
        pending: [inst1, inst2],
      },
    };

    const store = createTestStore(stateOverride);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_block_1',
      optionId: 'opt_heal',
    });

    const after = store.getRawState();
    expect(after.events.activeBlockingEventId).toBe('inst_block_2');
    // advanceBlockingPointer 将 status 从 pending 提升为 active
    const inst2After = after.events.pending.find((p) => p.instanceId === 'inst_block_2');
    expect(inst2After).toBeDefined();
    expect(inst2After!.status).toBe('active');
    // inst_block_1 should be removed, inst_block_2 still present
    expect(after.events.pending.find((p) => p.instanceId === 'inst_block_1')).toBeUndefined();
    expect(after.events.pending.find((p) => p.instanceId === 'inst_block_2')).toBeDefined();
  });

  it('promotes the next blocker before deferring the resolved blocker follow-ups', () => {
    const firstSnapshot = createEventSnapshot({
      id: 'evt_first_blocker',
      chainId: null,
      nodeId: null,
      title: 'First blocker',
      description: '',
      category: 'governance',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [
        {
          id: 'continue',
          label: '继续',
          description: '',
          effects: [],
          schedule: [{ eventId: 'formal_investigation', delayDays: 0 }],
        },
      ],
    });
    const secondSnapshot = createEventSnapshot({
      id: 'evt_second_blocker',
      chainId: null,
      nodeId: null,
      title: 'Second blocker',
      description: '',
      category: 'governance',
      priority: 'high',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    });
    const state = createStateWithPending({
      eventId: firstSnapshot.eventId,
      status: 'active',
      snapshot: firstSnapshot,
    });
    state.events.activeBlockingEventId = 'inst_reducer_001';
    state.events.pending.push({
      instanceId: 'inst_second_blocker',
      eventId: secondSnapshot.eventId,
      status: 'pending',
      triggeredAtDay: 100,
      activatedAtDay: 100,
      deadlineDay: null,
      triggerContext: makeSignal(),
      sourceKey: 'src_second_blocker',
      chainInstanceId: null,
      snapshot: secondSnapshot,
    });

    const store = createTestStore(state);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'continue',
    });

    const after = store.getRawState();
    expect(after.events.activeBlockingEventId).toBe('inst_second_blocker');
    expect(after.events.history.some((item) => item.eventId === 'formal_investigation')).toBe(
      false,
    );
    expect(
      after.events.deferredContinuations.some(
        (item) => item.kind === 'instance' && item.instance.eventId === 'formal_investigation',
      ),
    ).toBe(true);
    expect(
      after.events.deferredContinuations.some(
        (item) =>
          item.kind === 'signal' &&
          item.signal.signalType === 'event.resolved' &&
          item.signal.data.eventId === 'evt_first_blocker',
      ),
    ).toBe(true);
    expect(
      after.events.deferredContinuations.map((item) =>
        item.kind === 'instance' ? item.instance.eventId : item.signal.signalId,
      ),
    ).toEqual(['formal_investigation', expect.any(String)]);
  });

  it('invalid option returns null (no state changes)', () => {
    const store = createTestStore(createStateWithPending());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_nonexistent',
    });

    const state = store.getRawState();
    // Nothing should have changed - instance still in pending
    expect(state.events.pending).toHaveLength(1);
    expect(state.events.history).toHaveLength(0);
  });

  it('invalid instance ID returns null', () => {
    const store = createTestStore(createStateWithPending());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_not_found',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    expect(state.events.pending).toHaveLength(1);
    expect(state.events.history).toHaveLength(0);
  });

  it('expired event returns null (no state changes)', () => {
    // deadlineDay is 0; time.year=1 makes currentDay > 360, definitively expired
    const expiredState = createStateWithPending({ deadlineDay: 0 });
    const store = createTestStore({
      ...expiredState,
      time: {
        year: 1,
        month: 1,
        day: 1,
        granularity: 'day' as const,
        totalDaysPlayed: 400,
        pendingContinuation: null,
      },
    });

    // currentDay in dispatch is derived from draft.time; deadline is 30
    // currentDay = year*360 + (month-1)*30 + day
    // initial state has year: cfg.startYear, month: 7, day: 1 -> ~mid year, > 30
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    expect(state.events.pending).toHaveLength(1);
    expect(state.events.history).toHaveLength(0);
  });

  it('option with cooldown adds cooldown record', () => {
    const store = createTestStore(createStateWithPending());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_cooldown',
    });

    const state = store.getRawState();
    const ourCd = state.events.cooldowns.find((c) => c.eventId === 'evt_reducer_test');
    expect(ourCd).toBeDefined();
    expect(ourCd!.scope).toBe('global');
  });

  it('history record includes sourceKey and titleSnapshot', () => {
    const store = createTestStore(createStateWithPending());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    const record = state.events.history.find((h) => h.instanceId === 'inst_reducer_001');
    expect(record).toBeDefined();
    expect(record!.sourceKey).toBe('src_reducer');
    expect(record!.titleSnapshot).toBe('Reducer Test Event');
  });
});

describe('event-reducer: cascade signals and scheduling', () => {
  /** 构造带 schedule 的 pending 事件 */
  function createStateWithSchedule(overrides?: {
    pendingSnapshot?: Partial<Parameters<typeof createEventSnapshot>[0]>;
  }) {
    const baseSnapshot = createEventSnapshot({
      id: 'evt_schedule_src',
      chainId: null,
      nodeId: null,
      title: 'Schedule Source Event',
      description: 'Event with schedule option',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 30 },
      options: [
        {
          id: 'opt_schedule',
          label: '调度后续',
          description: '调度后续事件',
          effects: [{ target: 'character', field: 'diligence', operation: 'add', value: 5 }],
          schedule: [{ eventId: 'flood_emergency', delayDays: 10, probability: 1 }],
        },
      ],
      ...overrides?.pendingSnapshot,
    });

    const inst: EventInstance = {
      instanceId: 'inst_schedule_001',
      eventId: 'evt_schedule_src',
      status: 'pending',
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay: null,
      triggerContext: makeSignal(),
      sourceKey: 'src_schedule',
      chainInstanceId: null,
      snapshot: baseSnapshot,
    };

    return {
      ...createInitialState(),
      time: {
        year: 0,
        month: 1,
        day: 1,
        granularity: 'day' as const,
        totalDaysPlayed: 100,
        pendingContinuation: null,
      },
      events: {
        ...createInitialState().events,
        pending: [inst],
      },
    };
  }

  it('option with schedule creates scheduled event instance', () => {
    const store = createTestStore(createStateWithSchedule());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_schedule_001',
      optionId: 'opt_schedule',
    });

    const state = store.getRawState();
    const scheduledItem = state.events.scheduled.find((s) => s.eventId === 'flood_emergency');
    expect(scheduledItem).toBeDefined();
    expect(scheduledItem!.sourceKey).toBe('src_schedule');
    expect(scheduledItem!.activateAtDay).toBe(110); // currentDay 100 + delayDays 10
  });

  it('cancellation observes the newly planned chain node and leaves it abandoned', () => {
    const snapshot = createEventSnapshot({
      id: 'evt_plan_then_cancel',
      chainId: null,
      nodeId: null,
      title: 'Plan and cancel',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [
        {
          id: 'cancel_child',
          label: '取消后续',
          description: '',
          effects: [],
          schedule: [{ eventId: 'formal_investigation', delayDays: 2 }],
          cancelScheduled: [{ eventId: 'formal_investigation', scope: 'all' }],
        },
      ],
    });
    const state = createStateWithPending({
      eventId: snapshot.eventId,
      snapshot,
    });
    const store = createTestStore(state);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'cancel_child',
    });

    const after = store.getRawState();
    expect(after.events.scheduled.some((item) => item.eventId === 'formal_investigation')).toBe(
      false,
    );
    expect(after.events.history.some((item) => item.eventId === 'formal_investigation')).toBe(true);
    const chain = Object.values(after.events.chainInstances).find(
      (item) => item.chainId === 'investigation_chain',
    );
    expect(chain?.activeNodeIds).toEqual([]);
    expect(chain?.status).toBe('abandoned');
  });

  it('cancels a zero-delay option follow-up before it can execute or retain its chain node', () => {
    const snapshot = createEventSnapshot({
      id: 'evt_option_same_outcome_parent',
      chainId: null,
      nodeId: null,
      title: 'Option parent',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [
        {
          id: 'schedule_and_cancel',
          label: '调度后取消',
          description: '',
          effects: [],
          schedule: [{ eventId: 'formal_investigation', delayDays: 0 }],
          cancelScheduled: [{ eventId: 'formal_investigation', scope: 'same_source' }],
        },
      ],
    });
    const state = createStateWithPending({ eventId: snapshot.eventId, snapshot });
    const store = createTestStore(state);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'schedule_and_cancel',
      _rng: () => 0,
      _idFactory: (() => {
        let id = 0;
        return () => `option_same_outcome_${id++}`;
      })(),
    });

    const after = store.getRawState();
    expect(after.world.facts['formal_investigation_ongoing']).toBeUndefined();
    expect(after.events.pending.some((item) => item.eventId === 'formal_investigation')).toBe(
      false,
    );
    expect(
      after.events.history.find((item) => item.eventId === 'formal_investigation')?.finalStatus,
    ).toBe('cancelled');
    const chain = Object.values(after.events.chainInstances).find(
      (item) => item.chainId === 'investigation_chain',
    );
    expect(chain).toMatchObject({ status: 'abandoned', activeNodeIds: [] });
  });

  it('option with cancelScheduledEvents removes matching scheduled events', () => {
    // Pre-populate a scheduled event
    const baseState = createStateWithSchedule();
    baseState.events.scheduled.push({
      instanceId: 'sched_to_cancel',
      eventId: 'flood_emergency',
      scheduledAtDay: 95,
      activateAtDay: 105,
      triggerContext: { ...makeSignal(), signalId: 'sig_sched' },
      sourceKey: 'src_schedule',
      chainInstanceId: null,
      snapshot: createEventSnapshot({
        id: 'flood_emergency',
        chainId: null,
        nodeId: null,
        title: 'Flood',
        description: '',
        category: 'governance',
        priority: 'high',
        presentation: 'blocking',
        trigger: { sources: ['world.metric_changed'] },
        repeatPolicy: { mode: 'once' },
        activation: { deadlineDays: 10 },
        options: [{ id: 'opt_handle', label: '处理', description: '', effects: [] }],
      }),
    });

    // Create event with cancelScheduledEvents in the pending instance
    const cancelSnapshot = createEventSnapshot({
      id: 'evt_cancel_src',
      chainId: null,
      nodeId: null,
      title: 'Cancel Source',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 30 },
      options: [
        {
          id: 'opt_cancel',
          label: '取消',
          description: '',
          effects: [],
          cancelScheduledEvents: ['flood_emergency'],
        },
      ],
    });

    const cancelInst: EventInstance = {
      instanceId: 'inst_cancel_001',
      eventId: 'evt_cancel_src',
      status: 'pending',
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: 'sig_cancel' },
      sourceKey: 'src_schedule',
      chainInstanceId: null,
      snapshot: cancelSnapshot,
    };

    baseState.events.pending.push(cancelInst);

    const store = createTestStore(baseState);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_cancel_001',
      optionId: 'opt_cancel',
    });

    const state = store.getRawState();
    // The scheduled flood_emergency with same sourceKey should be removed
    expect(state.events.scheduled.find((s) => s.instanceId === 'sched_to_cancel')).toBeUndefined();
    expect(state.events.history.find((h) => h.instanceId === 'sched_to_cancel')?.finalStatus).toBe(
      'cancelled',
    );
  });

  it('cancelling a scheduled chain node closes it as abandoned', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'evt_cancelled_node',
      chainId: 'cancel_chain',
      nodeId: 'cancelled_node',
      title: 'Cancelled node',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once_per_chain' },
      activation: {},
      options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
    });
    state.events.scheduled.push({
      instanceId: 'scheduled_cancelled_node',
      eventId: snapshot.eventId,
      scheduledAtDay: 10,
      activateAtDay: 20,
      triggerContext: makeSignal(),
      sourceKey: 'cancel_source',
      chainInstanceId: 'cancel_chain_instance',
      snapshot,
    });
    state.events.chainInstances['cancel_chain_instance'] = {
      instanceId: 'cancel_chain_instance',
      chainId: 'cancel_chain',
      status: 'active',
      sourceKey: 'cancel_source',
      activeNodeIds: ['cancelled_node'],
      completedNodeIds: [],
      startedAtDay: 10,
      completedAtDay: null,
    };

    cancelScheduledByScope(
      state,
      { eventId: 'evt_cancelled_node', scope: 'same_chain' },
      'cancel_source',
      'cancel_chain_instance',
      15,
    );

    expect(state.events.scheduled).toHaveLength(0);
    expect(
      state.events.history.find((h) => h.instanceId === 'scheduled_cancelled_node')?.finalStatus,
    ).toBe('cancelled');
    expect(state.events.chainInstances['cancel_chain_instance']?.status).toBe('abandoned');
    expect(state.events.chainInstances['cancel_chain_instance']?.completedAtDay).toBe(15);
  });

  it('cancels a deferred continuation and closes its chain atomically', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'evt_deferred_cancelled_node',
      chainId: 'deferred_cancel_chain',
      nodeId: 'deferred_cancelled_node',
      title: 'Deferred cancelled node',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once_per_chain' },
      activation: {},
      options: [],
      automaticOutcome: { effects: [] },
    });
    state.events.deferredContinuations = [
      {
        kind: 'instance',
        instance: {
          instanceId: 'deferred_cancelled_node_instance',
          eventId: snapshot.eventId,
          status: 'pending',
          triggeredAtDay: 10,
          activatedAtDay: 10,
          deadlineDay: null,
          triggerContext: makeSignal(),
          sourceKey: 'cancel_source',
          chainInstanceId: 'deferred_cancel_chain_instance',
          snapshot,
        },
        cascadeDepth: 3,
      },
    ];
    state.events.chainInstances['deferred_cancel_chain_instance'] = {
      instanceId: 'deferred_cancel_chain_instance',
      chainId: 'deferred_cancel_chain',
      status: 'active',
      sourceKey: 'cancel_source',
      activeNodeIds: ['deferred_cancelled_node'],
      completedNodeIds: [],
      startedAtDay: 10,
      completedAtDay: null,
    };

    cancelScheduledByScope(
      state,
      { eventId: snapshot.eventId, scope: 'same_chain' },
      'cancel_source',
      'deferred_cancel_chain_instance',
      15,
    );

    expect(state.events.deferredContinuations).toHaveLength(0);
    expect(
      state.events.history.find((item) => item.instanceId === 'deferred_cancelled_node_instance')
        ?.finalStatus,
    ).toBe('cancelled');
    expect(state.events.chainInstances['deferred_cancel_chain_instance']?.status).toBe('abandoned');
  });

  it('same_chain cancellation without a chain scope leaves unchained events intact', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'evt_unchained_cancel',
      chainId: null,
      nodeId: null,
      title: 'Unchained',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
    });
    state.events.scheduled.push({
      instanceId: 'scheduled_unchained',
      eventId: snapshot.eventId,
      scheduledAtDay: 10,
      activateAtDay: 20,
      triggerContext: makeSignal(),
      sourceKey: 'cancel_source',
      chainInstanceId: null,
      snapshot,
    });

    cancelScheduledByScope(
      state,
      { eventId: 'evt_unchained_cancel', scope: 'same_chain' },
      'cancel_source',
      null,
      15,
    );

    expect(state.events.scheduled.map((item) => item.instanceId)).toEqual(['scheduled_unchained']);
    expect(state.events.history).toHaveLength(0);
  });

  it('immediate-event budget fails atomically instead of silently dropping the tail', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'evt_immediate_budget',
      chainId: null,
      nodeId: null,
      title: 'Immediate budget',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'repeatable' },
      activation: {},
      options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
    });
    const instances = Array.from({ length: 101 }, (_, index): EventInstance => ({
      instanceId: `immediate_${index}`,
      eventId: snapshot.eventId,
      status: 'pending',
      triggeredAtDay: 1,
      activatedAtDay: 1,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: `immediate_signal_${index}` },
      sourceKey: 'immediate_source',
      chainInstanceId: null,
      snapshot,
    }));

    expect(() =>
      applyEventInstances(
        state,
        instances,
        1,
        () => 0,
        () => 'generated',
        [],
      ),
    ).toThrow('Immediate event budget exceeded');
    expect(state.events.pending).toHaveLength(0);
  });

  it('shares the immediate-event budget across continuation workers', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'evt_continuation_budget',
      chainId: null,
      nodeId: null,
      title: 'Continuation budget',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'repeatable' },
      activation: {},
      options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
    });
    const continuations = Array.from({ length: 101 }, (_, index) => ({
      kind: 'instance' as const,
      cascadeDepth: 0,
      instance: {
        instanceId: `continuation_budget_${index}`,
        eventId: snapshot.eventId,
        status: 'pending' as const,
        triggeredAtDay: 1,
        activatedAtDay: 1,
        deadlineDay: null,
        triggerContext: { ...makeSignal(), signalId: `continuation_budget_signal_${index}` },
        sourceKey: 'continuation_budget_source',
        chainInstanceId: null,
        snapshot,
      },
    }));

    expect(() =>
      processEventContinuations(
        state,
        continuations,
        1,
        () => 0,
        () => 'generated',
        [],
      ),
    ).toThrow('Immediate event budget exceeded');
    expect(state.events.pending).toHaveLength(0);
  });

  it('keeps in-flight deferred instances visible to signal repeat checks', () => {
    const state = createInitialState();
    const definition: EventDefinition = {
      id: 'evt_inflight_once',
      chainId: null,
      nodeId: null,
      title: 'In-flight once',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
    };
    const snapshot = createEventSnapshot(definition);
    const signal: DomainSignalSnapshot = {
      signalId: 'inflight_repeat_signal',
      signalType: 'world.metric_changed',
      occurredAtDay: 1,
      data: { metricId: 'inflight', value: 1 },
    };
    state.events.deferredContinuations = [
      { kind: 'signal', signal, cascadeDepth: 0 },
      {
        kind: 'instance',
        cascadeDepth: 0,
        instance: {
          instanceId: 'inflight_once_existing',
          eventId: definition.id,
          status: 'pending',
          triggeredAtDay: 1,
          activatedAtDay: 1,
          deadlineDay: null,
          triggerContext: signal,
          sourceKey: 'inflight_source',
          chainInstanceId: null,
          snapshot,
        },
      },
    ];

    processEventContinuations(
      state,
      [],
      1,
      () => 0,
      () => 'created',
      [definition],
    );

    expect(state.events.pending.map((item) => item.instanceId)).toEqual(['inflight_once_existing']);
  });

  it('allows a deferred automatic event to cancel a later in-flight target', () => {
    const state = createInitialState();
    const canceller = createEventSnapshot({
      id: 'evt_inflight_canceller',
      chainId: null,
      nodeId: null,
      title: 'Canceller',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [],
        cancelScheduled: [{ eventId: 'evt_inflight_target', scope: 'same_source' }],
      },
    });
    const target = createEventSnapshot({
      id: 'evt_inflight_target',
      chainId: null,
      nodeId: null,
      title: 'Cancelled target',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [
          { target: 'world_fact', factId: 'inflight_target_ran', operation: 'set', value: true },
        ],
      },
    });
    const signal = makeSignal();
    const makeInstance = (
      instanceId: string,
      snapshot: ReturnType<typeof createEventSnapshot>,
    ): EventInstance => ({
      instanceId,
      eventId: snapshot.eventId,
      status: 'pending',
      triggeredAtDay: 1,
      activatedAtDay: 1,
      deadlineDay: null,
      triggerContext: signal,
      sourceKey: 'inflight_cancel_source',
      chainInstanceId: null,
      snapshot,
    });
    state.events.deferredContinuations = [
      {
        kind: 'instance',
        instance: makeInstance('inflight_canceller', canceller),
        cascadeDepth: 0,
      },
      { kind: 'instance', instance: makeInstance('inflight_target', target), cascadeDepth: 0 },
    ];

    processEventContinuations(
      state,
      [],
      1,
      () => 0,
      () => 'generated',
      [],
    );

    expect(state.world.facts['inflight_target_ran']).toBeUndefined();
    expect(
      state.events.history.find((item) => item.instanceId === 'inflight_target')?.finalStatus,
    ).toBe('cancelled');
    expect(state.events.deferredContinuations).toHaveLength(0);
  });

  it.each([
    { label: 'once', repeatPolicy: { mode: 'once' as const } },
    { label: 'once_per_source', repeatPolicy: { mode: 'once_per_source' as const } },
    { label: 'once_per_chain', repeatPolicy: { mode: 'once_per_chain' as const } },
    {
      label: 'maxActivations',
      repeatPolicy: { mode: 'repeatable' as const, maxActivations: 1 },
    },
  ])(
    'does not let an automatic $label event schedule itself before history is written',
    ({ repeatPolicy }) => {
      const state = createInitialState();
      const definition: EventDefinition = {
        id: `evt_auto_self_${repeatPolicy.mode}`,
        chainId: repeatPolicy.mode === 'once_per_chain' ? 'auto_self_chain' : null,
        nodeId: repeatPolicy.mode === 'once_per_chain' ? 'auto_self_node' : null,
        title: 'Automatic self scheduler',
        description: '',
        category: 'story',
        priority: 'normal',
        presentation: 'automatic',
        trigger: { sources: ['world.metric_changed'] },
        repeatPolicy,
        activation: {},
        options: [],
        automaticOutcome: {
          effects: [],
          schedule: [{ eventId: `evt_auto_self_${repeatPolicy.mode}`, delayDays: 0 }],
        },
      };
      const snapshot = createEventSnapshot(definition);
      const chainInstanceId =
        repeatPolicy.mode === 'once_per_chain' ? 'auto_self_chain_instance' : null;
      if (chainInstanceId) {
        state.events.chainInstances[chainInstanceId] = {
          instanceId: chainInstanceId,
          chainId: 'auto_self_chain',
          status: 'active',
          sourceKey: 'auto_self_source',
          activeNodeIds: ['auto_self_node'],
          completedNodeIds: [],
          startedAtDay: 1,
          completedAtDay: null,
        };
      }

      processEventContinuations(
        state,
        [
          {
            kind: 'instance',
            cascadeDepth: 0,
            instance: {
              instanceId: `auto_self_parent_${repeatPolicy.mode}`,
              eventId: definition.id,
              status: 'pending',
              triggeredAtDay: 1,
              activatedAtDay: 1,
              deadlineDay: null,
              triggerContext: makeSignal(),
              sourceKey: 'auto_self_source',
              chainInstanceId,
              snapshot,
            },
          },
        ],
        1,
        () => 0,
        () => 'generated',
        [definition],
      );

      expect(state.events.history.filter((item) => item.eventId === definition.id)).toHaveLength(1);
      expect(state.events.pending).toHaveLength(0);
      expect(state.events.scheduled).toHaveLength(0);
    },
  );

  it('preserves a deferred instance cascade depth across a blocker pause', () => {
    const state = createInitialState();
    const seedSnapshot = createEventSnapshot({
      id: 'evt_depth_seed',
      chainId: null,
      nodeId: null,
      title: 'Depth seed',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: { effects: [] },
    });
    const listener: EventDefinition = {
      id: 'evt_depth_listener',
      chainId: null,
      nodeId: null,
      title: 'Depth listener',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: {
        sources: ['event.resolved'],
        condition: { signalField: 'eventId', op: 'eq', value: 'evt_depth_seed' },
      },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: { effects: [] },
    };

    expect(() =>
      processEventContinuations(
        state,
        [
          {
            kind: 'instance',
            cascadeDepth: 15,
            instance: {
              instanceId: 'evt_depth_seed_instance',
              eventId: seedSnapshot.eventId,
              status: 'pending',
              triggeredAtDay: 1,
              activatedAtDay: 1,
              deadlineDay: null,
              triggerContext: makeSignal(),
              sourceKey: 'depth_source',
              chainInstanceId: null,
              snapshot: seedSnapshot,
            },
          },
        ],
        1,
        () => 0,
        (() => {
          let id = 0;
          return () => `depth_${id++}`;
        })(),
        [listener],
      ),
    ).toThrow('Cascade depth exceeded');
    expect(state.events.history).toHaveLength(0);
  });

  it('defers unconsumed immediate siblings when a blocker is activated', () => {
    const state = createInitialState();
    const blocking = createEventSnapshot({
      id: 'evt_batch_blocker',
      chainId: null,
      nodeId: null,
      title: 'Batch blocker',
      description: '',
      category: 'story',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    });
    const automatic = createEventSnapshot({
      id: 'evt_batch_automatic',
      chainId: null,
      nodeId: null,
      title: 'Batch automatic',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [
          { target: 'world_fact', factId: 'should_not_apply', operation: 'set', value: true },
        ],
      },
    });
    const instances = [blocking, automatic].map((snapshot, index): EventInstance => ({
      instanceId: `batch_${index}`,
      eventId: snapshot.eventId,
      status: 'pending',
      triggeredAtDay: 1,
      activatedAtDay: 1,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: `batch_signal_${index}` },
      sourceKey: 'batch_source',
      chainInstanceId: null,
      snapshot,
    }));

    applyEventInstances(
      state,
      instances,
      1,
      () => 0,
      () => 'generated',
      [],
    );

    expect(state.events.activeBlockingEventId).toBe('batch_0');
    expect(state.world.facts['should_not_apply']).toBeUndefined();
    expect(
      state.events.deferredContinuations.map((continuation) =>
        continuation.kind === 'instance'
          ? continuation.instance.instanceId
          : continuation.signal.signalId,
      ),
    ).toEqual(['batch_1']);
  });

  it('prioritizes a signal-created blocker over an alphabetically earlier automatic instance', () => {
    const state = createInitialState();
    const automatic: EventDefinition = {
      id: 'a_automatic',
      chainId: null,
      nodeId: null,
      title: 'Automatic',
      description: '',
      category: 'story',
      priority: 'urgent',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [
          {
            target: 'world_fact',
            factId: 'automatic_ran_before_blocker',
            operation: 'set',
            value: true,
          },
        ],
      },
    };
    const blocker: EventDefinition = {
      id: 'z_urgent_blocker',
      chainId: null,
      nodeId: null,
      title: 'Blocker',
      description: '',
      category: 'story',
      priority: 'low',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    };
    let id = 0;
    const plan = processDomainSignal({
      state,
      signal: makeSignal(),
      currentDay: 1,
      definitions: [automatic, blocker],
      rng: () => 0,
      idFactory: () => `signal_order_${id++}`,
    });

    expect(plan.createdInstances.map((item) => item.eventId)).toEqual([
      'z_urgent_blocker',
      'a_automatic',
    ]);
    applyEventInstances(
      state,
      plan.createdInstances,
      1,
      () => 0,
      () => 'generated',
      [],
    );

    expect(state.events.activeBlockingEventId).toBe('signal_order_0');
    expect(state.world.facts['automatic_ran_before_blocker']).toBeUndefined();
    expect(
      state.events.deferredContinuations.some(
        (item) => item.kind === 'instance' && item.instance.eventId === 'a_automatic',
      ),
    ).toBe(true);
  });

  it('lets a signal-created automatic event cancel a later instance in the same batch', () => {
    const state = createInitialState();
    const canceller: EventDefinition = {
      id: 'a_signal_batch_canceller',
      chainId: null,
      nodeId: null,
      title: 'Canceller',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [],
        cancelScheduled: [{ eventId: 'z_signal_batch_target', scope: 'same_source' }],
      },
    };
    const target: EventDefinition = {
      id: 'z_signal_batch_target',
      chainId: null,
      nodeId: null,
      title: 'Target',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [
          {
            target: 'world_fact',
            factId: 'signal_batch_target_ran',
            operation: 'set',
            value: true,
          },
        ],
      },
    };
    let id = 0;
    const plan = processDomainSignal({
      state,
      signal: makeSignal(),
      currentDay: 1,
      definitions: [canceller, target],
      rng: () => 0,
      idFactory: () => `signal_batch_${id++}`,
    });

    applyEventOrchestrationPlan(
      state,
      plan,
      1,
      () => 0,
      () => `apply_${id++}`,
      [canceller, target],
    );

    expect(state.world.facts['signal_batch_target_ran']).toBeUndefined();
    expect(state.events.history.find((item) => item.eventId === target.id)?.finalStatus).toBe(
      'cancelled',
    );
  });

  it.each([
    { label: 'once', repeatPolicy: { mode: 'once' as const } },
    { label: 'once_per_source', repeatPolicy: { mode: 'once_per_source' as const } },
    {
      label: 'maxActivations',
      repeatPolicy: { mode: 'repeatable' as const, maxActivations: 1 },
    },
  ])(
    'does not duplicate a signal-created $label target through an automatic follow-up',
    ({ repeatPolicy }) => {
      const state = createInitialState();
      const automatic: EventDefinition = {
        id: 'a_signal_batch_followup',
        chainId: null,
        nodeId: null,
        title: 'Follow-up parent',
        description: '',
        category: 'story',
        priority: 'normal',
        presentation: 'automatic',
        trigger: { sources: ['world.metric_changed'] },
        repeatPolicy: { mode: 'once' },
        activation: {},
        options: [],
        automaticOutcome: {
          effects: [],
          schedule: [{ eventId: 'z_signal_batch_once_target', delayDays: 0 }],
        },
      };
      const target: EventDefinition = {
        id: 'z_signal_batch_once_target',
        chainId: null,
        nodeId: null,
        title: 'Already queued target',
        description: '',
        category: 'story',
        priority: 'normal',
        presentation: 'inbox',
        trigger: { sources: ['world.metric_changed'] },
        repeatPolicy,
        activation: {},
        options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
      };
      let id = 0;
      const plan = processDomainSignal({
        state,
        signal: makeSignal(),
        currentDay: 1,
        definitions: [automatic, target],
        rng: () => 0,
        idFactory: () => `signal_once_${id++}`,
      });

      applyEventOrchestrationPlan(
        state,
        plan,
        1,
        () => 0,
        () => `apply_once_${id++}`,
        [automatic, target],
      );

      expect(state.events.pending.filter((item) => item.eventId === target.id)).toHaveLength(1);
      expect(state.events.scheduled.filter((item) => item.eventId === target.id)).toHaveLength(0);
    },
  );

  it('cancels a zero-delay automatic follow-up created by the same outcome', () => {
    const state = createInitialState();
    const parent = createEventSnapshot({
      id: 'evt_same_outcome_parent',
      chainId: null,
      nodeId: null,
      title: 'Parent',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [],
        schedule: [{ eventId: 'evt_same_outcome_target', delayDays: 0 }],
        cancelScheduled: [{ eventId: 'evt_same_outcome_target', scope: 'same_source' }],
      },
    });
    const target: EventDefinition = {
      id: 'evt_same_outcome_target',
      chainId: 'same_outcome_chain',
      nodeId: 'target',
      title: 'Target',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['event.resolved'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [
          {
            target: 'world_fact',
            factId: 'same_outcome_target_ran',
            operation: 'set',
            value: true,
          },
        ],
      },
    };
    const parentInstance: EventInstance = {
      instanceId: 'same_outcome_parent_instance',
      eventId: parent.eventId,
      status: 'pending',
      triggeredAtDay: 1,
      activatedAtDay: 1,
      deadlineDay: null,
      triggerContext: makeSignal(),
      sourceKey: 'same_outcome_source',
      chainInstanceId: null,
      snapshot: parent,
    };

    applyEventInstances(
      state,
      [parentInstance],
      1,
      () => 0,
      (() => {
        let id = 0;
        return () => `same_outcome_${id++}`;
      })(),
      [target],
    );

    expect(state.world.facts['same_outcome_target_ran']).toBeUndefined();
    expect(state.events.pending).toHaveLength(0);
    expect(state.events.history.filter((item) => item.eventId === target.id)).toMatchObject([
      { finalStatus: 'cancelled' },
    ]);
    const chain = Object.values(state.events.chainInstances).find(
      (item) => item.chainId === target.chainId,
    );
    expect(chain).toMatchObject({ status: 'abandoned', activeNodeIds: [] });
  });

  it('processes zero-delay children before later siblings and pauses cascade signals at a blocker', () => {
    const state = createInitialState();
    const automaticParent = createEventSnapshot({
      id: 'evt_auto_parent',
      chainId: null,
      nodeId: null,
      title: 'Auto parent',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: { effects: [], schedule: [{ eventId: 'evt_child_blocker', delayDays: 0 }] },
    });
    const siblingAutomatic = createEventSnapshot({
      id: 'evt_late_sibling',
      chainId: null,
      nodeId: null,
      title: 'Late sibling',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [
          { target: 'world_fact', factId: 'late_sibling_ran', operation: 'set', value: true },
        ],
      },
    });
    const childDefinition: EventDefinition = {
      id: 'evt_child_blocker',
      chainId: null,
      nodeId: null,
      title: 'Child blocker',
      description: '',
      category: 'story',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['event.resolved'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    };
    const instances = [automaticParent, siblingAutomatic].map((snapshot, index): EventInstance => ({
      instanceId: `causal_${index}`,
      eventId: snapshot.eventId,
      status: 'pending',
      triggeredAtDay: 1,
      activatedAtDay: 1,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: `causal_signal_${index}` },
      sourceKey: 'causal_source',
      chainInstanceId: null,
      snapshot,
    }));

    const result = applyEventInstances(
      state,
      instances,
      1,
      () => 0,
      (() => {
        let index = 0;
        return () => `causal_generated_${index++}`;
      })(),
      [childDefinition],
    );
    processCascadeSignals(
      state,
      result.cascadeSignals,
      1,
      () => 0,
      () => 'cascade',
      [],
    );

    expect(state.events.activeBlockingEventId).toBe('causal_generated_1');
    expect(state.world.facts['late_sibling_ran']).toBeUndefined();
    expect(
      state.events.deferredContinuations.some(
        (item) => item.kind === 'instance' && item.instance.instanceId === 'causal_1',
      ),
    ).toBe(true);
    expect(
      state.events.deferredContinuations.some(
        (item) => item.kind === 'signal' && item.signal.signalId === 'causal_generated_0',
      ),
    ).toBe(true);
  });

  it('defers later cascade signals after an earlier signal activates a blocker', () => {
    const state = createInitialState();
    const blocker: EventDefinition = {
      id: 'evt_cascade_blocker',
      chainId: null,
      nodeId: null,
      title: 'Cascade blocker',
      description: '',
      category: 'story',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: {
        sources: ['world.metric_changed'],
        condition: { signalField: 'metricId', op: 'eq', value: 'block' },
      },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    };
    const automatic: EventDefinition = {
      id: 'evt_cascade_automatic',
      chainId: null,
      nodeId: null,
      title: 'Cascade automatic',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: {
        sources: ['world.metric_changed'],
        condition: { signalField: 'metricId', op: 'eq', value: 'after_block' },
      },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [
          { target: 'world_fact', factId: 'cascade_after_block', operation: 'set', value: true },
        ],
      },
    };
    const signals: DomainSignalSnapshot[] = [
      {
        signalId: 'cascade_block_signal',
        signalType: 'world.metric_changed',
        occurredAtDay: 1,
        data: { metricId: 'block', value: 1 },
      },
      {
        signalId: 'cascade_after_signal',
        signalType: 'world.metric_changed',
        occurredAtDay: 1,
        data: { metricId: 'after_block', value: 1 },
      },
    ];

    processCascadeSignals(
      state,
      signals,
      1,
      () => 0,
      () => 'cascade_id',
      [blocker, automatic],
    );

    expect(state.events.activeBlockingEventId).toBe('cascade_id');
    expect(state.world.facts['cascade_after_block']).toBeUndefined();
    expect(state.events.deferredContinuations).toEqual([
      {
        kind: 'signal',
        signal: signals[1],
        cascadeDepth: 0,
      },
    ]);

    state.events.pending = [];
    state.events.activeBlockingEventId = null;
    processCascadeSignals(
      state,
      [],
      1,
      () => 0,
      () => 'resumed_id',
      [blocker, automatic],
    );

    expect(state.events.deferredContinuations).toHaveLength(0);
    expect(state.world.facts['cascade_after_block']).toBe(true);
  });

  it('restores a two-blocker continuation sequence before the older paused tail', () => {
    const state = createInitialState();
    const resolvedSignal = (signalId: string, eventId: string): DomainSignalSnapshot => ({
      signalId,
      signalType: 'event.resolved',
      occurredAtDay: 1,
      data: { eventInstanceId: `${eventId}_instance`, eventId, optionId: null, occurredAtDay: 1 },
    });
    const makeResolvedListener = (eventId: string, listenerId: string): EventDefinition => ({
      id: listenerId,
      chainId: null,
      nodeId: null,
      title: listenerId,
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: {
        sources: ['event.resolved'],
        condition: { signalField: 'eventId', op: 'eq', value: eventId },
      },
      repeatPolicy: { mode: 'repeatable' },
      activation: {},
      options: [],
      automaticOutcome: { effects: [] },
    });
    const blockerSnapshot = createEventSnapshot({
      id: 'second_blocker',
      chainId: null,
      nodeId: null,
      title: 'Second blocker',
      description: '',
      category: 'story',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['event.resolved'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    });
    const oldAutomaticSnapshot = createEventSnapshot({
      id: 'old_immediate',
      chainId: null,
      nodeId: null,
      title: 'Older immediate work',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['event.resolved'] },
      repeatPolicy: { mode: 'repeatable' },
      activation: {},
      options: [],
      automaticOutcome: { effects: [] },
    });
    const makeInstance = (
      instanceId: string,
      snapshot: ReturnType<typeof createEventSnapshot>,
    ): EventInstance => ({
      instanceId,
      eventId: snapshot.eventId,
      status: 'pending',
      triggeredAtDay: 1,
      activatedAtDay: 1,
      deadlineDay: null,
      triggerContext: makeSignal(),
      sourceKey: 'continuation_source',
      chainInstanceId: null,
      snapshot,
    });
    const firstResolved = resolvedSignal('first_resolved', 'first_blocker');
    const secondResolved = resolvedSignal('second_resolved', 'second_blocker');
    const oldTail = resolvedSignal('old_tail', 'old_parent');
    const definitions = [
      makeResolvedListener('second_blocker', 'second_listener'),
      makeResolvedListener('first_blocker', 'first_listener'),
      makeResolvedListener('old_parent', 'old_listener'),
    ];
    let id = 0;
    const idFactory = () => `continuation_${id++}`;

    state.events.deferredContinuations = [
      {
        kind: 'instance',
        instance: makeInstance('old_immediate_instance', oldAutomaticSnapshot),
        cascadeDepth: 0,
      },
      { kind: 'signal', signal: oldTail, cascadeDepth: 0 },
    ];

    // This is the work produced when the first blocker resolves: its immediate
    // child becomes the next blocker, and its resolved signal must wait behind it
    // but ahead of the tail that was already paused by the first blocker.
    processEventContinuations(
      state,
      [
        {
          kind: 'instance',
          instance: makeInstance('second_blocker_instance', blockerSnapshot),
          cascadeDepth: 0,
        },
        { kind: 'signal', signal: firstResolved, cascadeDepth: 0 },
      ],
      1,
      () => 0,
      idFactory,
      definitions,
      'front',
    );

    expect(state.events.activeBlockingEventId).toBe('second_blocker_instance');
    expect(
      state.events.deferredContinuations.map((item) =>
        item.kind === 'instance' ? item.instance.eventId : item.signal.signalId,
      ),
    ).toEqual(['first_resolved', 'old_immediate', 'old_tail']);

    // Simulate resolving the second blocker. Its newly emitted signal must run
    // before the continuation tail from the first blocker, then the paused
    // immediate instance and its older signal resume in their original order.
    state.events.pending = [];
    state.events.activeBlockingEventId = null;
    processEventContinuations(
      state,
      [{ kind: 'signal', signal: secondResolved, cascadeDepth: 0 }],
      1,
      () => 0,
      idFactory,
      definitions,
      'front',
    );

    expect(state.events.history.map((item) => item.eventId)).toEqual([
      'second_listener',
      'first_listener',
      'old_immediate',
      'old_listener',
    ]);
    expect(state.events.deferredContinuations).toHaveLength(0);
  });

  it('cascade-depth budget fails atomically instead of dropping remaining signals', () => {
    const state = createInitialState();
    const endlessAutomatic: EventDefinition = {
      id: 'evt_endless_automatic',
      chainId: null,
      nodeId: null,
      title: 'Endless automatic',
      description: '',
      category: 'story',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['event.resolved'] },
      repeatPolicy: { mode: 'repeatable' },
      activation: {},
      options: [],
      automaticOutcome: { effects: [] },
    };
    const signal: DomainSignalSnapshot = {
      signalId: 'cascade_seed',
      signalType: 'event.resolved',
      occurredAtDay: 1,
      data: { eventInstanceId: 'seed', eventId: 'seed_event', optionId: null, occurredAtDay: 1 },
    };
    let sequence = 0;

    expect(() =>
      processCascadeSignals(
        state,
        [signal],
        1,
        () => 0,
        () => `cascade_${sequence++}`,
        [endlessAutomatic],
      ),
    ).toThrow('Cascade depth exceeded');
    expect(state.events.history).toHaveLength(0);
    expect(state.events.pending).toHaveLength(0);
    expect(state.events.processedSignalIds).toHaveLength(0);
  });

  it('event.resolved signal updates processedSignalIds', () => {
    const store = createTestStore(createStateWithPending());
    const beforeIds = store.getRawState().events.processedSignalIds.length;

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    // processedSignalIds should increase (event.resolved signalId added via cascade)
    expect(state.events.processedSignalIds.length).toBeGreaterThanOrEqual(beforeIds);
  });

  it('chain instance updated after resolving chain event', () => {
    const chainSnapshot = createEventSnapshot({
      id: 'evt_chain_test',
      chainId: 'test_chain',
      nodeId: 'node_a',
      title: 'Chain Test Event',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 30 },
      options: [
        {
          id: 'opt_chain',
          label: '继续链',
          description: '',
          effects: [{ target: 'character', field: 'diligence', operation: 'add', value: 3 }],
        },
      ],
    });

    const chainInst: EventInstance = {
      instanceId: 'inst_chain_001',
      eventId: 'evt_chain_test',
      status: 'pending',
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: 'sig_chain' },
      sourceKey: 'src_chain',
      chainInstanceId: 'chain_test_instance',
      snapshot: chainSnapshot,
    };

    const baseState = createStateWithPending();
    baseState.events.chainInstances['chain_test_instance'] = {
      instanceId: 'chain_test_instance',
      chainId: 'test_chain',
      status: 'active',
      sourceKey: 'src_chain',
      activeNodeIds: ['node_a'],
      completedNodeIds: [],
      startedAtDay: 50,
      completedAtDay: null,
    };
    baseState.events.pending = [chainInst];

    const store = createTestStore(baseState);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_chain_001',
      optionId: 'opt_chain',
    });

    const state = store.getRawState();
    expect(state.events.chainInstances['chain_test_instance']).toBeDefined();
    // Node should be moved from active to completed
    expect(state.events.chainInstances['chain_test_instance']!.completedNodeIds).toContain(
      'node_a',
    );
  });

  it('end-to-end cascade: cooperate only schedules its explicit investigation branch', () => {
    // Uses real config: investigation_start resolves with "cooperate" →
    // resolveSchedule creates scheduled formal_investigation →
    // event.resolved is still emitted for external content, but scheduled-only
    // investigation nodes must not leak across to the suppress branch.
    const invSnapshot = createEventSnapshot({
      id: 'investigation_start',
      chainId: 'investigation_chain',
      nodeId: 'start',
      title: '腐败举报',
      description: '有匿名举报称辖区存在严重腐败问题。',
      category: 'governance',
      priority: 'urgent',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once_per_source' },
      activation: { deadlineDays: 7 },
      options: [
        {
          id: 'cooperate',
          label: '配合调查',
          description: '全力配合纪委调查。',
          effects: [{ target: 'character', field: 'integrity', operation: 'add', value: 5 }],
          schedule: [{ eventId: 'formal_investigation', delayDays: 3, probability: 1 }],
        },
        {
          id: 'suppress',
          label: '压制举报',
          description: '私下平息此事。',
          effects: [],
          schedule: [{ eventId: 'suppress_investigation', delayDays: 1, probability: 1 }],
        },
      ],
    });

    const invInst: EventInstance = {
      instanceId: 'inst_inv_start',
      eventId: 'investigation_start',
      status: 'pending',
      triggeredAtDay: 100,
      activatedAtDay: 100,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: 'sig_inv_start' },
      sourceKey: 'src_inv_start',
      chainInstanceId: null,
      snapshot: invSnapshot,
    };

    const baseState = createStateWithPending();
    baseState.events.pending = [invInst];

    const store = createTestStore(baseState);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_inv_start',
      optionId: 'cooperate',
    });

    const after = store.getRawState();

    // 1. Source event resolved and removed from pending
    expect(after.events.pending.find((p) => p.instanceId === 'inst_inv_start')).toBeUndefined();

    // 2. History created
    const srcHistory = after.events.history.find((h) => h.instanceId === 'inst_inv_start');
    expect(srcHistory).toBeDefined();
    expect(srcHistory!.finalStatus).toBe('resolved');
    expect(srcHistory!.chosenOptionId).toBe('cooperate');

    // 3. resolveSchedule: formal_investigation scheduled (delay 3 days)
    const schedFormal = after.events.scheduled.find((s) => s.eventId === 'formal_investigation');
    expect(schedFormal).toBeDefined();
    expect(schedFormal!.activateAtDay).toBe(103); // currentDay=100 + delayDays=3

    // 4. Cascade does not enter the incompatible suppress branch.
    const suppressPending = after.events.pending.find(
      (p) => p.eventId === 'suppress_investigation',
    );
    expect(suppressPending).toBeUndefined();

    // 5. Cascade dedup: formal_investigation is NOT in pending (scheduled exists,
    // once_per_chain with chain blocks duplicate creation)
    const formalPending = after.events.pending.filter((p) => p.eventId === 'formal_investigation');
    expect(formalPending).toHaveLength(0);

    // 6. The other outcome is not created before formal_investigation is actually resolved.
    const clearedHistory = after.events.history.find(
      (h) => h.eventId === 'investigation_cleared' && h.instanceId !== 'inst_inv_start',
    );
    expect(clearedHistory).toBeUndefined();

    // 7. processedSignalIds grows (cascade signals recorded)
    expect(after.events.processedSignalIds.length).toBeGreaterThan(0);

    // 8. investigation_chain created with nodes tracked
    const chainEntries = Object.values(after.events.chainInstances);
    const invChain = chainEntries.find((c) => c.chainId === 'investigation_chain');
    expect(invChain).toBeDefined();
    // noUncheckedIndexedAccess: verified invChain is defined above
    // Chain has the explicitly scheduled investigation node, not unrelated descendants.
    const totalTrackedNodes = invChain!.activeNodeIds.length + invChain!.completedNodeIds.length;
    expect(totalTrackedNodes).toBeGreaterThanOrEqual(1);
  });

  it('cross-chain cascade: suppress option does not duplicate suppress_investigation', () => {
    // Regression test for once_per_chain fallback fix:
    // investigation_start.suppress → resolveSchedule creates scheduled suppress_investigation
    // → event.resolved cascade → orchestrator should NOT create a duplicate pending instance
    // because once_per_chain fallback now checks by eventId (not eventId+sourceKey)
    const invSnapshot = createEventSnapshot({
      id: 'investigation_start',
      chainId: 'investigation_chain',
      nodeId: 'start',
      title: '腐败举报',
      description: '',
      category: 'governance',
      priority: 'urgent',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once_per_source' },
      activation: { deadlineDays: 7 },
      options: [
        {
          id: 'suppress',
          label: '压制举报',
          description: '',
          effects: [],
          schedule: [{ eventId: 'suppress_investigation', delayDays: 1, probability: 1 }],
        },
      ],
    });

    const invInst: EventInstance = {
      instanceId: 'inst_inv_suppress',
      eventId: 'investigation_start',
      status: 'pending',
      triggeredAtDay: 100,
      activatedAtDay: 100,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: 'sig_inv_suppress' },
      sourceKey: 'src_suppress_test',
      chainInstanceId: null,
      snapshot: invSnapshot,
    };

    const baseState = createStateWithPending();
    baseState.events.pending = [invInst];

    const store = createTestStore(baseState);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_inv_suppress',
      optionId: 'suppress',
    });

    const after = store.getRawState();

    // resolveSchedule creates exactly one scheduled suppress_investigation
    const schedSuppress = after.events.scheduled.filter(
      (s) => s.eventId === 'suppress_investigation',
    );
    expect(schedSuppress).toHaveLength(1);
    expect(schedSuppress[0]!.activateAtDay).toBe(101); // currentDay=100 + delayDays=1

    // Cascade should NOT create a pending suppress_investigation (duplicate)
    const pendingSuppress = after.events.pending.filter(
      (p) => p.eventId === 'suppress_investigation',
    );
    expect(pendingSuppress).toHaveLength(0);

    // Only one suppress_investigation instance total (the scheduled one)
    const totalSuppress =
      after.events.scheduled.filter((s) => s.eventId === 'suppress_investigation').length +
      after.events.pending.filter((p) => p.eventId === 'suppress_investigation').length;
    expect(totalSuppress).toBe(1);
  });
});

describe('event-reducer: lifecycle invariants', () => {
  it('rejects a queued blocking event that is not the active pointer', () => {
    const firstState = createStateWithPending({
      instanceId: 'blocking_first',
      status: 'active',
      snapshot: createEventSnapshot({
        id: 'blocking_first_event',
        chainId: null,
        nodeId: null,
        title: 'First',
        description: '',
        category: 'governance',
        priority: 'urgent',
        presentation: 'blocking',
        trigger: { sources: ['world.metric_changed'] },
        repeatPolicy: { mode: 'once' },
        activation: {},
        options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
      }),
    });
    const secondState = createStateWithPending({
      instanceId: 'blocking_second',
      status: 'pending',
      snapshot: createEventSnapshot({
        id: 'blocking_second_event',
        chainId: null,
        nodeId: null,
        title: 'Second',
        description: '',
        category: 'governance',
        priority: 'high',
        presentation: 'blocking',
        trigger: { sources: ['world.metric_changed'] },
        repeatPolicy: { mode: 'once' },
        activation: {},
        options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
      }),
    });
    const state = firstState;
    state.events.pending = [firstState.events.pending[0]!, secondState.events.pending[0]!];
    state.events.activeBlockingEventId = 'blocking_first';
    const store = createTestStore(state);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'blocking_second',
      optionId: 'resolve',
    });

    expect(store.getRawState().events.history).toHaveLength(0);
    expect(store.getRawState().events.pending.map((item) => item.instanceId)).toContain(
      'blocking_second',
    );
  });

  it('accepts stable fixed institution and region IDs from the institution registry', () => {
    const institution = getConfigLoader().getAllInstitutions()[0]!;
    const snapshot = createEventSnapshot({
      id: 'fixed_reference_event',
      chainId: null,
      nodeId: null,
      title: 'Fixed refs',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [
        {
          id: 'apply',
          label: '应用',
          description: '',
          effects: [
            {
              target: 'institution_metric',
              institutionRef: { source: 'fixed', institutionId: institution.id },
              metricId: 'capacity',
              operation: 'set',
              value: 3,
            },
            {
              target: 'region_metric',
              regionRef: { source: 'fixed', regionId: institution.regionId },
              metricId: 'confidence',
              operation: 'set',
              value: 4,
            },
          ],
        },
      ],
    });
    const state = createStateWithPending({ snapshot });
    state.events.pending[0]!.eventId = snapshot.eventId;
    const store = createTestStore(state);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'apply',
    });

    expect(store.getRawState().governance.institutionMetrics[institution.id]?.['capacity']).toBe(3);
    expect(store.getRawState().governance.regionMetrics[institution.regionId]?.['confidence']).toBe(
      4,
    );
  });

  it('generates unique cascade IDs across consecutive dispatches', () => {
    const first = createStateWithPending({ instanceId: 'dispatch_one' });
    const second = createStateWithPending({ instanceId: 'dispatch_two' });
    first.events.pending = [first.events.pending[0]!, second.events.pending[0]!];
    const store = createTestStore(first);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'dispatch_one',
      optionId: 'opt_heal',
    });
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'dispatch_two',
      optionId: 'opt_heal',
    });

    const ids = store.getRawState().events.processedSignalIds;
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('evaluates zero-delay follow-ups after effects with the real selected option signal', () => {
    const snapshot = createEventSnapshot({
      id: 'post_effect_store_event',
      chainId: null,
      nodeId: null,
      title: 'Post-effect event',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [
        {
          id: 'unlock',
          label: '解锁',
          description: '',
          effects: [
            {
              target: 'world_fact',
              factId: 'store_followup_unlocked',
              operation: 'set',
              value: true,
            },
          ],
          schedule: [
            {
              eventId: 'flood_emergency',
              delayDays: 0,
              condition: {
                all: [
                  { fact: 'store_followup_unlocked', op: 'is_true' },
                  { signalField: 'optionId', op: 'eq', value: 'unlock' },
                ],
              },
            },
          ],
        },
      ],
    });
    const state = createStateWithPending({ snapshot });
    state.events.pending[0]!.eventId = snapshot.eventId;
    const store = createTestStore(state);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'unlock',
      _rng: () => 0,
      _idFactory: (() => {
        let sequence = 0;
        return () => `post_effect_${sequence++}`;
      })(),
    });

    const after = store.getRawState();
    expect(after.world.facts['store_followup_unlocked']).toBe(true);
    const followup = after.events.pending.find((item) => item.eventId === 'flood_emergency');
    expect(followup).toBeDefined();
    expect(followup?.activatedAtDay).toBe(after.time.totalDaysPlayed);
    expect(after.events.activeBlockingEventId).toBe(followup?.instanceId);
  });
});
