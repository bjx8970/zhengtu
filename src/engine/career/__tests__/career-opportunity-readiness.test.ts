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

  it('diagnoses township chief governance evidence separately from two-year acceptance', () => {
    const loader = getConfigLoader();
    const definition = loader
      .getAllCareerOpportunityDefinitions()
      .find((item) => item.id === 'township_chief_leadership_vacancy');
    if (!definition) throw new Error('Expected township chief definition');
    const state = createInitialState();
    state.career.appointment.leadershipRank = 'township_deputy';
    state.career.appointment.startedAtDay = 720;
    const experience = state.career.experiences[0];
    if (!experience) throw new Error('Expected initial career experience');
    experience.leadershipRank = 'township_deputy';
    experience.startedAtDay = 720;
    experience.assessmentResults = [
      { year: 2014, score: 80, tier: '称职' },
      { year: 2015, score: 82, tier: '称职' },
    ];
    state.assessments.annualAssessments.push({ year: 2015, score: 82, tier: '称职' });
    state.events.history.push(
      {
        eventId: 'flood_preparation_metrics',
        instanceId: 'flood',
        finalStatus: 'resolved',
        triggeredAtDay: 900,
        completedAtDay: 900,
        sourceKey: 'flood',
        chainInstanceId: null,
        titleSnapshot: '防汛',
        chosenOptionId: null,
        chosenOptionLabel: null,
        appliedEffects: [],
      },
      {
        eventId: 'industrial_park_progress_crisis',
        instanceId: 'park',
        finalStatus: 'resolved',
        triggeredAtDay: 1080,
        completedAtDay: 1080,
        sourceKey: 'park',
        chainInstanceId: null,
        titleSnapshot: '产业园',
        chosenOptionId: null,
        chosenOptionLabel: null,
        appliedEffects: [],
      },
    );

    const beforeTenure = evaluateCareerOpportunityDefinitionReadiness({
      definition,
      state,
      currentDay: 1260,
      daysPerYear: 360,
      careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
    });
    expect(beforeTenure.readyToGenerate).toBe(true);
    expect(beforeTenure.readyToAccept).toBe(false);
    expect(beforeTenure.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'generation', detail: '事件经历 防汛准备度量：occurred' }),
        expect.objectContaining({
          phase: 'acceptance',
          satisfied: false,
          detail: '当前任职年限不少于 2 年',
        }),
      ]),
    );

    expect(
      evaluateCareerOpportunityDefinitionReadiness({
        definition,
        state,
        currentDay: 1440,
        daysPerYear: 360,
        careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
      }).readyToAccept,
    ).toBe(true);
  });
});
