/**
 * Pure settlement for each appointment-selection stage.
 *
 * The store only asks to advance a process; this module derives its outcome
 * from the player state, configured promotion thresholds, and injected RNG.
 */

import type { CareerProcessStage } from '../../domain/career/state';
import type { PlayerSave } from '../../types/player';
import type { PromotionConfig } from '../../types/config';

export interface CareerSelectionSettlement {
  outcome: 'passed' | 'failed' | 'continued';
  score: number | null;
  detail: string;
}

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
      return { outcome: 'passed', score: null, detail: 'Eligibility was revalidated' };
    case 'democratic_recommendation': {
      const score = capabilityScore(state, rng) + Math.min(state.character.network, 20);
      return score >= promotion.democraticVote.passThreshold
        ? {
            outcome: 'passed',
            score: boundedScore(score),
            detail: 'Democratic recommendation passed',
          }
        : {
            outcome: 'failed',
            score: boundedScore(score),
            detail: 'Democratic recommendation failed',
          };
    }
    case 'organization_inspection': {
      const score = capabilityScore(state, rng);
      if (score >= promotion.orgInspection.qualifiedThreshold)
        return { outcome: 'passed', score, detail: 'Organization inspection qualified' };
      if (score >= promotion.orgInspection.suspendedThreshold)
        return {
          outcome: 'continued',
          score,
          detail: 'Organization inspection requires observation',
        };
      return { outcome: 'failed', score, detail: 'Organization inspection failed' };
    }
    case 'collective_decision': {
      const passed =
        state.character.corruptionRisk < promotion.jointReview.disciplineCorruptionThreshold &&
        rng() <= promotion.jointReview.otherDepartmentsPassRate;
      return {
        outcome: passed ? 'passed' : 'failed',
        score: null,
        detail: passed ? 'Collective decision approved' : 'Collective decision rejected',
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
        detail: passed
          ? 'Public notice completed'
          : 'Public notice received a disqualifying complaint',
      };
    }
    case 'appointment':
      return {
        outcome: 'passed',
        score: null,
        detail: 'Appointment submitted for final validation',
      };
    default:
      return { outcome: 'passed', score: null, detail: 'Career process stage settled' };
  }
}
