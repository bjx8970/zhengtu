/**
 * 真实领域信号生产的 Store 集成测试。
 *
 * 覆盖行动、考核、政策指标，以及玩家/自动事件效果产生的指标信号。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { CareerOpportunityDefinition } from '../../types/config';
import { createEventSnapshot } from '../../engine/events/event-orchestrator';
import { processCascadeSignals } from '../reducers/event-reducer';
import { getConfigLoader } from '../../config/loader';
import { createInitialState, createTestStore } from '../game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';
import { CURRENT_CONTENT_VERSION } from '../../types/save';

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
  it('dispatches civil-service rank signals to career opportunities through the shared signal transaction', () => {
    const loader = getConfigLoader();
    const definition: CareerOpportunityDefinition = {
      id: 'rank-training-opportunity',
      type: 'training',
      triggerSignals: ['civil_service_rank.changed'],
      conditions: [],
      expiresAfterDays: null,
      repeatPolicy: 'once_per_source',
      cooldownDays: 0,
      requiresSelection: false,
      reasonTemplate: '',
      targetPositionId: null,
      trainingDefinitionId: 'rank-training',
      effects: [],
    };
    vi.spyOn(loader, 'getCareerOpportunityDefinitionsBySignal').mockReturnValue([definition]);
    const state = createInitialState();
    processCascadeSignals(
      state,
      [
        {
          signalId: 'rank-signal-delivery',
          signalType: 'civil_service_rank.changed',
          occurredAtDay: 0,
          data: {
            rankChangeId: 'rank-change-1',
            previousRank: 'clerk_2',
            currentRank: 'section_member_4',
            reason: 'regular_advancement',
            sourceType: 'system',
            sourceId: null,
          },
        },
      ],
      0,
      () => 0,
      () => 'rank-opportunity-1',
      loader.getAllEventDefinitions(),
    );
    expect(state.career.opportunities).toMatchObject([
      { definitionId: definition.id, source: { sourceId: 'rank:rank-change-1' } },
    ]);
  });

  it('START_ACTION 冻结完整执行快照，配置移除和边界漂移后仍按原语义完成', () => {
    const loader = getConfigLoader();
    const actionEvent = eventDefinition('action-completed-test', 'action.completed');
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      actionEvent,
    ]);
    const state = createInitialState();
    const department = loader
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.actions.some((action) => action.id === 'staff_meeting'));
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
      actionId: 'staff_meeting',
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
        contentVersion: CURRENT_CONTENT_VERSION,
        department: { id: department.id, name: department.name },
        action: { id: 'staff_meeting' },
        attributeBounds: { competence: [0, 100] },
      },
    });
    if (!occupant) return;
    const competenceBeforeCompletion = started.character.competence;

    const transferred = structuredClone(started);
    transferred.career.appointment.positionId = 'admin_l2_0';
    transferred.career.appointment.institutionId = 'county_govt_01';
    transferred.career.appointment.regionId = 'region_yongning_county';
    const transferredStore = createTestStore(transferred);
    const driftedConfig = structuredClone(loader.getGameConfig());
    vi.spyOn(loader, 'resolvePositionDepartments').mockReturnValue([]);
    vi.spyOn(loader, 'getGameConfig').mockReturnValue({
      ...driftedConfig,
      attributeBounds: {
        ...driftedConfig.attributeBounds,
        competence: [0, 0],
      },
    });
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
    expect(completed.character.competence).toBe(competenceBeforeCompletion + 1);
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
    expect(budgetAfterSettlement).toBeLessThan(10_000);
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

  it('自动事件指标信号产生 blocker 时暂停并仅一次恢复同日兄弟事件', () => {
    const definition: EventDefinition = {
      ...eventDefinition('metric-auto-source', 'event.resolved', 'automatic'),
      trigger: { sources: ['event.resolved'], scheduledOnly: true },
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
    const sibling: EventDefinition = {
      ...eventDefinition('metric-auto-sibling', 'event.resolved', 'automatic'),
      priority: 'low',
      trigger: { sources: ['event.resolved'], scheduledOnly: true },
      automaticOutcome: {
        effects: [
          {
            target: 'character',
            field: 'vigor',
            operation: 'add',
            value: -7,
          },
        ],
      },
    };
    const loader = getConfigLoader();
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      definition,
      sibling,
    ]);
    const state = createInitialState();
    state.events.scheduled.push(
      {
        instanceId: 'metric-auto-instance',
        eventId: definition.id,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: metricSeedSignal(),
        sourceKey: 'metric-auto-source',
        chainInstanceId: null,
        snapshot: createEventSnapshot(definition),
      },
      {
        instanceId: 'metric-auto-sibling-instance',
        eventId: sibling.id,
        scheduledAtDay: 0,
        activateAtDay: 1,
        triggerContext: metricSeedSignal(),
        sourceKey: 'metric-auto-sibling',
        chainInstanceId: null,
        snapshot: createEventSnapshot(sibling),
      },
    );
    const originalVigor = state.character.vigor;
    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `auto-metric-signal-${sequence++}`;
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0,
      _idFactory: nextId,
    });

    const interrupted = store.getRawState();
    const blocker = interrupted.events.pending.find((event) => event.eventId === 'flood_emergency');
    expect(interrupted.world.metrics.flood_risk).toBe(80);
    expect(
      interrupted.events.history.filter((record) => record.eventId === definition.id),
    ).toHaveLength(1);
    expect(blocker?.instanceId).toBe(interrupted.events.activeBlockingEventId);
    expect(interrupted.events.scheduled.map((event) => event.instanceId)).toContain(
      'metric-auto-sibling-instance',
    );
    expect(interrupted.events.history.some((record) => record.eventId === sibling.id)).toBe(false);
    expect(interrupted.character.vigor).toBe(originalVigor);
    expect(interrupted.time.pendingContinuation).not.toBeNull();
    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(interrupted)));
    expect(decoded.success).toBe(true);
    expect(decoded.state).toBeDefined();
    if (!decoded.state || !blocker) return;
    const resumedStore = createTestStore(decoded.state);

    resumedStore.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: blocker.instanceId,
      optionId: 'coordinate_rescue',
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
    expect(resumed.time.totalDaysPlayed).toBe(1);
    expect(resumed.time.pendingContinuation).toBeNull();
    expect(resumed.events.scheduled.map((event) => event.instanceId)).not.toContain(
      'metric-auto-sibling-instance',
    );
    expect(
      resumed.events.history.filter((record) => record.eventId === definition.id),
    ).toHaveLength(1);
    expect(resumed.events.history.filter((record) => record.eventId === sibling.id)).toHaveLength(
      1,
    );
    expect(resumed.character.vigor).toBe(originalVigor - 7);
  });
});
