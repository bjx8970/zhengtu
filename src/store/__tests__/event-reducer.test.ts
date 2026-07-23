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
    // Instance removed from pending
    expect(state.events.pending).toHaveLength(0);
    // History record created
    expect(state.events.history).toHaveLength(1);
    expect(state.events.history[0]!.eventId).toBe('evt_reducer_test');
    expect(state.events.history[0]!.finalStatus).toBe('resolved');
    expect(state.events.history[0]!.chosenOptionId).toBe('opt_heal');
    expect(state.events.history[0]!.chosenOptionLabel).toBe('恢复精力');
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
    expect(state.events.history).toHaveLength(1);
    const record = state.events.history[0]!;
    expect(record.appliedEffects).toHaveLength(1);
    expect(record.appliedEffects[0]!.target).toBe('character');
    expect(record.appliedEffects[0]!.label).toContain('diligence');
  });

  it('instance removed from pending after resolution', () => {
    const store = createTestStore(createStateWithPending());
    expect(store.getRawState().events.pending).toHaveLength(1);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    expect(store.getRawState().events.pending).toHaveLength(0);
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
    expect(after.events.pending).toHaveLength(0);
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
    expect(after.events.pending).toHaveLength(1);
    expect(after.events.pending[0]!.instanceId).toBe('inst_block_2');
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
    expect(state.events.cooldowns).toHaveLength(1);
    expect(state.events.cooldowns[0]!.eventId).toBe('evt_reducer_test');
    expect(state.events.cooldowns[0]!.scope).toBe('global');
  });

  it('history record includes sourceKey and titleSnapshot', () => {
    const store = createTestStore(createStateWithPending());
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'inst_reducer_001',
      optionId: 'opt_heal',
    });

    const state = store.getRawState();
    expect(state.events.history).toHaveLength(1);
    expect(state.events.history[0]!.sourceKey).toBe('src_reducer');
    expect(state.events.history[0]!.titleSnapshot).toBe('Reducer Test Event');
  });
});
