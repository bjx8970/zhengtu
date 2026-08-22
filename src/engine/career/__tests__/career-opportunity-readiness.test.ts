/** 配置驱动的职业机会准备度诊断测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import { createInitialState } from '../../../store/game-store';
import { evaluateCareerOpportunityDefinitionReadiness } from '../career-opportunity-readiness';

describe('career opportunity definition readiness', () => {
  it('uses changed definition thresholds for both result and diagnostic text', () => {
    const loader = getConfigLoader();
    const definition = loader
      .getAllCareerOpportunityDefinitions()
      .find((item) => item.id === 'township_deputy_leadership_vacancy');
    if (!definition) throw new Error('Expected deputy definition');
    const scoreCondition = definition.conditions.find(
      (condition) => 'signalField' in condition && condition.signalField === 'score',
    );
    if (!scoreCondition || !('signalField' in scoreCondition))
      throw new Error('Expected score condition');
    scoreCondition.value = 101;
    const state = createInitialState();
    state.assessments.annualAssessments.push({ year: 2027, score: 100, tier: '优秀' });
    const result = evaluateCareerOpportunityDefinitionReadiness({
      definition,
      state,
      currentDay: 720,
      daysPerYear: 360,
      careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
    });
    const diagnostic = result.items.find(
      (item) => 'signalField' in item.condition && item.condition.signalField === 'score',
    );
    expect(diagnostic).toMatchObject({ satisfied: false });
    expect(diagnostic?.detail).toContain('101');
  });
});
