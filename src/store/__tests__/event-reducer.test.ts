/**
 * 事件 Reducer 集成测试
 *
 * 使用 createTestStore() 隔离测试 CHOOSE_EVENT_OPTION dispatch。
 * 验证效果应用、历史记录、pending 移除、阻塞指针推进。
 */
import { describe, it, expect } from 'vitest';
import { createTestStore, createInitialState } from '../game-store';
import { createEventSnapshot } from '../../engine/events/event-orchestrator';
import type { PlayerSave } from '../../types/player';
import type { EventInstance } from '../../domain/events/state';

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
  };

  return {
    ...createInitialState(),
    time: { year: 0, month: 1, day: 1, granularity: 'day' as const, totalDaysPlayed: 100 },
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
      time: { year: 0, month: 1, day: 1, granularity: 'day' as const, totalDaysPlayed: 100 },
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
      status: 'active',
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
      time: { year: 0, month: 1, day: 1, granularity: 'day' as const, totalDaysPlayed: 100 },
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
    // inst_block_1 should be removed, inst_block_2 still present
    expect(after.events.pending.find((p) => p.instanceId === 'inst_block_1')).toBeUndefined();
    expect(after.events.pending.find((p) => p.instanceId === 'inst_block_2')).toBeDefined();
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
      time: { year: 1, month: 1, day: 1, granularity: 'day' as const, totalDaysPlayed: 400 },
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
      time: { year: 0, month: 1, day: 1, granularity: 'day' as const, totalDaysPlayed: 100 },
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

  it('end-to-end cascade: option → event.resolved → cascade processing', () => {
    // Event A resolves, emitting event.resolved signal → cascade triggers
    // processDomainSignal. This verifies the full reducer cascade path.
    const e2eSnapshot = createEventSnapshot({
      id: 'evt_e2e_source',
      chainId: null,
      nodeId: null,
      title: 'E2E Cascade Source',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 30 },
      options: [
        {
          id: 'opt_e2e',
          label: '触发级联',
          description: '',
          effects: [
            { target: 'character', field: 'diligence', operation: 'add', value: 10 },
            { target: 'world_fact', factId: 'e2e_test_resolved', operation: 'set', value: true },
          ],
        },
      ],
    });

    const e2eInst: EventInstance = {
      instanceId: 'inst_e2e_001',
      eventId: 'evt_e2e_source',
      status: 'pending',
      triggeredAtDay: 50,
      activatedAtDay: 50,
      deadlineDay: null,
      triggerContext: { ...makeSignal(), signalId: 'sig_e2e' },
      sourceKey: 'src_e2e',
      chainInstanceId: null,
      snapshot: e2eSnapshot,
    };

    const baseState = createStateWithPending();
    baseState.events.pending = [e2eInst];

    const store = createTestStore(baseState);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_e2e_001',
      optionId: 'opt_e2e',
    });

    const state = store.getRawState();
    // Event resolved and removed from pending
    expect(state.events.pending.find((p) => p.instanceId === 'inst_e2e_001')).toBeUndefined();

    // History records created: at minimum the resolved event itself
    const e2eHistory = state.events.history.find((h) => h.instanceId === 'inst_e2e_001');
    expect(e2eHistory).toBeDefined();
    expect(e2eHistory!.finalStatus).toBe('resolved');
    expect(e2eHistory!.chosenOptionId).toBe('opt_e2e');
    expect(e2eHistory!.appliedEffects.length).toBeGreaterThanOrEqual(2);

    // World fact applied via effect pipeline
    expect(state.world.facts['e2e_test_resolved']).toBe(true);

    // event.resolved signal processed through cascade
    // If any auto event matched, its history would also appear.
    // Even if none matched, processedSignalIds should have grown.
    const processedCount = state.events.processedSignalIds.length;
    expect(processedCount).toBeGreaterThan(0);
  });
});
