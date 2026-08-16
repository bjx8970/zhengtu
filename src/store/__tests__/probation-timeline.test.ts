/** 试用期与统一时间轴 Store 集成测试。 */

import { describe, expect, it } from 'vitest';
import { createEventSnapshot } from '../../engine/events/event-orchestrator';
import type { EventDefinition } from '../../domain/events/definition';
import { getConfigLoader } from '../../config/loader';
import { createInitialState, createTestStore } from '../game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';

function setDay(state: ReturnType<typeof createInitialState>, absoluteDay: number): void {
  state.time.totalDaysPlayed = absoluteDay;
  state.time.year = 2012 + Math.floor(absoluteDay / 360);
  const dayInYear = absoluteDay % 360;
  state.time.month = Math.floor(dayInYear / 30) + 1;
  state.time.day = (dayInYear % 30) + 1;
}

function fulfillMinimum(state: ReturnType<typeof createInitialState>): void {
  const probation = state.career.appointment.probation;
  if (!probation) throw new Error('Expected initial probation');
  probation.completedActionCount = 1;
}

describe('probation timeline', () => {
  it('does not settle before due day and settles exactly on it', () => {
    const state = createInitialState();
    fulfillMinimum(state);
    setDay(state, 358);
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(store.getRawState().career.appointment.probation?.status).toBe('active');
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(store.getRawState().career.appointment.probation).toMatchObject({
      status: 'passed',
      resolvedAtDay: 360,
    });
  });

  it('hits the exact due date while advancing across it in one large step', () => {
    const state = createInitialState();
    fulfillMinimum(state);
    setDay(state, 350);
    const identity = {
      appointmentId: state.career.appointment.appointmentId,
      positionId: state.career.appointment.positionId,
      institutionId: state.career.appointment.institutionId,
      leadershipRank: state.career.appointment.leadershipRank,
      civilServiceRank: state.career.civilServiceRank,
    };
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
    const next = store.getRawState();
    expect(next.time.totalDaysPlayed).toBe(380);
    expect(next.career.appointment.probation?.evaluations[0]?.evaluatedAtDay).toBe(360);
    expect({
      appointmentId: next.career.appointment.appointmentId,
      positionId: next.career.appointment.positionId,
      institutionId: next.career.appointment.institutionId,
      leadershipRank: next.career.appointment.leadershipRank,
      civilServiceRank: next.career.civilServiceRank,
    }).toEqual(identity);
  });

  it('counts an action completed on the due day before evaluating probation', () => {
    const state = createInitialState();
    const department = getConfigLoader()
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.actions.length > 0);
    const action = department?.actions[0];
    expect(department).toBeDefined();
    expect(action).toBeDefined();
    if (!department || !action) return;
    state.actions.departmentStates[department.id] = {
      id: department.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };
    setDay(state, 360 - action.durationDays);
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_ACTION',
      deptId: department.id,
      actionId: action.id,
      tierKey: 'primary',
      _idFactory: () => 'due-day-action',
    });
    expect(store.getRawState().actions.slots.primary.occupants[0]).not.toBeNull();
    setDay(store.getRawState(), 359);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(store.getRawState().career.appointment.probation).toMatchObject({
      status: 'passed',
      completedActionCount: 1,
      resolvedAtDay: 360,
    });
  });

  it('persists extension and closes the appointment experience on final failure', () => {
    const state = createInitialState();
    setDay(state, 359);
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(store.getRawState().career.appointment.probation).toMatchObject({
      status: 'active',
      endsAtDay: 450,
      extensionCount: 1,
    });
    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(store.getRawState())));
    expect(decoded.success).toBe(true);
    expect(decoded.state?.career.appointment.probation).toEqual(
      store.getRawState().career.appointment.probation,
    );
    if (!decoded.state) return;
    const resumedStore = createTestStore(decoded.state);
    setDay(resumedStore.getRawState(), 449);
    resumedStore.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    const failed = resumedStore.getRawState();
    expect(failed.career.appointment.probation).toMatchObject({
      status: 'failed',
      resolvedAtDay: 450,
    });
    expect(failed.career.experiences[0]).toMatchObject({
      endedAtDay: 450,
      endReason: 'probation_failed',
    });
    resumedStore.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(resumedStore.getRawState().time.totalDaysPlayed).toBe(450);
  });

  it('does not repeat settlement when a later same-day blocker resumes', () => {
    const definition: EventDefinition = {
      id: 'probation_same_day_blocker',
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
    const state = createInitialState();
    fulfillMinimum(state);
    setDay(state, 359);
    const snapshot = createEventSnapshot(definition);
    state.events.scheduled.push({
      instanceId: 'probation-blocker-instance',
      eventId: definition.id,
      scheduledAtDay: 359,
      activateAtDay: 360,
      triggerContext: {
        signalId: 'probation-blocker-signal',
        signalType: 'world.metric_changed',
        occurredAtDay: 359,
        data: { metricId: 'probation_test', value: 1 },
      },
      sourceKey: 'probation-blocker-source',
      chainInstanceId: null,
      snapshot,
    });
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    const interrupted = store.getRawState();
    expect(interrupted.career.appointment.probation?.evaluations).toHaveLength(1);
    expect(
      interrupted.time.pendingContinuation?.remainingNodes.map((node) => node.type),
    ).not.toContain('probation_evaluation');
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'probation-blocker-instance',
      optionId: 'resolve',
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(store.getRawState().career.appointment.probation?.evaluations).toHaveLength(1);
  });

  it('round-trips the terminal probation audit through save decoding', () => {
    const state = createInitialState();
    fulfillMinimum(state);
    setDay(state, 359);
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(store.getRawState())));
    expect(decoded.success).toBe(true);
    expect(decoded.state?.career.appointment.probation).toEqual(
      store.getRawState().career.appointment.probation,
    );
  });
});
