/**
 * Relative-selection candidate normalization and qualification.
 *
 * Player and NPC facts enter through the same input shape, which prevents a
 * mutable runtime object from being consulted after a Selection is created.
 */

import type { RelativeSelectionConfig } from '../../types/config';
import type {
  SelectionCandidateInput,
  SelectionCandidateSnapshot,
  SelectionVacancyEligibilityContext,
} from '../../types/organization';
import { evaluateSelectionCandidateEligibility } from './relative-selection-eligibility';

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
    experiences: structuredClone(input.experiences),
    assessments: structuredClone(input.assessments),
    specialties: structuredClone(input.specialties),
    restrictionTypes: [...input.restrictionTypes],
    scoringInputs: { ...input.scoringInputs },
  };
}

/**
 * Normalize, qualify, and stably sort a candidate pool.
 *
 * @param inputs player and NPC facts captured at one instant
 * @param config relative-selection rules
 * @param selectionDay absolute day at which the Selection is created
 * @param eligibilityContext detached target vacancy facts
 * @returns eligible snapshots sorted by stable candidate ID
 */
export function buildSelectionCandidatePool(
  inputs: readonly SelectionCandidateInput[],
  config: RelativeSelectionConfig,
  selectionDay: number,
  eligibilityContext: SelectionVacancyEligibilityContext,
): SelectionCandidateSnapshot[] {
  const snapshots = inputs.map(createSelectionCandidateSnapshot);
  return snapshots
    .filter(
      (candidate) =>
        evaluateSelectionCandidateEligibility(candidate, config, selectionDay, eligibilityContext)
          .eligible,
    )
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}
