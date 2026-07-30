/** 职业机会生成和生命周期的核心规则测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import type { CareerOpportunityDefinition } from '../../../types/config';
import { createInitialState } from '../../../store/game-store';
import { expireCareerOpportunity } from '../career-opportunity-lifecycle';
import { processCareerOpportunitySignal } from '../opportunity-orchestrator';

describe('career opportunity orchestrator', () => {
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
      definitions: loader.getCareerOpportunityDefinitionsBySignal(signal.signalType),
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    });
    expect(first.created).toHaveLength(1);
    state.career.opportunities.push(...first.created);
    const replay = processCareerOpportunitySignal({
      state,
      signal,
      currentDay: 360,
      idFactory: () => 'opportunity-2',
      definitions: loader.getCareerOpportunityDefinitionsBySignal(signal.signalType),
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
      definitions: loader.getCareerOpportunityDefinitionsBySignal(signal.signalType),
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
      daysPerYear: 360,
    }).created[0]!;
    expect(expireCareerOpportunity(opportunity, 30).success).toBe(false);
    expect(expireCareerOpportunity(opportunity, 31).opportunity?.status).toBe('expired');
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
});
