/**
 * 真实领域信号生产的 Store 集成测试。
 *
 * 覆盖行动、考核、政策指标，以及玩家/自动事件效果产生的指标信号。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { createEventSnapshot } from '../../engine/events/event-orchestrator';
import { getConfigLoader } from '../../config/loader';
import { createInitialState, createTestStore } from '../game-store';

function eventDefinition(
  id: string,
  source: DomainSignalSnapshot['signalType'],
  presentation: 'inbox' | 'blocking' | 'automatic' = 'inbox',
): EventDefinition {
  return {
    id,
    chainId: null,
    nodeId: null,
    title: id,
    description: '',
    category: 'governance',
    priority: presentation === 'blocking' ? 'urgent' : 'normal',
    presentation,
    trigger: { sources: [source], probability: 1 },
    repeatPolicy: { mode: 'once_per_source' },
    activation: {},
    options:
      presentation === 'automatic'
        ? []
        : [{ id: 'ack', label: '处理', description: '', effects: [] }],
    automaticOutcome: presentation === 'automatic' ? { effects: [] } : undefined,
  };
}

function metricSeedSignal(): DomainSignalSnapshot {
  return {
    signalId: 'seed-signal',
    signalType: 'world.metric_changed',
    occurredAtDay: 0,
    data: { metricId: 'seed', value: 1 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('domain signal production', () => {
  it('START_ACTION 冻结完整执行快照，配置移除后仍完成且只发一次 action.completed', () => {
    const loader = getConfigLoader();
    const actionEvent = eventDefinition('action-completed-test', 'action.completed');
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      actionEvent,
    ]);
    const state = createInitialState();
    const department = loader.resolvePositionDepartments(state.career.appointment.positionId)[0];
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
    store.dispatch({
      type: 'START_ACTION',
      deptId: department.id,
      actionId: 'document_processing',
      tierKey: 'primary',
      _idFactory: () => 'stable-action-instance',
    });
    const started = store.getRawState();
    const occupant = started.actions.slots.primary.occupants[0];
    expect(occupant).toMatchObject({
      instanceId: 'stable-action-instance',
      originPositionId: state.career.appointment.positionId,
      originInstitutionId: state.career.appointment.institutionId,
      originRegionId: state.career.appointment.regionId,
      executableSnapshot: {
        contentVersion: '2026.07.4',
        department: { id: department.id, name: department.name },
        action: { id: 'document_processing' },
      },
    });
    if (!occupant) return;

    const transferred = structuredClone(started);
    transferred.career.appointment.positionId = 'admin_l2_0';
    transferred.career.appointment.institutionId = 'county_govt_01';
    transferred.career.appointment.regionId = 'region_yongning_county';
    const transferredStore = createTestStore(transferred);
    vi.spyOn(loader, 'resolvePositionDepartments').mockReturnValue([]);
    let sequence = 0;
    for (let day = 0; day < occupant.durationDays; day++) {
      transferredStore.dispatch({
        type: 'ADVANCE_TIME',
        granularity: 'day',
        _rng: () => 0,
        _idFactory: () => `action-signal-${sequence++}`,
      });
    }

    const completed = transferredStore.getRawState();
    const triggered = completed.events.pending.find((event) => event.eventId === actionEvent.id);
    expect(triggered?.sourceKey).toBe('stable-action-instance');
    expect(triggered?.triggerContext).toMatchObject({
      signalType: 'action.completed',
      data: {
        actionInstanceId: 'stable-action-instance',
        institutionId: state.career.appointment.institutionId,
        regionId: state.career.appointment.regionId,
      },
    });
    transferredStore.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(
      transferredStore
        .getRawState()
        .events.pending.filter((event) => event.eventId === actionEvent.id),
    ).toHaveLength(1);
  });

  it('年度考核写入记录和属性后发出 assessment.completed，并可同日恢复', () => {
    const loader = getConfigLoader();
    const assessmentEvent = eventDefinition(
      'assessment-completed-test',
      'assessment.completed',
      'blocking',
    );
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      assessmentEvent,
    ]);
    const config = loader.getGameConfig();
    const state = createInitialState();
    state.time = {
      year: config.startYear,
      month: config.monthsPerYear,
      day: config.daysPerMonth,
      granularity: 'day',
      totalDaysPlayed: config.monthsPerYear * config.daysPerMonth - 1,
      pendingContinuation: null,
    };
    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `assessment-signal-${sequence++}`;
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const blocked = store.getRawState();
    const record = blocked.assessments.annualAssessments[0];
    const event = blocked.events.pending.find((item) => item.eventId === assessmentEvent.id);
    expect(record).toBeDefined();
    expect(event?.triggerContext).toMatchObject({
      signalType: 'assessment.completed',
      data: { year: record?.year, score: record?.score, tier: record?.tier },
    });
    expect(blocked.time.pendingContinuation).not.toBeNull();
    expect(blocked.assessments.annualAssessments).toHaveLength(1);
    const budgetAfterSettlement = blocked.remainingBudget;
    if (!event) return;

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: event.instanceId,
      optionId: 'ack',
      _rng: () => 0,
      _idFactory: nextId,
    });
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });
    expect(store.getRawState().time.totalDaysPlayed).toBe(
      config.monthsPerYear * config.daysPerMonth,
    );
    expect(store.getRawState().assessments.annualAssessments).toHaveLength(1);
    expect(store.getRawState().remainingBudget).toBe(budgetAfterSettlement);
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(store.getRawState().assessments.annualAssessments).toHaveLength(1);
    expect(store.getRawState().remainingBudget).toBe(budgetAfterSettlement);
  });

  it('政策效果产生 policy.metric_changed 并使用冻结原始上下文', () => {
    const loader = getConfigLoader();
    const metricEvent = eventDefinition('policy-metric-test', 'policy.metric_changed');
    metricEvent.trigger.condition = {
      signalField: 'metricId',
      op: 'eq',
      value: 'progress',
    };
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      metricEvent,
    ]);
    const state = createInitialState();
    state.governance.policies.push({
      instanceId: 'metric-policy-instance',
      policyId: 'metric-policy',
      status: 'approved',
      proposedAtDay: 0,
      approvedAtDay: 0,
      effectiveAtDay: 0,
      currentPhaseId: null,
      phaseEnteredAtDay: null,
      nextMilestoneAtDay: null,
      suspendedAtDay: null,
      accumulatedSuspendedDays: 0,
      completedAtDay: null,
      failedAtDay: null,
      repealedAtDay: null,
      originContext: {
        ...state.career.appointment,
        positionId: state.career.appointment.positionId,
        experienceId: null,
      },
      snapshot: {
        policyId: 'metric-policy',
        name: '指标政策',
        description: '',
        category: 'economic',
        tags: [],
        effectiveDelayDays: 0,
        approvalEffects: [],
        phases: [
          {
            id: 'implementation',
            name: '实施',
            description: '',
            durationDays: 30,
            entryEffects: [
              {
                target: 'policy_metric',
                policyRef: { source: 'signal', field: 'policyInstanceId' },
                metricId: 'progress',
                operation: 'add',
                value: 10,
              },
            ],
            completionEffects: [],
          },
        ],
        contentVersion: 'test',
      },
      metrics: {},
    });
    const store = createTestStore(state);
    let sequence = 0;
    store.dispatch({
      type: 'ACTIVATE_POLICY',
      policyInstanceId: 'metric-policy-instance',
      _rng: () => 0,
      _idFactory: () => `policy-metric-signal-${sequence++}`,
    });

    const result = store.getRawState();
    const event = result.events.pending.find((item) => item.eventId === metricEvent.id);
    expect(result.governance.policies[0]?.metrics.progress).toBe(10);
    expect(event?.triggerContext).toMatchObject({
      signalType: 'policy.metric_changed',
      data: {
        policyInstanceId: 'metric-policy-instance',
        metricId: 'progress',
        value: 10,
        regionId: state.career.appointment.regionId,
        institutionId: state.career.appointment.institutionId,
        originPositionId: state.career.appointment.positionId,
      },
    });
  });

  it('玩家选项效果先派生 world.metric_changed，再触发既有防汛 blocker', () => {
    const state = createInitialState();
    const definition: EventDefinition = {
      ...eventDefinition('metric-option-source', 'world.metric_changed'),
      options: [
        {
          id: 'raise-risk',
          label: '提高风险',
          description: '',
          effects: [
            {
              target: 'world_metric',
              metricId: 'flood_risk',
              operation: 'set',
              value: 80,
            },
          ],
        },
      ],
    };
    const loader = getConfigLoader();
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      definition,
    ]);
    state.events.pending.push({
      instanceId: 'metric-option-instance',
      eventId: definition.id,
      status: 'active',
      triggeredAtDay: 0,
      activatedAtDay: 0,
      deadlineDay: null,
      triggerContext: metricSeedSignal(),
      sourceKey: 'metric-option-source',
      chainInstanceId: null,
      snapshot: createEventSnapshot(definition),
    });
    const store = createTestStore(state);
    let sequence = 0;
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: 'metric-option-instance',
      optionId: 'raise-risk',
      _rng: () => 0,
      _idFactory: () => `event-metric-signal-${sequence++}`,
    });

    const result = store.getRawState();
    expect(result.world.metrics.flood_risk).toBe(80);
    expect(result.events.pending.some((event) => event.eventId === 'flood_emergency')).toBe(true);
    expect(result.events.activeBlockingEventId).not.toBeNull();
  });

  it('自动事件效果采用相同指标信号顺序', () => {
    const definition: EventDefinition = {
      ...eventDefinition('metric-auto-source', 'event.resolved', 'automatic'),
      automaticOutcome: {
        effects: [
          {
            target: 'world_metric',
            metricId: 'flood_risk',
            operation: 'set',
            value: 80,
          },
        ],
      },
    };
    const loader = getConfigLoader();
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      definition,
    ]);
    const state = createInitialState();
    state.events.scheduled.push({
      instanceId: 'metric-auto-instance',
      eventId: definition.id,
      scheduledAtDay: 0,
      activateAtDay: 1,
      triggerContext: metricSeedSignal(),
      sourceKey: 'metric-auto-source',
      chainInstanceId: null,
      snapshot: createEventSnapshot(definition),
    });
    const store = createTestStore(state);
    let sequence = 0;
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: () => `auto-metric-signal-${sequence++}`,
    });

    const result = store.getRawState();
    expect(result.world.metrics.flood_risk).toBe(80);
    expect(result.events.history.some((record) => record.eventId === definition.id)).toBe(true);
    expect(result.events.pending.some((event) => event.eventId === 'flood_emergency')).toBe(true);
    expect(result.time.pendingContinuation).not.toBeNull();
  });
});
