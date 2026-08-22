/** 职业选拔各阶段纯结算规则测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import { createInitialState } from '../../../store/game-store';
import { settleCareerSelectionStage } from '../selection-settlement';

describe('career selection settlement', () => {
  const promotion = getConfigLoader().getGameConfig().promotion;

  it('通过资格复查与任职提交阶段', () => {
    const state = createInitialState();
    expect(
      settleCareerSelectionStage('eligibility_review', state, promotion, () => 1),
    ).toMatchObject({ outcome: 'passed', score: null });
    expect(settleCareerSelectionStage('appointment', state, promotion, () => 1)).toMatchObject({
      outcome: 'passed',
      score: null,
    });
  });

  it('民主推荐支持通过与落选', () => {
    const strong = createInitialState();
    strong.character.network = 20;
    expect(
      settleCareerSelectionStage('democratic_recommendation', strong, promotion, () => 0).outcome,
    ).toBe('passed');
    const weak = createInitialState();
    weak.character.competence = 0;
    weak.character.diligence = 0;
    weak.character.integrity = 0;
    weak.character.charisma = 0;
    weak.character.network = 0;
    expect(
      settleCareerSelectionStage('democratic_recommendation', weak, promotion, () => 1).outcome,
    ).toBe('failed');
  });

  it('组织考察区分合格、继续观察与落选', () => {
    const state = createInitialState();
    for (const field of ['competence', 'diligence', 'integrity', 'charisma'] as const)
      state.character[field] = 100;
    expect(
      settleCareerSelectionStage('organization_inspection', state, promotion, () => 0).outcome,
    ).toBe('passed');
    for (const field of ['competence', 'diligence', 'integrity', 'charisma'] as const)
      state.character[field] = 40;
    expect(
      settleCareerSelectionStage('organization_inspection', state, promotion, () => 1).outcome,
    ).toBe('continued');
    for (const field of ['competence', 'diligence', 'integrity', 'charisma'] as const)
      state.character[field] = 0;
    expect(
      settleCareerSelectionStage('organization_inspection', state, promotion, () => 1).outcome,
    ).toBe('failed');
  });

  it('集体决定与公示均覆盖成功和失败', () => {
    const state = createInitialState();
    expect(
      settleCareerSelectionStage('collective_decision', state, promotion, () => 0).outcome,
    ).toBe('passed');
    expect(
      settleCareerSelectionStage('collective_decision', state, promotion, () => 1).outcome,
    ).toBe('failed');
    state.character.corruptionRisk = 100;
    expect(settleCareerSelectionStage('public_notice', state, promotion, () => 0).outcome).toBe(
      'failed',
    );
    expect(settleCareerSelectionStage('public_notice', state, promotion, () => 1).outcome).toBe(
      'passed',
    );
  });
});
