/** 职业机会生成和生命周期的核心规则测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
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
});
