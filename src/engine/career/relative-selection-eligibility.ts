/**
 * Vacancy-specific relative-selection eligibility.
 *
 * This module is the single predicate for both player and NPC snapshots. It
 * consumes detached facts and a small vacancy context, never a mutable world
 * object, so creation remains deterministic and replayable.
 */

import { isCivilServiceRankAtLeast } from '../../domain/career/types';
import type { RelativeSelectionConfig, RelativeSelectionVacancyScope } from '../../types/config';
import type {
  CandidateEligibilityResult,
  SelectionCandidateSnapshot,
  SelectionVacancyEligibilityContext,
} from '../../types/organization';

function experienceDays(
  candidate: SelectionCandidateSnapshot,
  context: SelectionVacancyEligibilityContext,
  selectionDay: number,
  dimension: 'institutionId' | 'regionId' | 'positionDomain',
): number {
  return candidate.experiences
    .filter((experience) => experience[dimension] === context[dimension])
    .reduce((total, experience) => {
      const end = experience.endedAtDay ?? selectionDay;
      return total + Math.max(end - experience.startedAtDay, 0);
    }, 0);
}

function scopeFor(
  config: RelativeSelectionConfig,
  context: SelectionVacancyEligibilityContext,
): RelativeSelectionVacancyScope | undefined {
  return config.eligibility.vacancyScopes.find(
    (scope) => scope.targetPositionId === context.positionId,
  );
}

/**
 * Apply the fixed relative-selection eligibility order to one frozen snapshot.
 *
 * @param candidate detached candidate facts captured at selection creation
 * @param config relative-selection rules
 * @param selectionDay absolute day at which eligibility is evaluated
 * @param context detached facts identifying the target vacancy
 * @returns eligibility outcome with a stable reason code
 */
export function evaluateSelectionCandidateEligibility(
  candidate: SelectionCandidateSnapshot,
  config: RelativeSelectionConfig,
  selectionDay: number,
  context: SelectionVacancyEligibilityContext,
): CandidateEligibilityResult {
  const eligibility = config.eligibility;
  if (!isCivilServiceRankAtLeast(candidate.civilServiceRank, eligibility.minimumCivilServiceRank))
    return { eligible: false, reason: 'civil_service_rank_below_minimum' };
  if (!eligibility.allowedLeadershipRanks.includes(candidate.leadershipRank))
    return { eligible: false, reason: 'leadership_rank_not_allowed' };
  if (Math.max(selectionDay - candidate.serviceStartedAtDay, 0) < eligibility.minimumServiceDays)
    return { eligible: false, reason: 'insufficient_service' };
  if (
    candidate.restrictionTypes.some((restriction) =>
      eligibility.excludedRestrictionTypes.includes(restriction),
    )
  )
    return { eligible: false, reason: 'restricted' };

  const scope = scopeFor(config, context);
  if (!scope) return { eligible: false, reason: 'vacancy_scope_not_found' };
  if (!scope.allowedCurrentPositionIds.includes(candidate.currentPositionId ?? ''))
    return { eligible: false, reason: 'current_position_not_allowed' };
  if (scope.requireSameInstitution && candidate.institutionId !== context.institutionId)
    return { eligible: false, reason: 'institution_mismatch' };
  if (scope.requireSameRegion && candidate.regionId !== context.regionId)
    return { eligible: false, reason: 'region_mismatch' };
  const currentDomain = candidate.experiences.find(
    (experience) => experience.positionId === candidate.currentPositionId,
  )?.positionDomain;
  if (scope.requireSamePositionDomain && currentDomain !== context.positionDomain)
    return { eligible: false, reason: 'position_domain_mismatch' };

  if (
    experienceDays(candidate, context, selectionDay, 'institutionId') <
    scope.minimumInstitutionExperienceDays
  )
    return { eligible: false, reason: 'insufficient_institution_experience' };
  if (
    experienceDays(candidate, context, selectionDay, 'regionId') < scope.minimumRegionExperienceDays
  )
    return { eligible: false, reason: 'insufficient_region_experience' };
  if (
    experienceDays(candidate, context, selectionDay, 'positionDomain') <
    scope.minimumDomainExperienceDays
  )
    return { eligible: false, reason: 'insufficient_domain_experience' };

  const qualifiedAssessments = candidate.assessments.filter(
    (assessment) => assessment.score >= scope.qualifiedAssessmentMinimumScore,
  );
  if (qualifiedAssessments.length < scope.minimumQualifiedAssessmentCount)
    return { eligible: false, reason: 'insufficient_qualified_assessments' };
  const latest = candidate.assessments.reduce<(typeof candidate.assessments)[number] | null>(
    (current, assessment) =>
      !current || assessment.year > current.year || assessment.year === current.year
        ? assessment
        : current,
    null,
  );
  if (!latest || latest.score < scope.minimumLatestAssessmentScore)
    return { eligible: false, reason: 'latest_assessment_below_minimum' };
  if (
    scope.requiredSpecialties.some(
      (required) =>
        (candidate.specialties[required.specialtyId] ?? -Infinity) < required.minimumScore,
    )
  )
    return { eligible: false, reason: 'specialty_below_minimum' };
  if (context.conflictingCandidateIds.includes(candidate.candidateId))
    return { eligible: false, reason: 'conflicting_candidate' };
  return { eligible: true, reason: null };
}
