/** 职业机会接受、选拔和原子任职事务集成测试。 */

import { describe, expect, it, vi } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';
import type {
  AppointmentCareerOpportunity,
  TrainingCareerOpportunity,
} from '../../domain/career/state';
import * as effectExecutor from '../../engine/events/effect-executor';

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
  it('settles a leadership appointment without changing civil-service rank', () => {
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
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
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
    expect(state.career.experiences[0]?.endedAtDay).toBe(0);
    expect(state.career.opportunities[0]?.finalOutcome).toBe('appointed');
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

  it('does not advance an appointment selection while a blocking event is active', () => {
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
    const before = structuredClone(blockedStore.getRawState());

    expect(() =>
      blockedStore.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _idFactory: () => 'unused-id',
      }),
    ).not.toThrow();
    expect(blockedStore.getRawState()).toEqual(before);
  });

  it('passes the latest annual assessment tier to training effects', () => {
    const initial = createInitialState();
    const opportunity = createTrainingOpportunity();
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
      signalType: 'assessment.completed',
      data: { year: 2027, score: 90, tier: '优秀' },
    });
    expect(store.getRawState().assessments.comprehensiveScore).toBe(1);
    applyEffectsSpy.mockRestore();
  });
});
