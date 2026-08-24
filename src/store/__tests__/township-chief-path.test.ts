/** 乡科级正职机会从真实副职履历、治理成果到原子任职的集成测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../config/loader';
import type { EventHistoryRecord } from '../../domain/events/state';
import type { PlayerSave } from '../../types/player';
import { createInitialState, createTestStore } from '../game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';
import { transitionPlayerSeat } from '../transactions/organization-seat-transaction';

function historyRecord(eventId: string, day: number): EventHistoryRecord {
  return {
    eventId,
    instanceId: `${eventId}-instance`,
    finalStatus: 'resolved',
    triggeredAtDay: day,
    completedAtDay: day,
    sourceKey: `${eventId}-source`,
    chainInstanceId: null,
    titleSnapshot: eventId,
    chosenOptionId: null,
    chosenOptionLabel: null,
    appliedEffects: [],
  };
}

function createDeputyYearEndState(): PlayerSave {
  const loader = getConfigLoader();
  const state = createInitialState();
  const deputy = loader.getPositionById('admin_l2_0');
  const institution = deputy ? loader.getInstitutionById(deputy.institutionId) : null;
  const oldExperience = state.career.experiences[0];
  if (!deputy || !institution || !oldExperience) throw new Error('Expected deputy fixtures');

  oldExperience.endedAtDay = 720;
  oldExperience.endReason = 'promotion';
  state.career.appointment = {
    appointmentId: 'deputy-appointment',
    positionId: deputy.id,
    institutionId: deputy.institutionId,
    regionId: deputy.regionId,
    institutionLevel: deputy.institutionLevel,
    positionDomain: deputy.positionDomain,
    leadershipRank: deputy.leadershipRank,
    startedAtDay: 720,
    appointmentType: 'substantive',
    appointmentReason: 'promotion',
    sourceOpportunityId: 'deputy-source-opportunity',
    status: 'active',
    endedAtDay: null,
    endReason: null,
    probation: null,
  };
  if (
    !transitionPlayerSeat(state.organization, oldExperience.appointmentId, state.career.appointment)
  )
    throw new Error('Expected player organization seat transition');
  state.career.experiences.push({
    id: 'deputy-experience',
    appointmentId: 'deputy-appointment',
    positionId: deputy.id,
    positionNameSnapshot: deputy.name,
    institutionId: institution.id,
    institutionNameSnapshot: institution.name,
    regionId: deputy.regionId,
    institutionLevel: deputy.institutionLevel,
    positionDomain: deputy.positionDomain,
    leadershipRank: deputy.leadershipRank,
    appointmentType: 'substantive',
    appointmentReason: 'promotion',
    sourceOpportunityId: 'deputy-source-opportunity',
    startedAtDay: 720,
    endedAtDay: null,
    endReason: null,
    assessmentResults: [{ year: 2014, score: 90, tier: '称职' }],
  });
  state.assessments.annualAssessments.push({ year: 2014, score: 90, tier: '称职' });
  state.events.history.push(
    historyRecord('flood_preparation_metrics', 900),
    historyRecord('industrial_park_progress_crisis', 1080),
  );
  state.world.facts.industrial_park_policy_proposed = true;
  state.actions.departmentStates = Object.fromEntries(
    loader.resolvePositionDepartments(deputy.id).map((department) => [
      department.id,
      {
        id: department.id,
        kpiValues: Object.fromEntries(
          department.kpiIndicators.map((indicator) => [indicator.id, indicator.targetValue]),
        ),
        monthlyConsumption: 0,
        cumulativeConsumption: 0,
        lastActionDay: 720,
        actionCooldownUntilDays: {},
      },
    ]),
  );
  Object.assign(state.character, {
    integrity: 100,
    stability: 100,
    ambition: 100,
    competence: 100,
    charisma: 100,
    network: 100,
    diligence: 100,
    vigor: 100,
    corruptionRisk: 0,
  });
  Object.assign(state.time, {
    year: 2015,
    month: 12,
    day: 30,
    totalDaysPlayed: 1259,
    pendingContinuation: null,
  });
  state.remainingBudget = deputy.annualBudget;
  return state;
}

function advanceMonths(store: ReturnType<typeof createTestStore>, count: number): void {
  let sequence = 0;
  for (let month = 0; month < count; month++)
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: () => `chief-month-${sequence++}`,
    });
}

describe('township chief opportunity', () => {
  it('writes the second deputy assessment before generating a 270-day chief window', () => {
    const store = createTestStore(createDeputyYearEndState());
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0 });

    const state = store.getRawState();
    const currentExperience = state.career.experiences.find(
      (experience) => experience.appointmentId === 'deputy-appointment',
    );
    expect(currentExperience?.assessmentResults).toHaveLength(2);
    expect(currentExperience?.assessmentResults[1]).toMatchObject({
      year: 2015,
      tier: expect.stringMatching(/优秀|称职/),
    });
    expect(
      state.career.opportunities.find(
        (opportunity) => opportunity.definitionId === 'township_chief_leadership_vacancy',
      ),
    ).toMatchObject({
      status: 'available',
      appearedAtDay: 1260,
      expiresAtDay: 1530,
    });
  });

  it.each([
    [
      'missing flood governance',
      (state: PlayerSave) => {
        state.events.history.shift();
      },
    ],
    [
      'only one current appointment assessment',
      (state: PlayerSave) => {
        const current = state.career.experiences.find(
          (experience) => experience.appointmentId === 'deputy-appointment',
        );
        if (current) current.assessmentResults = [];
      },
    ],
    [
      'active appointment freeze',
      (state: PlayerSave) => {
        state.career.restrictions.push({
          id: 'chief-freeze',
          type: 'appointment_selection_freeze',
          startedAtDay: 1200,
          endsAtDay: null,
          reason: 'test',
          sourceType: 'system',
          sourceId: null,
        });
      },
    ],
  ])('does not generate with %s', (_label, arrange) => {
    const state = createDeputyYearEndState();
    arrange(state);
    const store = createTestStore(state);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0 });

    expect(
      store
        .getRawState()
        .career.opportunities.some(
          (opportunity) => opportunity.definitionId === 'township_chief_leadership_vacancy',
        ),
    ).toBe(false);
  });

  it('waits for two years, survives refresh, and atomically appoints the township chief', () => {
    const store = createTestStore(createDeputyYearEndState());
    let sequence = 0;
    const ids = () => `chief-path-${sequence++}`;
    store.dispatch({
      type: 'PROPOSE_POLICY',
      policyId: 'industrial_park_support',
      _idFactory: ids,
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0, _idFactory: ids });
    const opportunity = store
      .getRawState()
      .career.opportunities.find(
        (item) => item.definitionId === 'township_chief_leadership_vacancy',
      );
    if (!opportunity) throw new Error('Expected chief opportunity');
    const policyBefore = structuredClone(store.getRawState().governance.policies);

    store.dispatch({ type: 'ACCEPT_CAREER_OPPORTUNITY', opportunityId: opportunity.id });
    expect(store.getRawState().career.activeProcess).toBeNull();
    advanceMonths(store, 6);
    expect(store.getRawState().time.totalDaysPlayed).toBe(1440);

    const eligibleState = structuredClone(store.getRawState());
    const failedState = structuredClone(eligibleState);
    Object.assign(failedState.character, {
      competence: 0,
      diligence: 0,
      integrity: 0,
      charisma: 0,
      network: 0,
    });
    const failedStore = createTestStore(failedState);
    failedStore.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: ids,
    });
    failedStore.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => 0,
      _idFactory: ids,
    });
    failedStore.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => 1,
      _idFactory: ids,
    });
    expect(failedStore.getRawState().career.appointment.leadershipRank).toBe('township_deputy');
    expect(failedStore.getRawState().career.activeProcess).toBeNull();
    expect(failedStore.getRawState().career.opportunities.at(-1)).toMatchObject({
      status: 'resolved',
      finalOutcome: 'not_selected',
    });
    failedStore.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_1',
      actionId: 'tax_collection',
      tierKey: 'primary',
    });
    expect(failedStore.getRawState().actions.totalActions).toBe(1);

    const acceptedStore = createTestStore(eligibleState);
    acceptedStore.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: ids,
    });
    const decoded = decodeCurrentSave(
      JSON.stringify(wrapSaveEnvelope(acceptedStore.getRawState())),
    );
    if (!decoded.success || !decoded.state) throw new Error('Expected chief selection save');
    const restored = createTestStore(decoded.state);
    const rankBefore = restored.getRawState().career.civilServiceRank;
    for (let stage = 0; stage < 6; stage++)
      restored.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => 0,
        _idFactory: ids,
      });

    const appointed = restored.getRawState();
    expect(appointed.career.appointment).toMatchObject({
      positionId: 'admin_l3_0',
      leadershipRank: 'township_chief',
      startedAtDay: 1440,
    });
    expect(appointed.career.civilServiceRank).toBe(rankBefore);
    expect(appointed.remainingBudget).toBe(7500);
    expect(Object.keys(appointed.actions.departmentStates)).toHaveLength(5);
    expect(appointed.career.experiences.filter((item) => item.endedAtDay === null)).toHaveLength(1);
    expect(appointed.career.experiences.at(-2)?.endedAtDay).toBe(1440);
    expect(appointed.governance.policies).toEqual(policyBefore);
    expect(appointed.events.history.map((record) => record.eventId)).toEqual(
      expect.arrayContaining(['flood_preparation_metrics', 'industrial_park_progress_crisis']),
    );
  });

  it('expires an unaccepted window and blocks acceptance/final appointment during running work', () => {
    const store = createTestStore(createDeputyYearEndState());
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0 });
    const opportunity = store
      .getRawState()
      .career.opportunities.find(
        (item) => item.definitionId === 'township_chief_leadership_vacancy',
      );
    if (!opportunity) throw new Error('Expected chief opportunity');
    advanceMonths(store, 6);

    const runningState = structuredClone(store.getRawState());
    const runningStore = createTestStore(runningState);
    runningStore.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_study',
      tierKey: 'primary',
    });
    runningStore.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
    });
    expect(runningStore.getRawState().career.activeProcess).toBeNull();

    const finalStore = createTestStore(runningState);
    finalStore.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
    });
    for (let stage = 0; stage < 5; stage++)
      finalStore.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => 0,
      });
    finalStore.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_study',
      tierKey: 'primary',
    });
    const beforeFinal = structuredClone(finalStore.getRawState());
    finalStore.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => 0,
    });
    expect(finalStore.getRawState()).toEqual(beforeFinal);

    const expiryState = structuredClone(store.getRawState());
    expiryState.world.metrics.flood_risk = 0;
    const expiryStore = createTestStore(expiryState);
    advanceMonths(expiryStore, 3);
    expect(expiryStore.getRawState().time.totalDaysPlayed).toBe(1530);
    expect(
      expiryStore.getRawState().career.opportunities.find((item) => item.id === opportunity.id),
    ).toMatchObject({ status: 'expired' });
  });
});
