/**
 * Relative-selection candidate normalization and qualification.
 *
 * Player and NPC facts enter through the same input shape, which prevents a
 * mutable runtime object from being consulted after a Selection is created.
 */

import { isCivilServiceRankAtLeast } from '../../domain/career/types';
import type { RelativeSelectionConfig } from '../../types/config';
import type {
  CandidateEligibilityResult,
  SelectionCandidateInput,
  SelectionCandidateSnapshot,
} from '../../types/organization';

/**
 * Clone one player or NPC source into the common frozen snapshot shape.
 *
 * @param input source facts captured at Selection creation time
 * @returns detached candidate snapshot
 */
export function createSelectionCandidateSnapshot(
  input: SelectionCandidateInput,
): SelectionCandidateSnapshot {
  return {
    candidateId: input.candidateId,
    candidateType: input.candidateType,
    currentPositionId: input.currentPositionId,
    institutionId: input.institutionId,
    regionId: input.regionId,
    leadershipRank: input.leadershipRank,
    civilServiceRank: input.civilServiceRank,
    appointmentStartedAtDay: input.appointmentStartedAtDay,
    serviceStartedAtDay: input.serviceStartedAtDay,
    assessments: structuredClone(input.assessments),
    specialties: structuredClone(input.specialties),
    restrictionTypes: [...input.restrictionTypes],
    scoringInputs: { ...input.scoringInputs },
  };
}

/**
 * Apply the sole qualification rule to a frozen candidate snapshot.
 *
 * @param candidate frozen candidate snapshot
 * @param config relative-selection rules
 * @param selectionDay absolute day at which the Selection is created
 * @returns qualification outcome with a stable diagnostic reason
 */
export function evaluateSelectionCandidateEligibility(
  candidate: SelectionCandidateSnapshot,
  config: RelativeSelectionConfig,
  selectionDay: number,
): CandidateEligibilityResult {
  if (
    !isCivilServiceRankAtLeast(
      candidate.civilServiceRank,
      config.eligibility.minimumCivilServiceRank,
    )
  )
    return { eligible: false, reason: 'civil_service_rank_below_minimum' };
  if (!config.eligibility.allowedLeadershipRanks.includes(candidate.leadershipRank))
    return { eligible: false, reason: 'leadership_rank_not_allowed' };
  const serviceDays = Math.max(selectionDay - candidate.serviceStartedAtDay, 0);
  if (serviceDays < config.eligibility.minimumServiceDays)
    return { eligible: false, reason: 'insufficient_service' };
  if (
    candidate.restrictionTypes.some((restriction) =>
      config.eligibility.excludedRestrictionTypes.includes(restriction),
    )
  )
    return { eligible: false, reason: 'restricted' };
  return { eligible: true, reason: null };
}

/**
 * Normalize, qualify, and stably sort a candidate pool.
 *
 * @param inputs player and NPC facts captured at one instant
 * @param config relative-selection rules
 * @param selectionDay absolute day at which the Selection is created
 * @returns eligible snapshots sorted by stable candidate ID
 */
export function buildSelectionCandidatePool(
  inputs: readonly SelectionCandidateInput[],
  config: RelativeSelectionConfig,
  selectionDay: number,
): SelectionCandidateSnapshot[] {
  const snapshots = inputs.map(createSelectionCandidateSnapshot);
  return snapshots
    .filter(
      (candidate) =>
        evaluateSelectionCandidateEligibility(candidate, config, selectionDay).eligible,
    )
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}
