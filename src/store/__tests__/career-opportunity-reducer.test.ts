/** 职业机会接受、选拔和原子任职事务集成测试。 */

import { describe, expect, it, vi } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';
import { getConfigLoader } from '../../config/loader';
import type {
  AppointmentCareerOpportunity,
  TrainingCareerOpportunity,
} from '../../domain/career/state';
import * as effectExecutor from '../../engine/events/effect-executor';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';

function createAvailableOpportunity(id = 'opportunity-1'): AppointmentCareerOpportunity {
  return {
    id,
    definitionId: 'township_deputy_leadership_vacancy',
    type: 'leadership_vacancy',
    status: 'available',
    source: {
      sourceType: 'assessment',
      sourceId: 'assessment-1',
      signalId: 'assessment-1',
      description: 'assessment.completed',
    },
    sourceSignal: {
      signalId: 'assessment-1',
      signalType: 'assessment.completed',
      occurredAtDay: 0,
      data: { year: 2026, score: 80, tier: '称职' },
    },
    target: {
      positionId: 'admin_l2_0',
      positionName: 'test position',
      institutionId: 'township_govt_01',
      institutionName: 'test institution',
      regionId: 'region_qingyun_town',
      institutionLevel: 'township',
      positionDomain: 'local_governance',
      leadershipRank: 'township_deputy',
    },
    appointmentType: 'substantive',
    appointmentReason: 'promotion',
    appearedAtDay: 0,
    expiresAtDay: 30,
    acceptedAtDay: null,
    rejectedAtDay: null,
    resolvedAtDay: null,
    cancelledAtDay: null,
    requiresSelection: true,
    eligibilityConditions: [],
    finalOutcome: null,
    reason: 'test',
  };
}

function createTrainingOpportunity(id = 'training-opportunity-1'): TrainingCareerOpportunity {
  return {
    id,
    definitionId: 'assessment_training',
    type: 'training',
    status: 'available',
    source: {
      sourceType: 'assessment',
      sourceId: 'assessment-1',
      signalId: 'assessment-1',
      description: 'assessment.completed',
    },
    sourceSignal: {
      signalId: 'assessment-1',
      signalType: 'assessment.completed',
      occurredAtDay: 0,
      data: { year: 2026, score: 80, tier: '称职' },
    },
    target: null,
    appointmentType: null,
    appointmentReason: null,
    trainingDefinitionId: 'training-1',
    effects: [{ target: 'assessment_score', operation: 'add', value: 1 }],
    appearedAtDay: 0,
    expiresAtDay: 30,
    acceptedAtDay: null,
    rejectedAtDay: null,
    resolvedAtDay: null,
    cancelledAtDay: null,
    requiresSelection: false,
    eligibilityConditions: [],
    finalOutcome: null,
    reason: 'test',
  };
}

describe('career opportunity reducer', () => {
  it('settles a leadership appointment into an isolated, playable governance runtime', () => {
    const initial = createInitialState();
    const opportunity: AppointmentCareerOpportunity = {
      id: 'opportunity-1',
      definitionId: 'township_deputy_leadership_vacancy',
      type: 'leadership_vacancy',
      status: 'available',
      source: {
        sourceType: 'assessment',
        sourceId: 'assessment-1',
        signalId: 'assessment-1',
        description: 'assessment.completed',
      },
      sourceSignal: {
        signalId: 'assessment-1',
        signalType: 'assessment.completed',
        occurredAtDay: 0,
        data: { year: 2026, score: 80, tier: '称职' },
      },
      target: {
        positionId: 'admin_l2_0',
        positionName: '副镇长',
        institutionId: 'township_govt_01',
        institutionName: '青云镇人民政府',
        regionId: 'region_qingyun_town',
        institutionLevel: 'township',
        positionDomain: 'local_governance',
        leadershipRank: 'township_deputy',
      },
      appointmentType: 'substantive',
      appointmentReason: 'promotion',
      appearedAtDay: 0,
      expiresAtDay: 30,
      acceptedAtDay: null,
      rejectedAtDay: null,
      resolvedAtDay: null,
      cancelledAtDay: null,
      requiresSelection: true,
      eligibilityConditions: [],
      finalOutcome: null,
      reason: 'test',
    };
    Object.assign(initial.time, {
      year: 2012,
      month: 12,
      day: 25,
      totalDaysPlayed: 354,
    });
    opportunity.appearedAtDay = 354;
    opportunity.expiresAtDay = 624;
    if (!opportunity.sourceSignal) throw new Error('Expected appointment trigger signal');
    opportunity.sourceSignal.occurredAtDay = 354;
    initial.career.opportunities = [opportunity];
    const store = createTestStore(initial);
    let sequence = 0;
    const ids = () => `id-${++sequence}`;
    const rank = store.getRawState().career.civilServiceRank;
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: ids,
    });
    for (let step = 0; step < 6; step++)
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _idFactory: ids,
        _rng: () => 0,
      });
    const state = store.getRawState();
    expect(state.career.appointment.positionId).toBe('admin_l2_0');
    expect(state.career.civilServiceRank).toBe(rank);
    expect(state.career.experiences.filter((item) => item.endedAtDay === null)).toHaveLength(1);
    expect(state.career.experiences[0]?.endedAtDay).toBe(354);
    expect(state.career.opportunities[0]?.finalOutcome).toBe('appointed');
    expect(state.career.completedProcesses).toMatchObject([
      { status: 'completed', opportunityId: opportunity.id },
    ]);
    expect(state.career.completedProcesses[0]?.stageResults).toHaveLength(6);
    expect(state.remainingBudget).toBe(6000);
    expect(Object.keys(state.actions.departmentStates)).toEqual([
      'admin_l2_0_dept_0',
      'admin_l2_0_dept_1',
      'admin_l2_0_dept_2',
      'admin_l2_0_dept_3',
    ]);

    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'secondary',
    });
    expect(store.getRawState().actions.totalActions).toBe(0);
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'primary',
      _idFactory: () => 'deputy-investment-action',
    });
    expect(store.getRawState().remainingBudget).toBe(5850);

    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l1_0_dept_0',
      actionId: 'document_processing',
      tierKey: 'primary',
    });
    expect(store.getRawState().actions.totalActions).toBe(1);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'week', _rng: () => 0 });
    const governed = store.getRawState();
    expect(governed.actions.departmentStates.admin_l2_0_dept_0?.kpiValues).toMatchObject({
      project_completion: 8,
    });
    expect(governed.assessments.annualAssessments).toHaveLength(1);
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'primary',
    });
    expect(store.getRawState().actions.totalActions).toBe(1);
  });

  it('rejects an available opportunity through store dispatch', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
    const appointmentBefore = structuredClone(store.getRawState().career.appointment);
    const experiencesBefore = structuredClone(store.getRawState().career.experiences);

    store.dispatch({ type: 'REJECT_CAREER_OPPORTUNITY', opportunityId: opportunity.id });

    const state = store.getRawState();
    expect(state.career.opportunities[0]).toMatchObject({
      status: 'rejected',
      rejectedAtDay: 0,
      acceptedAtDay: null,
      resolvedAtDay: null,
      cancelledAtDay: null,
      finalOutcome: null,
    });
    expect(state.career.activeProcess).toBeNull();
    expect(state.career.appointment).toEqual(appointmentBefore);
    expect(state.career.experiences).toEqual(experiencesBefore);
  });

  it('cancels an available opportunity through store dispatch', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
    const appointmentBefore = structuredClone(store.getRawState().career.appointment);
    const experiencesBefore = structuredClone(store.getRawState().career.experiences);

    store.dispatch({ type: 'CANCEL_CAREER_OPPORTUNITY', opportunityId: opportunity.id });

    const state = store.getRawState();
    expect(state.career.opportunities[0]).toMatchObject({
      status: 'cancelled',
      cancelledAtDay: 0,
      acceptedAtDay: null,
      rejectedAtDay: null,
      resolvedAtDay: null,
      finalOutcome: null,
    });
    expect(state.career.activeProcess).toBeNull();
    expect(state.career.appointment).toEqual(appointmentBefore);
    expect(state.career.experiences).toEqual(experiencesBefore);
  });

  it('rejects acceptance when an opportunity eligibility condition is no longer met', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    opportunity.eligibilityConditions = [{ worldMetric: 'missing_metric', op: 'gte', value: 1 }];
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
    const before = structuredClone(store.getRawState());

    store.dispatch({ type: 'ACCEPT_CAREER_OPPORTUNITY', opportunityId: opportunity.id });

    expect(store.getRawState()).toEqual(before);
  });

  it('accepts an opportunity whose frozen trigger signal satisfies a signal field condition', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    opportunity.eligibilityConditions = [{ signalField: 'tier', op: 'eq', value: '称职' }];
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });

    store.dispatch({ type: 'ACCEPT_CAREER_OPPORTUNITY', opportunityId: opportunity.id });

    expect(store.getRawState().career.activeProcess).toMatchObject({
      opportunityId: opportunity.id,
      status: 'active',
    });
  });

  it('blocks acceptance and final appointment while personal work is running', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    initial.career.opportunities = [opportunity];
    const acceptingStore = createTestStore(initial);
    acceptingStore.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_induction_training',
      tierKey: 'primary',
      _idFactory: () => 'running-task',
    });
    acceptingStore.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
    });
    expect(acceptingStore.getRawState().career.activeProcess).toBeNull();

    const clear = createInitialState();
    clear.career.opportunities = [opportunity];
    const finalStore = createTestStore(clear);
    finalStore.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: () => 'selection-process',
    });
    finalStore.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_induction_training',
      tierKey: 'primary',
      _idFactory: () => 'final-running-task',
    });
    for (let step = 0; step < 5; step++)
      finalStore.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => 0,
      });
    expect(finalStore.getRawState().career.activeProcess?.currentStage).toBe('appointment');
    const before = structuredClone(finalStore.getRawState());
    finalStore.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => 0,
    });
    expect(finalStore.getRawState()).toEqual(before);
  });

  it('archives a failed process when eligibility review no longer passes', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    opportunity.eligibilityConditions = [{ worldMetric: 'selection_ready', op: 'gte', value: 1 }];
    initial.world.metrics.selection_ready = 1;
    initial.career.opportunities = [opportunity];
    const acceptedStore = createTestStore(initial);
    acceptedStore.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: () => 'selection-process',
    });
    const changed = structuredClone(acceptedStore.getRawState());
    changed.world.metrics.selection_ready = 0;
    const store = createTestStore(changed);

    store.dispatch({ type: 'ADVANCE_CAREER_PROCESS', opportunityId: opportunity.id });

    expect(store.getRawState().career.activeProcess).toBeNull();
    expect(store.getRawState().career.opportunities[0]).toMatchObject({
      status: 'resolved',
      finalOutcome: 'not_selected',
    });
    expect(store.getRawState().career.completedProcesses.at(-1)).toMatchObject({
      status: 'failed',
      stageResults: [{ stage: 'eligibility_review', outcome: 'failed' }],
    });
  });

  it('continues an accepted selection across its opportunity deadline and save restore', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity('deadline-opportunity');
    opportunity.expiresAtDay = 1;
    initial.career.opportunities = [opportunity];
    const beforeDeadline = createTestStore(initial);
    let sequence = 0;
    const ids = () => `deadline-id-${sequence++}`;
    beforeDeadline.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: ids,
    });
    beforeDeadline.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _idFactory: ids });
    expect(beforeDeadline.getRawState().time.totalDaysPlayed).toBe(1);
    expect(beforeDeadline.getRawState().career.opportunities[0]?.status).toBe('in_process');
    const decoded = decodeCurrentSave(
      JSON.stringify(wrapSaveEnvelope(beforeDeadline.getRawState())),
    );
    if (!decoded.success || !decoded.state) throw new Error('Expected restored selection save');
    const restored = createTestStore(decoded.state);

    for (let step = 0; step < 6; step++)
      restored.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _idFactory: ids,
        _rng: () => 0,
      });

    expect(restored.getRawState().career.opportunities[0]).toMatchObject({
      status: 'resolved',
      finalOutcome: 'appointed',
    });
    expect(restored.getRawState().career.appointment.positionId).toBe('admin_l2_0');
  });

  it('allows selection stages but not final appointment while a blocking event is active', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: () => 'process-1',
    });
    const blockedState = structuredClone(store.getRawState());
    blockedState.events.activeBlockingEventId = 'blocking-event-1';
    const blockedStore = createTestStore(blockedState);
    for (let step = 0; step < 5; step++)
      blockedStore.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _idFactory: () => 'unused-id',
        _rng: () => 0,
      });
    expect(blockedStore.getRawState().career.activeProcess?.currentStage).toBe('appointment');
    const before = structuredClone(blockedStore.getRawState());

    expect(() =>
      blockedStore.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _idFactory: () => 'unused-id',
        _rng: () => 0,
      }),
    ).not.toThrow();
    expect(blockedStore.getRawState()).toEqual(before);
  });

  it('does not appoint when target-position requirements are no longer met', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: () => 'process-1',
    });
    const loader = getConfigLoader();
    const target = loader.getPositionById(opportunity.target.positionId);
    if (!target) throw new Error('Expected target position');
    const positionSpy = vi.spyOn(loader, 'getPositionById').mockReturnValue({
      ...target,
      requirements: [{ worldMetric: 'missing_metric', op: 'gte', value: 1 }],
    });
    for (let step = 0; step < 5; step++)
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => 0,
      });
    const beforeAppointment = structuredClone(store.getRawState());

    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => 0,
    });

    expect(store.getRawState()).toEqual(beforeAppointment);
    positionSpy.mockRestore();
  });

  it('ignores a public outcome property when advancing a career process', () => {
    const initial = createInitialState();
    const opportunity = createAvailableOpportunity();
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
    store.dispatch({ type: 'ACCEPT_CAREER_OPPORTUNITY', opportunityId: opportunity.id });

    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      outcome: 'failed',
    } as never);

    expect(store.getRawState().career.activeProcess).toMatchObject({
      currentStage: 'democratic_recommendation',
      status: 'active',
    });
  });

  it('passes the frozen source signal to training effects instead of a later assessment', () => {
    const initial = createInitialState();
    const opportunity = createTrainingOpportunity();
    opportunity.source = {
      sourceType: 'event',
      sourceId: 'event:instance-1',
      signalId: 'event-signal-1',
      description: 'event.resolved',
    };
    opportunity.sourceSignal = {
      signalId: 'event-signal-1',
      signalType: 'event.resolved',
      occurredAtDay: 5,
      data: {
        eventInstanceId: 'instance-1',
        eventId: 'event-1',
        optionId: 'option-1',
        occurredAtDay: 5,
      },
    };
    initial.career.opportunities = [opportunity];
    initial.assessments.annualAssessments = [{ year: 2027, score: 90, tier: '优秀' }];
    const applyEffectsSpy = vi.spyOn(effectExecutor, 'applyEffects');
    const store = createTestStore({
      career: initial.career,
      assessments: initial.assessments,
    });

    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: () => 'training-process-1',
    });
    store.dispatch({ type: 'ADVANCE_CAREER_PROCESS', opportunityId: opportunity.id });
    store.dispatch({ type: 'ADVANCE_CAREER_PROCESS', opportunityId: opportunity.id });

    const effectContext = applyEffectsSpy.mock.calls[0]?.[2];
    expect(effectContext?.signal).toMatchObject({
      signalType: 'event.resolved',
      occurredAtDay: 5,
      data: { eventId: 'event-1', optionId: 'option-1' },
    });
    expect(store.getRawState().assessments.comprehensiveScore).toBe(1);
    applyEffectsSpy.mockRestore();
  });
});
