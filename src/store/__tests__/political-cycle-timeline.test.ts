/** 政治周期实际时间轴、届期衔接和存档恢复回归。 */
import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../config/loader';
import { createInitialState, createTestStore } from '../game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';
import { createEventSnapshot } from '../../engine/events/event-orchestrator';
import type { EventDefinition } from '../../domain/events/definition';

const config = getConfigLoader().getGameConfig();
const yearDays = config.daysPerMonth * config.monthsPerYear;
const firstDay =
  (config.congressCycleYears - (config.startYear % config.congressCycleYears)) * yearDays;
const cycleDays = config.congressCycleYears * yearDays;

function setDay(state: ReturnType<typeof createInitialState>, day: number): void {
  state.time.totalDaysPlayed = day;
  state.time.year = config.startYear + Math.floor(day / yearDays);
  state.time.month = Math.floor((day % yearDays) / config.daysPerMonth) + 1;
  state.time.day = (day % config.daysPerMonth) + 1;
}

function startCycle() {
  const state = createInitialState();
  if (state.career.appointment.probation)
    state.career.appointment.probation.completedActionCount = 1;
  setDay(state, firstDay - 1);
  const store = createTestStore(state);
  store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.99 });
  expect(store.getRawState().world.activeCycles).toEqual([
    {
      type: 'party_congress',
      termNumber: 1,
      startedAtDay: firstDay,
      endsAtDay: firstDay + cycleDays,
      phase: 'preparation',
    },
  ]);
  return store;
}

describe('political cycle timeline', () => {
  it('advances all configured phases at their exact daily boundaries', () => {
    const store = startCycle();
    const durations = config.politicalCyclePhaseDurations;
    const boundaries = [
      [durations.preparation, 'session'],
      [durations.preparation + durations.session, 'implementation'],
      [durations.preparation + durations.session + durations.implementation, 'evaluation'],
    ] as const;
    for (const [elapsed, phase] of boundaries) {
      setDay(store.getRawState(), firstDay + elapsed - 2);
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.99 });
      expect(store.getRawState().world.activeCycles[0]?.phase).not.toBe(phase);
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.99 });
      expect(store.getRawState().world.activeCycles[0]?.phase).toBe(phase);
    }
  });

  it('evaluates the old term and creates the next on the same day, then replays after refresh', () => {
    const store = startCycle();
    const end = firstDay + cycleDays;
    setDay(store.getRawState(), end - 1);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.99 });
    const settled = store.getRawState();
    expect(settled.world.activeCycles[1]).toMatchObject({
      termNumber: 2,
      startedAtDay: end,
      endsAtDay: end + cycleDays,
      phase: 'preparation',
    });
    expect(settled.organization.processedProducerKeys).toContain(
      'political-cycle:party_congress:1',
    );
    // 重放已提交节点，验证旧 continuation 不会重复评估或生产空缺。
    settled.time.pendingContinuation = {
      absoluteDay: end,
      remainingNodes: [{ type: 'political_cycle', absoluteDay: end, year: settled.time.year }],
    };
    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(settled)));
    expect(decoded.success).toBe(true);
    if (!decoded.state) throw new Error('Expected decoded save');
    const resumed = createTestStore(decoded.state);
    resumed.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.99 });
    expect(resumed.getRawState().time.totalDaysPlayed).toBe(end);
    expect(resumed.getRawState().time.pendingContinuation).toBeNull();
    expect(resumed.getRawState().world.activeCycles).toEqual(settled.world.activeCycles);
    expect(resumed.getRawState().organization).toEqual(settled.organization);
  });

  it('persists a phase node behind a real blocker and resumes it after refresh', () => {
    const store = startCycle();
    const boundary = firstDay + config.politicalCyclePhaseDurations.preparation;
    const definition: EventDefinition = {
      id: 'cycle_blocker',
      chainId: null,
      nodeId: null,
      title: '同日阻塞',
      description: '',
      category: 'career',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    };
    setDay(store.getRawState(), boundary - 1);
    store.getRawState().events.scheduled.push({
      instanceId: 'cycle-blocker',
      eventId: definition.id,
      scheduledAtDay: boundary - 1,
      activateAtDay: boundary,
      triggerContext: {
        signalId: 'cycle-blocker-signal',
        signalType: 'world.metric_changed',
        occurredAtDay: boundary - 1,
        data: { metricId: 'test', value: 1 },
      },
      sourceKey: 'cycle-blocker-source',
      chainInstanceId: null,
      snapshot: createEventSnapshot(definition),
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.99 });
    expect(store.getRawState().time.totalDaysPlayed).toBe(boundary);
    expect(
      store
        .getRawState()
        .time.pendingContinuation?.remainingNodes.some((node) => node.type === 'political_cycle'),
    ).toBe(true);
    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(store.getRawState())));
    expect(decoded.success).toBe(true);
    if (!decoded.state) throw new Error('Expected decoded save');
    const resumed = createTestStore(decoded.state);
    resumed.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'cycle-blocker',
      optionId: 'resolve',
    });
    resumed.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.99 });
    expect(resumed.getRawState().time.totalDaysPlayed).toBe(boundary);
    expect(resumed.getRawState().world.activeCycles[0]?.phase).toBe('session');
  });

  it('repairs missed terms continuously when loading an older save', () => {
    const store = startCycle();
    setDay(store.getRawState(), firstDay + cycleDays * 2 + 10);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.99 });
    expect(store.getRawState().world.activeCycles.map((cycle) => cycle.startedAtDay)).toEqual([
      firstDay,
      firstDay + cycleDays,
      firstDay + cycleDays * 2,
    ]);
    expect(store.getRawState().organization.processedProducerKeys).toEqual(
      expect.arrayContaining([
        'political-cycle:party_congress:1',
        'political-cycle:party_congress:2',
      ]),
    );
  });
});
