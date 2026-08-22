/** 职业机会生成和生命周期的核心规则测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import type { CareerOpportunityDefinition } from '../../../types/config';
import { createInitialState } from '../../../store/game-store';
import { expireCareerOpportunity } from '../career-opportunity-lifecycle';
import { processCareerOpportunitySignal } from '../opportunity-orchestrator';
import { evaluateCareerOpportunityAcceptanceEligibility } from '../career-opportunity-eligibility';

describe('career opportunity orchestrator', () => {
  const assessmentTrainingDefinition: CareerOpportunityDefinition = {
    id: 'assessment-training',
    type: 'training',
    triggerSignals: ['assessment.completed'],
    conditions: [],
    expiresAfterDays: 30,
    repeatPolicy: 'once_per_source',
    cooldownDays: 0,
    requiresSelection: false,
    reasonTemplate: 'test',
    targetPositionId: null,
    trainingDefinitionId: 'training-1',
    effects: [],
  };

  it('creates an assessment opportunity once per source signal', () => {
    const state = createInitialState();
    const loader = getConfigLoader();
    const signal = {
      signalId: 'assessment-1',
      signalType: 'assessment.completed' as const,
      occurredAtDay: 360,
      data: { year: 2027, score: 90, tier: '优秀' },
    };
    const first = processCareerOpportunitySignal({
      state,
      signal,
      currentDay: 360,
      idFactory: () => 'opportunity-1',
      definitions: [assessmentTrainingDefinition],
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    });
    expect(first.created).toHaveLength(1);
    expect(first.created[0]?.sourceSignal).toEqual(signal);
    state.career.opportunities.push(...first.created);
    const replay = processCareerOpportunitySignal({
      state,
      signal,
      currentDay: 360,
      idFactory: () => 'opportunity-2',
      definitions: [assessmentTrainingDefinition],
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    });
    expect(replay.created).toHaveLength(0);
    expect(replay.skipped[0]?.reason).toBe('duplicate');
  });

  it('expires only an available opportunity at its deadline', () => {
    const state = createInitialState();
    const loader = getConfigLoader();
    const signal = {
      signalId: 'assessment-2',
      signalType: 'assessment.completed' as const,
      occurredAtDay: 1,
      data: { year: 2026, score: 80, tier: '称职' },
    };
    const opportunity = processCareerOpportunitySignal({
      state,
      signal,
      currentDay: 1,
      idFactory: () => 'opportunity-3',
      definitions: [assessmentTrainingDefinition],
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    }).created[0]!;
    expect(expireCareerOpportunity(opportunity, 30).success).toBe(false);
    expect(expireCareerOpportunity(opportunity, 31).opportunity?.status).toBe('expired');
  });

  it('creates the official deputy window only after durable prerequisites and defers service tenure to acceptance', () => {
    const state = createInitialState();
    const loader = getConfigLoader();
    if (!state.career.appointment.probation) throw new Error('Expected probation');
    state.career.appointment.probation.status = 'passed';
    state.career.civilServiceRank = 'clerk_1';
    state.world.facts.assigned_project_delivered = true;
    state.assessments.annualAssessments.push(
      { year: 2026, score: 70, tier: '称职' },
      { year: 2027, score: 80, tier: '称职' },
    );
    const signal = {
      signalId: 'assessment-2027',
      signalType: 'assessment.completed' as const,
      occurredAtDay: 540,
      data: { year: 2027, score: 80, tier: '称职' },
    };
    const result = processCareerOpportunitySignal({
      state,
      signal,
      currentDay: 540,
      idFactory: () => 'deputy-window',
      definitions: loader
        .getCareerOpportunityDefinitionsBySignal(signal.signalType)
        .filter((item) => item.id === 'township_deputy_leadership_vacancy'),
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    });
    expect(result.created).toHaveLength(1);
    const opportunity = result.created[0];
    if (!opportunity) throw new Error('Expected deputy opportunity');
    const evaluateAt = (currentDay: number) =>
      evaluateCareerOpportunityAcceptanceEligibility({
        opportunity,
        state,
        currentDay,
        daysPerYear: 360,
        targetPosition:
          opportunity.type === 'training'
            ? null
            : loader.getPositionById(opportunity.target.positionId),
        careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
      });
    expect(evaluateAt(540).failure).toBe('opportunity_conditions');
    expect(evaluateAt(720)).toEqual({ eligible: true, failure: null });

    state.career.opportunities.push({
      ...opportunity,
      status: 'rejected',
      rejectedAtDay: 541,
    });
    const replay = processCareerOpportunitySignal({
      state,
      signal: { ...signal, signalId: 'assessment-2027-replay' },
      currentDay: 541,
      idFactory: () => 'duplicate-deputy-window',
      definitions: loader
        .getCareerOpportunityDefinitionsBySignal(signal.signalType)
        .filter((item) => item.id === 'township_deputy_leadership_vacancy'),
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    });
    expect(replay.created).toHaveLength(0);
    expect(replay.skipped[0]?.reason).toBe('duplicate');
    const nextYear = processCareerOpportunitySignal({
      state,
      signal: {
        ...signal,
        signalId: 'assessment-2028',
        occurredAtDay: 900,
        data: { ...signal.data, year: 2028 },
      },
      currentDay: 900,
      idFactory: () => 'next-deputy-window',
      definitions: loader
        .getCareerOpportunityDefinitionsBySignal(signal.signalType)
        .filter((item) => item.id === 'township_deputy_leadership_vacancy'),
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    });
    expect(nextYear.created).toHaveLength(1);
  });

  it('uses a stable assessment source and preserves once-per-source history after rejection', () => {
    const state = createInitialState();
    const definition: CareerOpportunityDefinition = {
      id: 'training-on-assessment',
      type: 'training',
      triggerSignals: ['assessment.completed'],
      conditions: [],
      expiresAfterDays: null,
      repeatPolicy: 'once_per_source',
      cooldownDays: 0,
      requiresSelection: false,
      reasonTemplate: '',
      targetPositionId: null,
      trainingDefinitionId: 'training-1',
      effects: [],
    };
    const firstSignal = {
      signalId: 'assessment-delivery-1',
      signalType: 'assessment.completed' as const,
      occurredAtDay: 360,
      data: { year: 2027, score: 90, tier: '优秀' },
    };
    const first = processCareerOpportunitySignal({
      state,
      signal: firstSignal,
      currentDay: 360,
      idFactory: () => 'training-opportunity-1',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    expect(first.created[0]?.source.sourceId).toBe('assessment:2027');
    const firstOpportunity = first.created[0];
    if (!firstOpportunity) throw new Error('Expected first opportunity');
    state.career.opportunities.push({
      ...firstOpportunity,
      status: 'rejected',
      rejectedAtDay: 361,
    });

    const replay = processCareerOpportunitySignal({
      state,
      signal: {
        ...firstSignal,
        signalId: 'assessment-delivery-2',
        data: { ...firstSignal.data, tier: '称职' },
      },
      currentDay: 361,
      idFactory: () => 'training-opportunity-2',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    expect(replay.created).toHaveLength(0);
    expect(replay.skipped[0]?.reason).toBe('duplicate');

    const nextYear = processCareerOpportunitySignal({
      state,
      signal: {
        ...firstSignal,
        signalId: 'assessment-delivery-3',
        data: { ...firstSignal.data, year: 2028 },
      },
      currentDay: 720,
      idFactory: () => 'training-opportunity-3',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    expect(nextYear.created).toHaveLength(1);
  });

  it('enforces repeatable cooldown through terminal opportunity history', () => {
    const state = createInitialState();
    const definition: CareerOpportunityDefinition = {
      id: 'repeatable-training',
      type: 'training',
      triggerSignals: ['assessment.completed'],
      conditions: [],
      expiresAfterDays: null,
      repeatPolicy: 'repeatable',
      cooldownDays: 10,
      requiresSelection: false,
      reasonTemplate: '',
      targetPositionId: null,
      trainingDefinitionId: 'training-1',
      effects: [],
    };
    const signal = {
      signalId: 'assessment-repeat-1',
      signalType: 'assessment.completed' as const,
      occurredAtDay: 10,
      data: { year: 2027, score: 90, tier: '优秀' },
    };
    const first = processCareerOpportunitySignal({
      state,
      signal,
      currentDay: 10,
      idFactory: () => 'repeatable-opportunity-1',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    const firstOpportunity = first.created[0];
    if (!firstOpportunity) throw new Error('Expected first opportunity');
    state.career.opportunities.push({
      ...firstOpportunity,
      status: 'rejected',
      rejectedAtDay: 11,
    });
    const blocked = processCareerOpportunitySignal({
      state,
      signal: { ...signal, signalId: 'assessment-repeat-2', occurredAtDay: 19 },
      currentDay: 19,
      idFactory: () => 'repeatable-opportunity-2',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    expect(blocked.created).toHaveLength(0);
    expect(blocked.skipped[0]?.reason).toBe('cooldown');
    const boundary = processCareerOpportunitySignal({
      state,
      signal: { ...signal, signalId: 'assessment-repeat-3', occurredAtDay: 20 },
      currentDay: 20,
      idFactory: () => 'repeatable-opportunity-3',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    expect(boundary.created).toHaveLength(1);
  });

  it('allows repeatable zero-cooldown history but never concurrent opportunities', () => {
    const state = createInitialState();
    const definition: CareerOpportunityDefinition = {
      id: 'repeatable-zero-cooldown-training',
      type: 'training',
      triggerSignals: ['action.completed'],
      conditions: [],
      expiresAfterDays: null,
      repeatPolicy: 'repeatable',
      cooldownDays: 0,
      requiresSelection: false,
      reasonTemplate: '',
      targetPositionId: null,
      trainingDefinitionId: 'training-1',
      effects: [],
    };
    const firstSignal = {
      signalId: 'action-delivery-1',
      signalType: 'action.completed' as const,
      occurredAtDay: 10,
      data: {
        actionInstanceId: 'action-1',
        actionId: 'action-definition-1',
        deptId: 'dept-1',
        regionId: 'region-1',
        institutionId: 'institution-1',
      },
    };
    const first = processCareerOpportunitySignal({
      state,
      signal: firstSignal,
      currentDay: 10,
      idFactory: () => 'repeatable-zero-cooldown-1',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    const firstOpportunity = first.created[0];
    if (!firstOpportunity) throw new Error('Expected first opportunity');
    state.career.opportunities.push(firstOpportunity);

    const concurrent = processCareerOpportunitySignal({
      state,
      signal: {
        ...firstSignal,
        signalId: 'action-delivery-2',
        data: { ...firstSignal.data, actionInstanceId: 'action-2' },
      },
      currentDay: 10,
      idFactory: () => 'repeatable-zero-cooldown-2',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    expect(concurrent.created).toHaveLength(0);
    expect(concurrent.skipped[0]?.reason).toBe('duplicate');

    state.career.opportunities[0] = {
      ...firstOpportunity,
      status: 'rejected',
      rejectedAtDay: 10,
    };
    const afterTerminal = processCareerOpportunitySignal({
      state,
      signal: {
        ...firstSignal,
        signalId: 'action-delivery-3',
        data: { ...firstSignal.data, actionInstanceId: 'action-3' },
      },
      currentDay: 10,
      idFactory: () => 'repeatable-zero-cooldown-3',
      definitions: [definition],
      positions: [],
      institutions: [],
      daysPerYear: 360,
    });
    expect(afterTerminal.created).toHaveLength(1);
  });

  it('blocks every repeat policy while its prior opportunity is in process', () => {
    for (const repeatPolicy of ['once', 'once_per_source', 'repeatable'] as const) {
      const state = createInitialState();
      const definition: CareerOpportunityDefinition = {
        id: `in-process-${repeatPolicy}-training`,
        type: 'training',
        triggerSignals: ['action.completed'],
        conditions: [],
        expiresAfterDays: null,
        repeatPolicy,
        cooldownDays: 0,
        requiresSelection: false,
        reasonTemplate: '',
        targetPositionId: null,
        trainingDefinitionId: 'training-1',
        effects: [],
      };
      const signal = {
        signalId: `in-process-${repeatPolicy}-1`,
        signalType: 'action.completed' as const,
        occurredAtDay: 10,
        data: {
          actionInstanceId: 'action-1',
          actionId: 'action-definition-1',
          deptId: 'dept-1',
          regionId: 'region-1',
          institutionId: 'institution-1',
        },
      };
      const first = processCareerOpportunitySignal({
        state,
        signal,
        currentDay: 10,
        idFactory: () => `in-process-${repeatPolicy}-1`,
        definitions: [definition],
        positions: [],
        institutions: [],
        daysPerYear: 360,
      });
      const firstOpportunity = first.created[0];
      if (!firstOpportunity) throw new Error('Expected first opportunity');
      state.career.opportunities.push({
        ...firstOpportunity,
        status: 'in_process',
        acceptedAtDay: 10,
      });

      const result = processCareerOpportunitySignal({
        state,
        signal: {
          ...signal,
          signalId: `in-process-${repeatPolicy}-2`,
          data: { ...signal.data, actionInstanceId: 'action-2' },
        },
        currentDay: 10,
        idFactory: () => `in-process-${repeatPolicy}-2`,
        definitions: [definition],
        positions: [],
        institutions: [],
        daysPerYear: 360,
      });
      expect(result.created).toHaveLength(0);
      expect(result.skipped[0]?.reason).toBe('duplicate');
    }
  });
});
