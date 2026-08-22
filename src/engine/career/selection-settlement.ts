/**
 * Pure settlement for each appointment-selection stage.
 *
 * The store only asks to advance a process; this module derives its outcome
 * from the player state, configured promotion thresholds, and injected RNG.
 */

import type { CareerProcessStage } from '../../domain/career/state';
import type { PlayerSave } from '../../types/player';
import type { PromotionConfig } from '../../types/config';
import type { CareerSelectionSettlement } from '../../types/career';

function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function capabilityScore(state: Readonly<PlayerSave>, rng: () => number): number {
  const character = state.character;
  const baseline =
    (character.competence + character.diligence + character.integrity + character.charisma) / 4;
  // A bounded variance keeps the result reproducible through injected RNG while
  // allowing strong player attributes to matter more than a single roll.
  return boundedScore((baseline + 50) / 2 + (1 - rng()) * 20);
}

/**
 * Settles one career-selection stage without mutating game state.
 *
 * @param stage current selection stage
 * @param state current player state
 * @param promotion configured promotion thresholds
 * @param rng injected random source
 * @returns derived stage outcome, score, and audit detail
 */
export function settleCareerSelectionStage(
  stage: CareerProcessStage,
  state: Readonly<PlayerSave>,
  promotion: PromotionConfig,
  rng: () => number,
): CareerSelectionSettlement {
  switch (stage) {
    case 'eligibility_review':
      return { outcome: 'passed', score: null, detail: '资格复查通过' };
    case 'democratic_recommendation': {
      const score = capabilityScore(state, rng) + Math.min(state.character.network, 20);
      return score >= promotion.democraticVote.passThreshold
        ? {
            outcome: 'passed',
            score: boundedScore(score),
            detail: '民主推荐通过',
          }
        : {
            outcome: 'failed',
            score: boundedScore(score),
            detail: '民主推荐未通过',
          };
    }
    case 'organization_inspection': {
      const score = capabilityScore(state, rng);
      if (score >= promotion.orgInspection.qualifiedThreshold)
        return { outcome: 'passed', score, detail: '组织考察合格' };
      if (score >= promotion.orgInspection.suspendedThreshold)
        return {
          outcome: 'continued',
          score,
          detail: '组织考察转为继续观察',
        };
      return { outcome: 'failed', score, detail: '组织考察未通过' };
    }
    case 'collective_decision': {
      const passed =
        state.character.corruptionRisk < promotion.jointReview.disciplineCorruptionThreshold &&
        rng() <= promotion.jointReview.otherDepartmentsPassRate;
      return {
        outcome: passed ? 'passed' : 'failed',
        score: null,
        detail: passed ? '集体决定通过' : '集体决定未通过',
      };
    }
    case 'public_notice': {
      const complaintRisk =
        state.character.corruptionRisk *
        (promotion.publicNotice.complaintProbPerRisk + promotion.publicNotice.sentimentProbPerRisk);
      const passed = rng() >= complaintRisk;
      return {
        outcome: passed ? 'passed' : 'failed',
        score: null,
        detail: passed ? '公示完成' : '公示期间出现影响任职的举报',
      };
    }
    case 'appointment':
      return {
        outcome: 'passed',
        score: null,
        detail: '任职提交最终复核',
      };
    default:
      return { outcome: 'passed', score: null, detail: '职业流程阶段已完成' };
  }
}
