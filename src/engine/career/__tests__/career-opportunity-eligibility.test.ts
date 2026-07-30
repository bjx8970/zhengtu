/** 职业机会共享资格判定测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import type { TrainingCareerOpportunity } from '../../../domain/career/state';
import { createInitialState } from '../../../store/game-store';
import {
  evaluateCareerOpportunityAcceptanceEligibility,
  hasRunningCareerAction,
} from '../career-opportunity-eligibility';

function createTrainingOpportunity(): TrainingCareerOpportunity {
  return {
    id: 'training-opportunity',
    definitionId: 'training-definition',
    type: 'training',
    status: 'available',
    source: { sourceType: 'assessment', sourceId: 'assessment-1', signalId: null, description: '' },
    sourceSignal: null,
    target: null,
    appointmentType: null,
    appointmentReason: null,
    trainingDefinitionId: 'training-1',
    effects: [],
    appearedAtDay: 0,
    expiresAtDay: null,
    acceptedAtDay: null,
    rejectedAtDay: null,
    resolvedAtDay: null,
    cancelledAtDay: null,
    requiresSelection: false,
    eligibilityConditions: [],
    finalOutcome: null,
    reason: '',
  };
}

function evaluateTrainingOpportunity(state = createInitialState()) {
  const loader = getConfigLoader();
  const config = loader.getGameConfig();
  return evaluateCareerOpportunityAcceptanceEligibility({
    opportunity: createTrainingOpportunity(),
    state,
    currentDay: 360,
    daysPerYear: config.daysPerMonth * config.monthsPerYear,
    targetPosition: null,
    careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
  });
}

describe('career opportunity eligibility', () => {
  it('passes injected experience qualification rules to opportunity conditions', () => {
    const state = createInitialState();
    state.career.appointment.startedAtDay = 0;
    const opportunity = createTrainingOpportunity();
    opportunity.eligibilityConditions = [
      { experience: 'has_region', op: 'eq', value: state.career.appointment.regionId },
    ];
    const loader = getConfigLoader();
    const config = loader.getGameConfig();

    const result = evaluateCareerOpportunityAcceptanceEligibility({
      opportunity,
      state,
      currentDay: 360,
      daysPerYear: config.daysPerMonth * config.monthsPerYear,
      targetPosition: null,
      careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
    });

    expect(result).toEqual({ eligible: true, failure: null });
  });

  it('reports every global acceptance guard before accepting an opportunity', () => {
    const state = createInitialState();
    state.career.activeProcess = {
      id: 'process-1',
      type: 'training',
      status: 'active',
      opportunityId: 'other-opportunity',
      currentStage: 'eligibility_review',
      startedAtDay: 0,
      completedAtDay: null,
      stageResults: [],
    };
    expect(evaluateTrainingOpportunity(state).failure).toBe('active_process');

    state.career.activeProcess = null;
    state.events.activeBlockingEventId = 'event-1';
    expect(evaluateTrainingOpportunity(state).failure).toBe('blocking_event');

    state.events.activeBlockingEventId = null;
    state.time.pendingContinuation = {
      absoluteDay: 0,
      remainingNodes: [{ type: 'event_deadline', absoluteDay: 0 }],
    };
    expect(evaluateTrainingOpportunity(state).failure).toBe('pending_continuation');
  });

  it('detects running actions from every slot tier', () => {
    const state = createInitialState();
    expect(hasRunningCareerAction(state)).toBe(false);
    state.actions.slots.reserve.occupants[0] = {
      instanceId: 'action-1',
      actionId: 'action',
      deptId: 'dept',
      actionName: 'action',
      originPositionId: 'position',
      originInstitutionId: 'institution',
      originRegionId: 'region',
      category: 'routine',
      startedAtDay: 0,
      durationDays: 1,
      cooldownDays: 0,
      executableSnapshot: {
        contentVersion: 'test',
        department: { id: 'dept', name: 'dept' },
        action: {
          id: 'action',
          name: 'action',
          durationDays: 1,
          category: 'routine',
          cooldownDays: 0,
          budgetDelta: 0,
          effects: [],
        },
        attributeBounds: {},
      },
    };
    expect(hasRunningCareerAction(state)).toBe(true);
  });
});
