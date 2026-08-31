/** Pure, deterministic relative scoring for frozen candidate snapshots. */

import type { RelativeSelectionStageConfig } from '../../types/config';
import type { SelectionCandidateSnapshot } from '../../types/organization';
import type { SelectionCandidateStageResult } from '../../domain/career/state';

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Calculate one candidate's score from configured inputs and one frozen draw.
 *
 * @param candidate frozen candidate snapshot
 * @param stage stage scoring rules
 * @param randomDraw deterministic value consumed at Selection creation
 * @returns bounded integer score
 */
export function calculateRelativeScore(
  candidate: SelectionCandidateSnapshot,
  stage: RelativeSelectionStageConfig,
  randomDraw: number,
): number {
  const weighted = Object.entries(stage.scoreWeights).reduce(
    (total, [key, weight]) => total + (candidate.scoringInputs[key] ?? 0) * weight,
    0,
  );
  const draw = Math.max(0, Math.min(1, randomDraw));
  return clampScore(weighted + (draw - 0.5) * 2 * stage.randomWeight);
}

/**
 * Score and rank candidates, breaking equal scores by stable candidate ID.
 *
 * @param candidates currently surviving frozen candidates
 * @param stage stage scoring rules
 * @param randomDraws complete frozen RNG input
 * @param drawOffset index of the draw consumed by this stage
 * @returns per-candidate score, rank, and threshold elimination audit
 */
export function scoreRelativeSelectionStage(
  candidates: readonly SelectionCandidateSnapshot[],
  stage: RelativeSelectionStageConfig,
  randomDraws: readonly number[],
  drawOffset: number,
): SelectionCandidateStageResult[] {
  const ranked = candidates
    .map((candidate, index) => {
      const randomDraw = randomDraws[drawOffset + index];
      if (randomDraw === undefined)
        throw new Error('Relative-selection random input is incomplete');
      return {
        candidateId: candidate.candidateId,
        score: calculateRelativeScore(candidate, stage, randomDraw),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.candidateId.localeCompare(right.candidateId),
    );
  return ranked.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    eliminated: candidate.score < stage.eliminationThreshold,
  }));
}
