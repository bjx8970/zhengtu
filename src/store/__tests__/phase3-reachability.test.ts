/** Phase 3 正常玩家路径：从建档、任务与考核到副职治理及镇长任职。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../config/loader';
import type { GameAction } from '../../types/game';
import { createTestStore } from '../game-store';

type TestStore = ReturnType<typeof createTestStore>;

function createIdFactory(): () => string {
  let nextId = 0;
  return () => `phase3-scenario-${nextId++}`;
}

function resolveBlockingEvents(store: TestStore, idFactory: () => string): void {
  const loader = getConfigLoader();
  while (store.getRawState().events.activeBlockingEventId) {
    const state = store.getRawState();
    const instance = state.events.pending.find(
      (item) => item.instanceId === state.events.activeBlockingEventId,
    );
    if (!instance) throw new Error('Active blocking event is missing from pending events');
    const definition = loader.getEventDefinition(instance.eventId);
    const option = definition?.options[0];
    if (!option) throw new Error(`Blocking event ${instance.eventId} has no playable option`);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: instance.instanceId,
      optionId: option.id,
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
  }
}

function advanceToDay(store: TestStore, targetDay: number, idFactory: () => string): void {
  while (store.getRawState().time.totalDaysPlayed < targetDay) {
    resolveBlockingEvents(store, idFactory);
    const remaining = targetDay - store.getRawState().time.totalDaysPlayed;
    const granularity: Extract<GameAction, { type: 'ADVANCE_TIME' }>['granularity'] =
      remaining >= 30 ? 'month' : remaining >= 7 ? 'week' : 'day';
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity,
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
  }
  resolveBlockingEvents(store, idFactory);
}

function createPhase3Game(store: TestStore): void {
  store.dispatch({
    type: 'NEW_GAME',
    data: {
      characterName: '可达性测试员',
      familyBackground: 'peasant',
      promotionPath: 'gongwuyuan',
    },
  });
}

function completeQualifiedClerkHalfYear(
  store: TestStore,
  targetDay: number,
  idFactory: () => string,
): void {
  store.dispatch({
    type: 'START_PERSONAL_TASK',
    taskId: 'task_induction_training',
    tierKey: 'primary',
    _idFactory: idFactory,
  });
  while (store.getRawState().time.totalDaysPlayed < targetDay) {
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_brief',
      tierKey: 'secondary',
      _idFactory: idFactory,
    });
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_social_security_promotion',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    advanceToDay(
      store,
      Math.min(store.getRawState().time.totalDaysPlayed + 7, targetDay),
      idFactory,
    );
  }
}

function chooseEvent(
  store: TestStore,
  eventId: string,
  optionId: string,
  idFactory: () => string,
): void {
  const instance = store.getRawState().events.pending.find((item) => item.eventId === eventId);
  if (!instance) throw new Error(`Expected pending event ${eventId}`);
  store.dispatch({
    type: 'CHOOSE_EVENT_OPTION',
    eventInstanceId: instance.instanceId,
    optionId,
    _rng: () => 0.99,
    _idFactory: idFactory,
  });
}

function performDeputyWorkUntil(
  store: TestStore,
  targetDay: number,
  idFactory: () => string,
): void {
  const primaryActions = [
    ['admin_l2_0_dept_1', 'tax_collection'],
    ['admin_l2_0_dept_3', 'social_assistance'],
    ['admin_l2_0_dept_2', 'safety_inspection'],
    ['admin_l2_0_dept_0', 'township_priority_delivery'],
  ] as const;
  const secondaryActions = [
    ['admin_l2_0_dept_0', 'approve_project'],
    ['admin_l2_0_dept_0', 'urban_planning'],
    ['admin_l2_0_dept_1', 'budget_review'],
    ['admin_l2_0_dept_3', 'livelihood_survey'],
  ] as const;
  let week = 0;
  while (store.getRawState().time.totalDaysPlayed < targetDay) {
    for (let offset = 0; offset < primaryActions.length; offset++) {
      const action = primaryActions[(week + offset) % primaryActions.length];
      if (!action) continue;
      store.dispatch({
        type: 'START_ACTION',
        deptId: action[0],
        actionId: action[1],
        tierKey: 'primary',
        _idFactory: idFactory,
      });
    }
    for (let offset = 0; offset < secondaryActions.length; offset++) {
      const action = secondaryActions[(week + offset) % secondaryActions.length];
      if (!action) continue;
      store.dispatch({
        type: 'START_ACTION',
        deptId: action[0],
        actionId: action[1],
        tierKey: 'secondary',
        _idFactory: idFactory,
      });
    }
    advanceToDay(
      store,
      Math.min(store.getRawState().time.totalDaysPlayed + 7, targetDay),
      idFactory,
    );
    week++;
  }
}

function completeSelection(store: TestStore, opportunityId: string, idFactory: () => string): void {
  store.dispatch({
    type: 'ACCEPT_CAREER_OPPORTUNITY',
    opportunityId,
    _idFactory: idFactory,
  });
  for (let stage = 0; stage < 6; stage++)
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId,
      _rng: () => 0,
      _idFactory: idFactory,
    });
}

describe('Phase 3 reachability foundation', () => {
  it('reaches annual assessment and probation through public Store actions only', () => {
    const loader = getConfigLoader();
    const acceptance = loader.getPhase3AcceptanceConfig();
    const idFactory = createIdFactory();
    const store = createTestStore();
    createPhase3Game(store);

    const initial = store.getRawState();
    expect(initial.career.appointment.positionId).toBe(acceptance.stagePositionIds.clerk);
    const annualBudget = loader.getPositionById(
      initial.career.appointment.positionId,
    )?.annualBudget;
    expect(annualBudget).toBe(800);

    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_induction_training',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    expect(store.getRawState().remainingBudget).toBe(785);

    advanceToDay(store, 30, idFactory);
    expect(store.getRawState().remainingBudget).toBe(785);
    expect(
      Object.values(store.getRawState().actions.departmentStates).every(
        (department) =>
          department.monthlyConsumption === 0 && department.cumulativeConsumption === 0,
      ),
    ).toBe(true);

    advanceToDay(store, 180, idFactory);
    expect(store.getRawState().assessments.annualAssessments).toHaveLength(1);
    expect(store.getRawState().remainingBudget).toBe(annualBudget);
    expect(
      Object.values(store.getRawState().actions.departmentStates).every(
        (department) =>
          department.monthlyConsumption === 0 && department.cumulativeConsumption === 0,
      ),
    ).toBe(true);

    advanceToDay(store, acceptance.milestones.probationPassed.minDay, idFactory);
    expect(store.getRawState().career.appointment.probation).toMatchObject({
      status: 'passed',
      resolvedAtDay: acceptance.milestones.probationPassed.minDay,
      completedActionCount: 1,
    });
  });

  it('earns and consumes annual quotas at the locked rank milestones without changing appointment', () => {
    const loader = getConfigLoader();
    const acceptance = loader.getPhase3AcceptanceConfig();
    const idFactory = createIdFactory();
    const store = createTestStore();
    createPhase3Game(store);

    expect(store.getRawState().world.metrics['rank_quota.clerk_1']).toBe(0);
    expect(store.getRawState().world.metrics['rank_quota.section_member_4']).toBe(0);
    completeQualifiedClerkHalfYear(store, 180, idFactory);
    expect(store.getRawState().assessments.annualAssessments[0]?.tier).toMatch(/优秀|称职/);
    expect(store.getRawState().world.metrics['rank_quota.clerk_1']).toBe(1);

    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: idFactory });
    expect(store.getRawState().career.civilServiceRank).toBe('clerk_2');

    advanceToDay(store, acceptance.milestones.firstRankPromotion.minDay, idFactory);
    expect(store.getRawState().career.appointment.probation?.status).toBe('passed');
    const appointmentIdentity = structuredClone(store.getRawState().career.appointment);
    const openExperience = structuredClone(store.getRawState().career.experiences[0]);
    if (!openExperience) throw new Error('Expected open career experience');
    const { assessmentResults: priorAssessmentResults, ...experienceIdentity } = openExperience;
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: idFactory });
    expect(store.getRawState().career.civilServiceRank).toBe('clerk_1');
    expect(store.getRawState().world.metrics['rank_quota.clerk_1']).toBe(0);
    expect(store.getRawState().career.appointment).toEqual(appointmentIdentity);
    expect(store.getRawState().career.experiences[0]).toEqual(openExperience);

    advanceToDay(store, 540, idFactory);
    expect(store.getRawState().world.metrics['rank_quota.section_member_4']).toBe(1);
    advanceToDay(store, acceptance.milestones.sectionMember4Promotion.minDay, idFactory);
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: idFactory });
    expect(store.getRawState().career.civilServiceRank).toBe('section_member_4');
    expect(store.getRawState().world.metrics['rank_quota.section_member_4']).toBe(0);
    expect(store.getRawState().career.appointment).toEqual(appointmentIdentity);
    expect(store.getRawState().career.experiences[0]).toMatchObject(experienceIdentity);
    expect(store.getRawState().career.experiences[0]?.assessmentResults).toHaveLength(
      priorAssessmentResults.length + 2,
    );
    expect(store.getRawState().career.civilServiceRankHistory).toHaveLength(2);
    expect(store.getRawState().time.totalDaysPlayed).toBe(
      acceptance.milestones.sectionMember4Promotion.minDay,
    );
  });

  it('reaches township deputy appointment through tasks, assessments and Store actions only', () => {
    const loader = getConfigLoader();
    const acceptance = loader.getPhase3AcceptanceConfig();
    const idFactory = createIdFactory();
    const store = createTestStore();
    createPhase3Game(store);

    completeQualifiedClerkHalfYear(store, 180, idFactory);
    advanceToDay(store, acceptance.milestones.firstRankPromotion.minDay, idFactory);
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: idFactory });
    expect(store.getRawState().career.civilServiceRank).toBe('clerk_1');

    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_assigned_special',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    advanceToDay(store, 390, idFactory);
    expect(store.getRawState().world.facts.assigned_project_delivered).toBe(true);
    completeQualifiedClerkHalfYear(store, 540, idFactory);

    const opportunity = store
      .getRawState()
      .career.opportunities.find(
        (item) => item.definitionId === 'township_deputy_leadership_vacancy',
      );
    expect(opportunity).toMatchObject({
      status: 'available',
      appearedAtDay: 540,
      expiresAtDay: 810,
    });
    if (!opportunity) throw new Error('Expected deputy opportunity');

    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: idFactory,
    });
    expect(store.getRawState().career.activeProcess).toBeNull();
    expect(store.getRawState().career.opportunities.at(-1)?.status).toBe('available');

    advanceToDay(store, acceptance.milestones.townshipDeputyAppointment.minDay, idFactory);
    const previousAppointment = structuredClone(store.getRawState().career.appointment);
    const previousRank = store.getRawState().career.civilServiceRank;
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: idFactory,
    });
    for (let step = 0; step < 6; step++)
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _idFactory: idFactory,
        _rng: () => 0,
      });

    const result = store.getRawState();
    expect(result.career.appointment).toMatchObject({
      positionId: acceptance.stagePositionIds.townshipDeputy,
      leadershipRank: 'township_deputy',
      startedAtDay: acceptance.milestones.townshipDeputyAppointment.minDay,
    });
    expect(result.career.appointment.appointmentId).not.toBe(previousAppointment.appointmentId);
    expect(result.career.civilServiceRank).toBe(previousRank);
    expect(result.career.experiences.filter((item) => item.endedAtDay === null)).toHaveLength(1);
    expect(
      result.career.experiences.find(
        (item) => item.appointmentId === previousAppointment.appointmentId,
      )?.endedAtDay,
    ).toBe(acceptance.milestones.townshipDeputyAppointment.minDay);
    expect(Object.keys(result.actions.departmentStates)).toEqual(
      loader
        .resolvePositionDepartments(acceptance.stagePositionIds.townshipDeputy)
        .map((item) => item.id),
    );
    expect(result.remainingBudget).toBe(
      loader.getPositionById(acceptance.stagePositionIds.townshipDeputy)?.annualBudget,
    );
    expect(
      result.career.opportunities.find((item) => item.id === opportunity.id)?.finalOutcome,
    ).toBe('appointed');

    const reservePenalty = loader.getGameConfig().reservePenalty;
    const vigorBefore = result.character.vigor;
    const ambitionBefore = result.character.ambition;
    const totalActionsBefore = result.actions.totalActions;
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'secondary',
      _idFactory: idFactory,
    });
    expect(store.getRawState().actions.totalActions).toBe(totalActionsBefore);
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_1',
      actionId: 'tax_collection',
      tierKey: 'reserve',
      _idFactory: idFactory,
    });
    expect(store.getRawState().remainingBudget).toBe(5820);
    expect(store.getRawState().character.vigor).toBe(vigorBefore + reservePenalty.vigor);
    expect(store.getRawState().character.ambition).toBe(ambitionBefore + reservePenalty.ambition);
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    expect(store.getRawState().actions.totalActions).toBe(totalActionsBefore + 2);
    advanceToDay(store, 727, idFactory);
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    expect(store.getRawState().actions.totalActions).toBe(totalActionsBefore + 2);
  });

  it('runs the complete four-year clerk-to-chief path through Store dispatch only', () => {
    const loader = getConfigLoader();
    const acceptance = loader.getPhase3AcceptanceConfig();
    const days = acceptance.deterministicScenarioDays;
    const idFactory = createIdFactory();
    const store = createTestStore();
    createPhase3Game(store);

    completeQualifiedClerkHalfYear(store, 180, idFactory);
    advanceToDay(store, days.firstRankPromotion, idFactory);
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: idFactory });
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_assigned_special',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    advanceToDay(store, 390, idFactory);
    completeQualifiedClerkHalfYear(store, days.townshipDeputyOpportunity, idFactory);
    const deputyOpportunity = store
      .getRawState()
      .career.opportunities.find(
        (item) => item.definitionId === 'township_deputy_leadership_vacancy',
      );
    if (!deputyOpportunity) throw new Error('Expected naturally produced deputy opportunity');
    expect(deputyOpportunity.appearedAtDay).toBe(days.townshipDeputyOpportunity);

    advanceToDay(store, days.townshipDeputyAppointment, idFactory);
    completeSelection(store, deputyOpportunity.id, idFactory);
    expect(store.getRawState().career.appointment.positionId).toBe(
      acceptance.stagePositionIds.townshipDeputy,
    );

    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_2',
      actionId: 'flood_preparation',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    advanceToDay(store, 727, idFactory);
    chooseEvent(store, 'industrial_park_policy_proposal', 'submit_proposal', idFactory);
    store.dispatch({
      type: 'PROPOSE_POLICY',
      policyId: 'industrial_park_support',
      _idFactory: idFactory,
    });
    const policy = store
      .getRawState()
      .governance.policies.find((item) => item.policyId === 'industrial_park_support');
    if (!policy) throw new Error('Expected naturally proposed industrial park policy');
    store.dispatch({
      type: 'APPROVE_POLICY',
      policyInstanceId: policy.instanceId,
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
    advanceToDay(store, 800, idFactory);
    const governanceEvidenceDay = Math.max(
      ...store
        .getRawState()
        .events.history.filter((record) =>
          ['flood_preparation_metrics', 'industrial_park_progress_crisis'].includes(record.eventId),
        )
        .map((record) => record.completedAtDay),
    );
    expect(governanceEvidenceDay).toBe(days.townshipDeputyGovernance);

    performDeputyWorkUntil(store, 900, idFactory);
    expect(store.getRawState().assessments.annualAssessments.at(-1)?.tier).toMatch(/优秀|称职/);
    performDeputyWorkUntil(store, days.sectionMember4Promotion, idFactory);
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: idFactory });
    expect(store.getRawState().career.civilServiceRank).toBe('section_member_4');
    performDeputyWorkUntil(store, days.townshipChiefOpportunity, idFactory);

    const chiefOpportunity = store
      .getRawState()
      .career.opportunities.find(
        (item) => item.definitionId === 'township_chief_leadership_vacancy',
      );
    if (!chiefOpportunity) throw new Error('Expected naturally produced chief opportunity');
    expect(chiefOpportunity).toMatchObject({
      status: 'available',
      appearedAtDay: days.townshipChiefOpportunity,
      expiresAtDay: acceptance.milestones.townshipChiefAppointment.maxDay,
    });
    expect(store.getRawState().remainingBudget).toBeGreaterThanOrEqual(0);

    advanceToDay(store, days.townshipChiefAppointment, idFactory);
    const rankBefore = store.getRawState().career.civilServiceRank;
    completeSelection(store, chiefOpportunity.id, idFactory);
    const completed = store.getRawState();
    expect(completed.career.appointment).toMatchObject({
      positionId: acceptance.stagePositionIds.townshipChief,
      leadershipRank: 'township_chief',
      startedAtDay: days.townshipChiefAppointment,
    });
    expect(completed.career.civilServiceRank).toBe(rankBefore);
    expect(completed.remainingBudget).toBe(7500);
    expect(completed.career.experiences.filter((item) => item.endedAtDay === null)).toHaveLength(1);
  });
});
