/**
 * 事件统一时间轴回归测试
 *
 * 验证计划事件按绝对日激活、阻塞中断以及单次时间事务内的 ID 唯一性。
 */

import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';
import { createEventSnapshot } from '../../engine/events/event-orchestrator';
import { getConfigLoader } from '../../config/loader';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { EventInstance } from '../../domain/events/state';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';

function makeSignal(signalId: string, occurredAtDay = 0): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'world.metric_changed',
    occurredAtDay,
    data: { metricId: 'timeline_test', value: 1 },
  };
}

describe('event timeline integration', () => {
  it('preserves blocking, inbox and scheduled event runtime records across a refresh', () => {
    const state = createInitialState();
    const blockingSnapshot = createEventSnapshot({
      id: 'refresh_blocking',
      chainId: null,
      nodeId: null,
      title: 'Refresh blocking',
      description: '',
      category: 'governance',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 3 },
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    });
    const inboxSnapshot = createEventSnapshot({
      id: 'refresh_inbox',
      chainId: null,
      nodeId: null,
      title: 'Refresh inbox',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 5 },
      options: [{ id: 'ack', label: '知悉', description: '', effects: [] }],
    });
    const blocking: EventInstance = {
      instanceId: 'refresh-blocking-instance',
      eventId: blockingSnapshot.eventId,
      status: 'active',
      triggeredAtDay: 0,
      activatedAtDay: 0,
      deadlineDay: 3,
      triggerContext: makeSignal('refresh-blocking-signal'),
      sourceKey: 'refresh-blocking-source',
      chainInstanceId: null,
      snapshot: blockingSnapshot,
    };
    const inbox: EventInstance = {
      instanceId: 'refresh-inbox-instance',
      eventId: inboxSnapshot.eventId,
      status: 'pending',
      triggeredAtDay: 0,
      activatedAtDay: 0,
      deadlineDay: 5,
      triggerContext: makeSignal('refresh-inbox-signal'),
      sourceKey: 'refresh-inbox-source',
      chainInstanceId: null,
      snapshot: inboxSnapshot,
    };
    state.events.activeBlockingEventId = blocking.instanceId;
    state.events.pending = [blocking, inbox];
    state.events.scheduled.push({
      instanceId: 'refresh-scheduled-instance',
      eventId: inboxSnapshot.eventId,
      scheduledAtDay: 0,
      activateAtDay: 17,
      triggerContext: makeSignal('refresh-scheduled-signal'),
      sourceKey: 'refresh-scheduled-source',
      chainInstanceId: null,
      snapshot: inboxSnapshot,
    });

    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));
    expect(decoded.success).toBe(true);
    expect(decoded.state?.events.activeBlockingEventId).toBe(blocking.instanceId);
    expect(decoded.state?.events.pending.map((event) => event.instanceId)).toEqual([
      blocking.instanceId,
      inbox.instanceId,
    ]);
    expect(decoded.state?.events.scheduled[0]?.activateAtDay).toBe(17);
  });

  it('does not resolve a restored event option twice', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'refresh-single-choice',
      chainId: null,
      nodeId: null,
      title: 'Single choice',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'resolve', label: '处理', description: '', effects: [] }],
    });
    state.events.pending.push({
      instanceId: 'refresh-single-choice-instance',
      eventId: snapshot.eventId,
      status: 'pending',
      triggeredAtDay: 0,
      activatedAtDay: 0,
      deadlineDay: null,
      triggerContext: makeSignal('refresh-single-choice-signal'),
      sourceKey: 'refresh-single-choice-source',
      chainInstanceId: null,
      snapshot,
    });
    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));
    expect(decoded.success).toBe(true);
    if (!decoded.state) return;
    const store = createTestStore(decoded.state);
    const action = {
      type: 'CHOOSE_EVENT_OPTION' as const,
      eventInstanceId: 'refresh-single-choice-instance',
      optionId: 'resolve',
    };
    store.dispatch(action);
    store.dispatch(action);
    expect(store.getRawState().events.history).toHaveLength(1);
    expect(store.getRawState().events.pending).toHaveLength(0);
  });

  it('自动激活政策、推进里程碑，并在存档恢复后补做同日月结', () => {
    const loader = getConfigLoader();
    const state = createInitialState();
    state.world.facts.industrial_park_policy_proposed = true;
    const department = loader
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.baseConsumption * item.consumptionCoefficient > 0);
    expect(department).toBeDefined();
    if (!department) return;
    state.remainingBudget = 10_000;
    state.actions.departmentStates[department.id] = {
      id: department.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };
    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `policy-timeline-${sequence++}`;

    store.dispatch({
      type: 'PROPOSE_POLICY',
      policyId: 'industrial_park_support',
      _idFactory: nextId,
    });
    const policy = store.getRawState().governance.policies[0];
    expect(policy).toBeDefined();
    if (!policy) return;
    store.dispatch({
      type: 'APPROVE_POLICY',
      policyInstanceId: policy.instanceId,
      _rng: () => 0,
      _idFactory: nextId,
    });
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const activated = store.getRawState().governance.policies[0];
    expect(activated?.status).toBe('implementing');
    expect(activated?.currentPhaseId).toBe('preparation');
    expect(activated?.phaseEnteredAtDay).toBe(0);
    expect(activated?.nextMilestoneAtDay).toBe(30);
    expect(store.getRawState().time.totalDaysPlayed).toBe(1);

    const stabilityBeforeMilestone = store.getRawState().character.stability;
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const blocked = store.getRawState();
    const blocker = blocked.events.pending.find(
      (event) => event.eventId === 'industrial_park_progress_crisis',
    );
    expect(blocked.time.totalDaysPlayed).toBe(30);
    expect(blocked.governance.policies[0]?.currentPhaseId).toBe('implementation');
    expect(blocked.character.stability).toBe(stabilityBeforeMilestone + 5);
    expect(blocker?.instanceId).toBe(blocked.events.activeBlockingEventId);
    expect(blocker?.sourceKey).toBe(policy.instanceId);
    expect(blocker?.triggerContext.data).toMatchObject({
      policyInstanceId: policy.instanceId,
      previousPhaseId: 'preparation',
      currentPhaseId: 'implementation',
    });
    expect(blocked.time.pendingContinuation?.remainingNodes.map((node) => node.type)).toContain(
      'monthly_settlement',
    );
    expect(blocked.remainingBudget).toBe(10_000);

    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(blocked)));
    expect(decoded.success).toBe(true);
    expect(decoded.state).toBeDefined();
    if (!decoded.state || !blocker) return;
    const resumedStore = createTestStore(decoded.state);
    resumedStore.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: blocker.instanceId,
      optionId: 'rectification_plan',
      _rng: () => 0,
      _idFactory: nextId,
    });
    resumedStore.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const resumed = resumedStore.getRawState();
    expect(resumed.time.totalDaysPlayed).toBe(30);
    expect(resumed.time.pendingContinuation).toBeNull();
    expect(resumed.remainingBudget).toBeLessThan(10_000);
    expect(resumed.governance.policies[0]?.currentPhaseId).toBe('implementation');
    expect(resumed.character.stability).toBe(stabilityBeforeMilestone + 5);
    const budgetAfterSettlement = resumed.remainingBudget;

    resumedStore.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });
    const nextDay = resumedStore.getRawState();
    expect(nextDay.time.totalDaysPlayed).toBe(31);
    expect(nextDay.remainingBudget).toBe(budgetAfterSettlement);
    expect(
      nextDay.events.history.filter(
        (record) => record.eventId === 'industrial_park_progress_crisis',
      ),
    ).toHaveLength(1);
  });

  it('stops a long advance on the exact day a blocking event activates', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'timeline_blocker',
      chainId: null,
      nodeId: null,
      title: 'Timeline blocker',
      description: '',
      category: 'governance',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 3 },
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    state.events.scheduled.push({
      instanceId: 'scheduled_blocker',
      eventId: snapshot.eventId,
      scheduledAtDay: 0,
      activateAtDay: 5,
      triggerContext: makeSignal('blocker_trigger'),
      sourceKey: 'timeline_source',
      chainInstanceId: null,
      snapshot,
    });
    const store = createTestStore(state);
    let sequence = 0;

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: () => `timeline_${sequence++}`,
    });

    const after = store.getRawState();
    expect(after.time.totalDaysPlayed).toBe(5);
    expect(after.events.activeBlockingEventId).toBe('scheduled_blocker');
    expect(
      after.events.pending.find((item) => item.instanceId === 'scheduled_blocker')?.status,
    ).toBe('active');
    expect(after.time.pendingContinuation?.remainingNodes.map((node) => node.type)).not.toContain(
      'scheduled_event_activation',
    );
  });

  it('expires newly overdue pending events before a same-day blocker pauses advancement', () => {
    const state = createInitialState();
    const overdueSnapshot = createEventSnapshot({
      id: 'overdue_before_blocker',
      chainId: null,
      nodeId: null,
      title: 'Overdue event',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'inbox',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'repeatable' },
      activation: { deadlineDays: 1 },
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    const blockerSnapshot = createEventSnapshot({
      id: 'existing_blocker',
      chainId: null,
      nodeId: null,
      title: 'Existing blocker',
      description: '',
      category: 'emergency',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    const overdue: EventInstance = {
      instanceId: 'overdue_instance',
      eventId: overdueSnapshot.eventId,
      status: 'pending',
      triggeredAtDay: 0,
      activatedAtDay: 0,
      deadlineDay: 0,
      triggerContext: makeSignal('overdue_signal'),
      sourceKey: 'repeatable_source',
      chainInstanceId: null,
      snapshot: overdueSnapshot,
    };
    state.events.pending.push(overdue);
    state.events.scheduled.push({
      instanceId: 'scheduled_blocker_instance',
      eventId: blockerSnapshot.eventId,
      scheduledAtDay: 0,
      activateAtDay: 1,
      triggerContext: makeSignal('blocker_signal'),
      sourceKey: 'blocker_source',
      chainInstanceId: null,
      snapshot: blockerSnapshot,
    });
    const store = createTestStore(state);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const after = store.getRawState();
    expect(after.time.totalDaysPlayed).toBe(1);
    expect(after.events.activeBlockingEventId).toBe('scheduled_blocker_instance');
    expect(after.events.pending.map((event) => event.instanceId)).not.toContain(overdue.instanceId);
    expect(after.events.history).toContainEqual(
      expect.objectContaining({
        instanceId: overdue.instanceId,
        finalStatus: 'expired',
        completedAtDay: 1,
      }),
    );
  });

  it('activates a year-end blocker before monthly settlement and annual assessment', () => {
    const loader = getConfigLoader();
    const config = loader.getGameConfig();
    const state = createInitialState();
    const department = loader
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.baseConsumption * item.consumptionCoefficient > 0);
    expect(department).toBeDefined();
    if (!department) return;

    state.time = {
      year: config.startYear,
      month: config.monthsPerYear,
      day: config.daysPerMonth,
      granularity: 'day',
      totalDaysPlayed: config.monthsPerYear * config.daysPerMonth - 1,
      pendingContinuation: null,
    };
    state.remainingBudget = 10_000;
    state.actions.departmentStates[department.id] = {
      id: department.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };
    const snapshot = createEventSnapshot({
      id: 'year_end_blocker',
      chainId: null,
      nodeId: null,
      title: 'Year-end blocker',
      description: '',
      category: 'emergency',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    state.events.scheduled.push({
      instanceId: 'year_end_blocker_instance',
      eventId: snapshot.eventId,
      scheduledAtDay: state.time.totalDaysPlayed - 1,
      activateAtDay: state.time.totalDaysPlayed + 1,
      triggerContext: makeSignal('year_end_blocker_signal'),
      sourceKey: 'year_end_source',
      chainInstanceId: null,
      snapshot,
    });
    const store = createTestStore(state);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const after = store.getRawState();
    expect(after.events.activeBlockingEventId).toBe('year_end_blocker_instance');
    expect(after.remainingBudget).toBe(10_000);
    expect(after.assessments.annualAssessments).toHaveLength(0);
  });

  it('keeps later same-day scheduled events untouched after an urgent blocker', () => {
    const state = createInitialState();
    const blocker = createEventSnapshot({
      id: 'same_day_blocker',
      chainId: null,
      nodeId: null,
      title: 'Blocker',
      description: '',
      category: 'emergency',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    const automatic = createEventSnapshot({
      id: 'same_day_automatic',
      chainId: null,
      nodeId: null,
      title: 'Automatic',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [{ target: 'character', field: 'vigor', operation: 'add', value: -10 }],
      },
    });
    state.events.scheduled.push(
      {
        instanceId: 'same_day_blocker_instance',
        eventId: blocker.eventId,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: makeSignal('same_day_blocker'),
        sourceKey: 'same_day',
        chainInstanceId: null,
        snapshot: blocker,
      },
      {
        instanceId: 'same_day_automatic_instance',
        eventId: automatic.eventId,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: makeSignal('same_day_automatic'),
        sourceKey: 'same_day',
        chainInstanceId: null,
        snapshot: automatic,
      },
    );
    const originalVigor = state.character.vigor;
    const store = createTestStore(state);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const after = store.getRawState();
    expect(after.events.activeBlockingEventId).toBe('same_day_blocker_instance');
    expect(after.events.scheduled.map((item) => item.instanceId)).toContain(
      'same_day_automatic_instance',
    );
    expect(after.events.history.some((item) => item.eventId === 'same_day_automatic')).toBe(false);
    expect(after.character.vigor).toBe(originalVigor);

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'same_day_blocker_instance',
      optionId: 'ack',
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const resumed = store.getRawState();
    expect(resumed.time.totalDaysPlayed).toBe(1);
    expect(resumed.time.pendingContinuation).toBeNull();
    expect(resumed.events.scheduled.map((item) => item.instanceId)).not.toContain(
      'same_day_automatic_instance',
    );
    expect(resumed.events.pending.map((item) => item.instanceId)).not.toContain(
      'same_day_blocker_instance',
    );
    expect(
      resumed.events.history.filter((item) => item.instanceId === 'same_day_blocker_instance'),
    ).toHaveLength(1);
    expect(resumed.events.history.some((item) => item.eventId === 'same_day_automatic')).toBe(true);
    expect(resumed.character.vigor).toBe(originalVigor - 10);
  });

  it('keeps an urgent automatic event scheduled when a same-day low-priority blocker exists', () => {
    const state = createInitialState();
    const automatic = createEventSnapshot({
      id: 'reverse_priority_automatic',
      chainId: null,
      nodeId: null,
      title: 'Urgent automatic',
      description: '',
      category: 'governance',
      priority: 'urgent',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [{ target: 'character', field: 'vigor', operation: 'add', value: 10 }],
      },
    });
    const blocker = createEventSnapshot({
      id: 'reverse_priority_blocker',
      chainId: null,
      nodeId: null,
      title: 'Low blocker',
      description: '',
      category: 'emergency',
      priority: 'low',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    state.events.scheduled.push(
      {
        instanceId: 'reverse_priority_automatic_instance',
        eventId: automatic.eventId,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: makeSignal('reverse_priority_automatic'),
        sourceKey: 'reverse_priority',
        chainInstanceId: null,
        snapshot: automatic,
      },
      {
        instanceId: 'reverse_priority_blocker_instance',
        eventId: blocker.eventId,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: makeSignal('reverse_priority_blocker'),
        sourceKey: 'reverse_priority',
        chainInstanceId: null,
        snapshot: blocker,
      },
    );
    const originalVigor = state.character.vigor;
    const store = createTestStore(state);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const after = store.getRawState();
    expect(after.events.activeBlockingEventId).toBe('reverse_priority_blocker_instance');
    expect(after.events.scheduled.map((item) => item.instanceId)).toContain(
      'reverse_priority_automatic_instance',
    );
    expect(after.events.history.some((item) => item.eventId === automatic.eventId)).toBe(false);
    expect(after.character.vigor).toBe(originalVigor);
  });

  it('does not activate the remaining same-day events when an unresolved blocker advances again', () => {
    const state = createInitialState();
    const blocker = createEventSnapshot({
      id: 'readvance_blocker',
      chainId: null,
      nodeId: null,
      title: 'Blocker',
      description: '',
      category: 'emergency',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    const automatic = createEventSnapshot({
      id: 'readvance_automatic',
      chainId: null,
      nodeId: null,
      title: 'Automatic',
      description: '',
      category: 'governance',
      priority: 'normal',
      presentation: 'automatic',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: {},
      options: [],
      automaticOutcome: {
        effects: [{ target: 'character', field: 'vigor', operation: 'add', value: 10 }],
      },
    });
    state.events.scheduled.push(
      {
        instanceId: 'readvance_blocker_instance',
        eventId: blocker.eventId,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: makeSignal('readvance_blocker'),
        sourceKey: 'readvance',
        chainInstanceId: null,
        snapshot: blocker,
      },
      {
        instanceId: 'readvance_automatic_instance',
        eventId: automatic.eventId,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: makeSignal('readvance_automatic'),
        sourceKey: 'readvance',
        chainInstanceId: null,
        snapshot: automatic,
      },
    );
    const originalVigor = state.character.vigor;
    const store = createTestStore(state);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'week' });

    const after = store.getRawState();
    expect(after.time.totalDaysPlayed).toBe(1);
    expect(after.events.activeBlockingEventId).toBe('readvance_blocker_instance');
    expect(after.events.scheduled.map((item) => item.instanceId)).toContain(
      'readvance_automatic_instance',
    );
    expect(after.events.history.some((item) => item.eventId === 'readvance_automatic')).toBe(false);
    expect(after.character.vigor).toBe(originalVigor);
  });

  it('shares one monotonic ID factory across automatic follow-ups and secondary cascades', () => {
    const definition = getConfigLoader().getEventDefinition('formal_investigation')!;
    const state = createInitialState();
    state.events.chainInstances['investigation_instance'] = {
      instanceId: 'investigation_instance',
      chainId: 'investigation_chain',
      status: 'active',
      sourceKey: 'timeline_chain_source',
      activeNodeIds: ['investigation'],
      completedNodeIds: [],
      startedAtDay: 0,
      completedAtDay: null,
    };
    state.events.scheduled.push({
      instanceId: 'scheduled_automatic',
      eventId: definition.id,
      scheduledAtDay: 0,
      activateAtDay: 5,
      triggerContext: makeSignal('automatic_trigger'),
      sourceKey: 'timeline_chain_source',
      chainInstanceId: 'investigation_instance',
      snapshot: createEventSnapshot(definition),
    });
    const store = createTestStore(state);
    let sequence = 0;

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: () => `transaction_${sequence++}`,
    });

    const after = store.getRawState();
    const formalHistory = after.events.history.find(
      (item) => item.instanceId === 'scheduled_automatic',
    );
    expect(formalHistory?.completedAtDay).toBe(5);
    // Mutually exclusive conclusions are scheduled only after the real formal event resolves.
    expect(after.events.history.some((item) => item.eventId === 'investigation_cleared')).toBe(
      false,
    );
    expect(after.events.pending.some((item) => item.eventId === 'investigation_confirmed')).toBe(
      true,
    );
    expect(after.events.processedSignalIds.length).toBeGreaterThanOrEqual(1);

    const generatedIds = [
      ...after.events.pending.map((item) => item.instanceId),
      ...after.events.scheduled.map((item) => item.instanceId),
      ...after.events.history.map((item) => item.instanceId),
      ...after.events.processedSignalIds,
    ].filter((id) => id.startsWith('transaction_'));
    expect(new Set(generatedIds).size).toBe(generatedIds.length);
  });

  it('防汛准备完整链条: 行动完成 → 指标形成 → 汛情应对 → 灾后重建 → 准备状态重置', () => {
    const loader = getConfigLoader();
    const state = createInitialState();
    state.remainingBudget = 10_000;
    const department = loader
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.actions.some((a) => a.id === 'flood_preparation'));
    expect(department).toBeDefined();
    if (!department) return;
    state.actions.departmentStates[department.id] = {
      id: department.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };

    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `flood-chain-${sequence++}`;

    // 启动防汛准备行动（durationDays=4）
    store.dispatch({
      type: 'START_ACTION',
      deptId: department.id,
      actionId: 'flood_preparation',
      tierKey: 'primary',
      _idFactory: nextId,
    });

    // 推进一周（5天），行动在第4天完成
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterAction = store.getRawState();
    // flood_preparation_metrics 自动触发：设置 world.facts.flood_prepared = true
    expect(afterAction.world.facts.flood_prepared).toBe(true);
    // flood_prepared_emergency 已排期（delay 14 天，约在 day 18 激活）
    const emergencyScheduled = afterAction.events.scheduled.find(
      (item) => item.eventId === 'flood_prepared_emergency',
    );
    expect(emergencyScheduled).toBeDefined();

    // 推进一个月，在 flood_prepared_emergency 激活日停止（blocking）
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterEmergency = store.getRawState();
    const pendingEmergency = afterEmergency.events.pending.find(
      (item) => item.eventId === 'flood_prepared_emergency',
    );
    expect(pendingEmergency).toBeDefined();
    expect(afterEmergency.events.activeBlockingEventId).toBe(pendingEmergency!.instanceId);

    // 选择"前置加固堤防"选项应对汛情
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: pendingEmergency!.instanceId,
      optionId: 'reinforce_dikes',
      _rng: () => 0,
      _idFactory: nextId,
    });

    // 先清除 pendingContinuation（同一日的剩余节点）
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });
    // 再推进一周，让 flood_reconstruction 在 delay 4 天后激活并自动解析
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterReconstruction = store.getRawState();
    // flood_reconstruction 不再立即重置准备标志；准备标志持续到洪水风险降至 80 以下
    expect(afterReconstruction.world.facts.flood_prepared).toBe(true);
    expect(
      afterReconstruction.events.history.some((item) => item.eventId === 'flood_reconstruction'),
    ).toBe(true);
  });

  it('两轮防汛准备不会因冷却期不足而互相覆盖准备状态', () => {
    const loader = getConfigLoader();
    const state = createInitialState();
    state.remainingBudget = 10_000;
    const department = loader
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.actions.some((a) => a.id === 'flood_preparation'));
    expect(department).toBeDefined();
    if (!department) return;
    state.actions.departmentStates[department.id] = {
      id: department.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };

    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `flood-two-round-${sequence++}`;

    // ===== 第一轮 =====
    store.dispatch({
      type: 'START_ACTION',
      deptId: department.id,
      actionId: 'flood_preparation',
      tierKey: 'primary',
      _idFactory: nextId,
    });
    const firstActionStartedAtDay = 0; // day 0

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterRound1Action = store.getRawState();
    expect(afterRound1Action.world.facts.flood_prepared).toBe(true);

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const round1Blocked = store.getRawState();
    const round1Blocker = round1Blocked.events.pending.find(
      (item) => item.eventId === 'flood_prepared_emergency',
    );
    expect(round1Blocker).toBeDefined();
    if (!round1Blocker) return;

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: round1Blocker.instanceId,
      optionId: 'reinforce_dikes',
      _rng: () => 0,
      _idFactory: nextId,
    });

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterRound1 = store.getRawState();
    // 准备标志不再由 flood_reconstruction 重置，存续到洪水风险自然降至 80 以下
    expect(afterRound1.world.facts.flood_prepared).toBe(true);
    expect(afterRound1.events.history.some((item) => item.eventId === 'flood_reconstruction')).toBe(
      true,
    );

    // ===== 冷却期内二次启动应被拒绝 =====
    // cooldownUntilDay = 0 + 4 + 35 = 39, 当前 day 约 29-35, 仍在冷却期内
    store.dispatch({
      type: 'START_ACTION',
      deptId: department.id,
      actionId: 'flood_preparation',
      tierKey: 'primary',
      _idFactory: nextId,
    });
    // 冷却期内操作被拒绝：准备标志保持 true（由第一轮设置，且风险尚未突破 80 门槛）
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: nextId,
    });
    expect(store.getRawState().world.facts.flood_prepared).toBe(true);

    // ===== 第二轮：等冷却期过期 =====
    // cooldownUntilDay = startedAtDay + durationDays + cooldownDays = 0 + 4 + 35 = 39
    const cooldownEndDay = firstActionStartedAtDay + 4 + 35; // 39

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterCooldown = store.getRawState();
    expect(afterCooldown.time.totalDaysPlayed).toBeGreaterThanOrEqual(cooldownEndDay);

    // 再次启动防汛准备
    store.dispatch({
      type: 'START_ACTION',
      deptId: department.id,
      actionId: 'flood_preparation',
      tierKey: 'primary',
      _idFactory: nextId,
    });

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterRound2Action = store.getRawState();
    // 第二轮独立设置准备标志，未被第一轮的残留清除覆盖
    expect(afterRound2Action.world.facts.flood_prepared).toBe(true);

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterRound2Emergency = store.getRawState();
    const round2Blocker = afterRound2Emergency.events.pending.find(
      (item) => item.eventId === 'flood_prepared_emergency',
    );
    expect(round2Blocker).toBeDefined();
    expect(afterRound2Emergency.events.activeBlockingEventId).toBe(round2Blocker!.instanceId);
  });

  it('产业园政策链: 招商完成 → 提交提议 → 同日提案审批 → 政策审批事件触发并保留上下文', () => {
    const state = createInitialState();
    // 切换到包含 economic_development 部门的职位（admin_l1_0 不含该部门）
    state.career.appointment.positionId = 'admin_l6_0';

    const loader = getConfigLoader();
    const department = loader
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.actions.some((a) => a.id === 'investment_promotion'));
    expect(department).toBeDefined();
    if (!department) return;

    state.remainingBudget = 10_000;
    state.actions.departmentStates[department.id] = {
      id: department.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };

    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `park-chain-${sequence++}`;

    // 启动招商引资行动（durationDays=5）
    store.dispatch({
      type: 'START_ACTION',
      deptId: department.id,
      actionId: 'investment_promotion',
      tierKey: 'primary',
      _idFactory: nextId,
    });

    // 推进一周让行动完成
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: nextId,
    });

    // 行动完成时 investment_promotion_completed 自动触发，排期 industrial_park_policy_proposal (delay 0)
    // delay 0 的排期在同日 step 之后创建，因此提案尚未激活
    const afterCompletion = store.getRawState();
    expect(afterCompletion.world.facts.industrial_park_policy_proposed).toBeFalsy();

    // 再次推进一天让上一步排期的提案激活
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterProposalActivated = store.getRawState();
    const proposal = afterProposalActivated.events.pending.find(
      (item) => item.eventId === 'industrial_park_policy_proposal',
    );
    expect(proposal).toBeDefined();
    expect(proposal?.snapshot.presentation).toBe('inbox');

    // 选择"提交政策提议"
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: proposal!.instanceId,
      optionId: 'submit_proposal',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterChoice = store.getRawState();
    expect(afterChoice.world.facts.industrial_park_policy_proposed).toBe(true);

    // 同日: 提案并审批政策
    store.dispatch({
      type: 'PROPOSE_POLICY',
      policyId: 'industrial_park_support',
      _idFactory: nextId,
    });
    const policy = store.getRawState().governance.policies[0];
    expect(policy).toBeDefined();
    if (!policy) return;

    store.dispatch({
      type: 'APPROVE_POLICY',
      policyInstanceId: policy.instanceId,
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterApproval = store.getRawState();
    expect(afterApproval.governance.policies[0]?.status).toBe('approved');

    // 推进一天：policy.approved 信号触发 industrial_park_policy_approved
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const afterSignal = store.getRawState();

    // 验证政策已进入实施阶段
    const activatedPolicy = afterSignal.governance.policies[0];
    expect(activatedPolicy?.status).toBe('implementing');

    // 验证工业园政策获批事件已记录在历史中
    const approvedEvent = afterSignal.events.history.find(
      (item) => item.eventId === 'industrial_park_policy_approved',
    );
    expect(approvedEvent).toBeDefined();

    // 验证工业园准备阶段启动事件已排期或已记录
    const preparationStarted =
      afterSignal.events.scheduled.find(
        (item) => item.eventId === 'industrial_park_preparation_started',
      ) ??
      afterSignal.events.history.find(
        (item) => item.eventId === 'industrial_park_preparation_started',
      );
    expect(preparationStarted).toBeDefined();
  });
});

describe('月度/年度钩子端到端回归', () => {
  it('flood_risk 月度钩子在汛季第 2 年触发 flood_emergency blocking 事件', () => {
    // 初始 month=7 day=1 yr=2012, totalDaysPlayed=0
    const state = createInitialState();
    state.remainingBudget = 50_000;
    // 确保有部门状态可供月度结算
    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `flood-hoof-${sequence++}`;

    // 推进 13 个月到达 year 2 month 7: flood_risk 75 (尚未 ≥80)
    for (let i = 0; i < 13; i++) {
      store.dispatch({
        type: 'ADVANCE_TIME',
        granularity: 'month',
        _rng: () => 0,
        _idFactory: nextId,
      });
    }

    // 再推进 1 个月: year 2 month 8, flood_risk 75→100, 应该触发 flood_emergency
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const result = store.getRawState();
    const floodEmergency = result.events.pending.find(
      (event) => event.eventId === 'flood_emergency',
    );
    expect(floodEmergency).toBeDefined();
    expect(result.events.activeBlockingEventId).toBe(floodEmergency?.instanceId);
    // flood_prepared 初始为 false，未经准备行动不得变为 true
    expect(result.world.facts.flood_prepared).toBeUndefined();
  });

  it('flood_risk 信号不会误触发 investigation_start（跨污染防护）', () => {
    // 设置 corruption_report 已达标，但 flood_risk 信号不应触发调查
    const state = createInitialState();
    state.remainingBudget = 50_000;
    state.world.metrics.corruption_report = 65;
    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `flood-xcont-${sequence++}`;

    // 推进 1 个月: flood_risk 0→25，发出 world.metric_changed(flood_risk)
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const result = store.getRawState();
    // flood_risk 确已更新
    expect(result.world.metrics.flood_risk).toBe(25);
    // 但 investigation_start 不应出现（信号 metricId 不匹配）
    const investigation = result.events.pending.find(
      (event) => event.eventId === 'investigation_start',
    );
    const investigationScheduled = result.events.scheduled.find(
      (item) => item.eventId === 'investigation_start',
    );
    expect(investigation).toBeUndefined();
    expect(investigationScheduled).toBeUndefined();
  });

  it('年度考核钩子触发 investigation_start 且仅触发一次', () => {
    // 设置腐败角色，推进一整年，验证调查事件仅触发一次
    const state = createInitialState();
    state.remainingBudget = 50_000;
    // 低 integrity + 高 corruptionRisk → 高 corruption_report
    state.character.integrity = 20;
    state.character.corruptionRisk = 60;
    state.character.stability = 50;
    // computeCorruptionReport: (100-20)*0.5 + 60*0.3 + (100-50)*0.2 = 40+18+10 = 68
    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `annual-invest-${sequence++}`;

    // 推进 6 个月，到达年底 (month 12)，年度考核触发
    // 逐月推进。汛期 (7-8 月) flood_risk 信号不会触发调查 (跨污染防护)
    for (let i = 0; i < 6; i++) {
      store.dispatch({
        type: 'ADVANCE_TIME',
        granularity: 'month',
        _rng: () => 0,
        _idFactory: nextId,
      });
    }

    const result = store.getRawState();
    // corruption_report 已被年度钩子计算并写入
    expect(result.world.metrics.corruption_report).toBeGreaterThanOrEqual(60);
    // investigation_start 应出现（来自 annual assessment 的 corruption_report 信号）
    const investigation = result.events.pending.find(
      (event) => event.eventId === 'investigation_start',
    );
    expect(investigation).toBeDefined();
    // 应只触发一次
    const investigationCount = result.events.pending.filter(
      (event) => event.eventId === 'investigation_start',
    ).length;
    expect(investigationCount).toBe(1);
    // flood_risk 信号不应同时触发（跨污染：flood_risk 未达 80 时不应触发 flood_emergency）
    expect(
      result.events.pending.filter((event) => event.eventId === 'flood_emergency').length,
    ).toBe(0);
  });
});
