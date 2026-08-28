/** Eligibility contract tests for vacancy-scoped relative selection. */

import { describe, expect, it } from 'vitest';
import { RELATIVE_SELECTION_STAGES } from '../../../domain/career/state';
import type { CareerAssessmentRecord, CareerExperience } from '../../../domain/career/state';
import type { RelativeSelectionConfig } from '../../../types/config';
import type {
  SelectionCandidateInput,
  SelectionCandidateSnapshot,
  SelectionVacancyEligibilityContext,
} from '../../../types/organization';
import {
  buildSelectionCandidatePool,
  createSelectionCandidateSnapshot,
} from '../relative-candidate-pool';
import { evaluateSelectionCandidateEligibility } from '../relative-selection-eligibility';

const context: SelectionVacancyEligibilityContext = {
  vacancyId: 'vacancy:test',
  positionId: 'admin_l2_0',
  institutionId: 'township_govt_01',
  regionId: 'region_qingyun_town',
  positionDomain: 'local_governance',
  sourceType: 'appointment',
  conflictingCandidateIds: [],
};

const rules: RelativeSelectionConfig = {
  schemaVersion: 14,
  rulesVersion: 'eligibility-test-v1',
  eligibility: {
    minimumCivilServiceRank: 'clerk_2',
    allowedLeadershipRanks: ['none', 'township_deputy'],
    minimumServiceDays: 0,
    excludedRestrictionTypes: ['disciplinary_action'],
    vacancyScopes: [
      {
        targetPositionId: 'admin_l2_0',
        allowedCurrentPositionIds: ['admin_l1_0'],
        requireSameInstitution: true,
        requireSameRegion: true,
        requireSamePositionDomain: true,
        minimumInstitutionExperienceDays: 180,
        minimumRegionExperienceDays: 180,
        minimumDomainExperienceDays: 180,
        minimumQualifiedAssessmentCount: 1,
        qualifiedAssessmentMinimumScore: 60,
        minimumLatestAssessmentScore: 60,
        requiredSpecialties: [{ specialtyId: 'public_management', minimumScore: 60 }],
      },
    ],
  },
  stages: RELATIVE_SELECTION_STAGES.map((id, index) => ({
    id,
    label: id,
    scoreWeights: { assessment: 1 },
    randomWeight: 0,
    eliminationThreshold: 0,
    requiresUniqueWinner: index === RELATIVE_SELECTION_STAGES.length - 1,
  })),
};

function input(candidateId: string, candidateType: 'player' | 'npc'): SelectionCandidateInput {
  return {
    candidateId,
    candidateType,
    currentPositionId: 'admin_l1_0',
    institutionId: context.institutionId,
    regionId: context.regionId,
    leadershipRank: 'none',
    civilServiceRank: 'clerk_2',
    appointmentStartedAtDay: 0,
    serviceStartedAtDay: 0,
    experiences: [
      {
        id: `${candidateId}:experience`,
        appointmentId: `${candidateId}:appointment`,
        positionId: 'admin_l1_0',
        positionNameSnapshot: '乡镇科员',
        institutionId: context.institutionId,
        institutionNameSnapshot: '青云镇人民政府',
        institutionLevel: 'township',
        regionId: context.regionId,
        positionDomain: context.positionDomain,
        leadershipRank: 'none',
        startedAtDay: 0,
        endedAtDay: null,
        appointmentReason: 'initial_assignment',
        appointmentType: 'substantive',
        sourceOpportunityId: null,
        endReason: null,
        assessmentResults: [],
      },
    ],
    assessments: [{ year: 2025, score: 80, tier: 'qualified' }],
    specialties: { public_management: 60 },
    restrictionTypes: [],
    scoringInputs: { assessment: 80 },
  };
}

function candidate(changes: Partial<SelectionCandidateSnapshot> = {}): SelectionCandidateSnapshot {
  return { ...createSelectionCandidateSnapshot(input('candidate', 'npc')), ...changes };
}

function reason(
  changes: Partial<SelectionCandidateSnapshot>,
  config = rules,
  vacancyContext = context,
): string | null {
  return evaluateSelectionCandidateEligibility(candidate(changes), config, 200, vacancyContext)
    .reason;
}

describe('relative selection vacancy eligibility', () => {
  it('applies the same rules to player and NPC and sorts by stable ID', () => {
    const pool = buildSelectionCandidatePool(
      [input('npc:z', 'npc'), input('player', 'player')],
      rules,
      200,
      context,
    );
    expect(pool.map((item) => item.candidateId)).toEqual(['npc:z', 'player']);
    expect(pool.map((item) => item.candidateType)).toEqual(['npc', 'player']);
  });

  it('rejects a candidate whose current position is outside the scope', () => {
    expect(reason({ currentPositionId: 'admin_l0_0' })).toBe('current_position_not_allowed');
  });

  it('rejects an institution mismatch', () => {
    expect(reason({ institutionId: 'township_govt_02' })).toBe('institution_mismatch');
  });

  it('rejects a region mismatch', () => {
    expect(reason({ regionId: 'region_other_town' })).toBe('region_mismatch');
  });

  it('rejects a current position domain mismatch', () => {
    expect(
      reason({
        experiences: candidate().experiences.map((experience) => ({
          ...experience,
          positionDomain: 'party_organs',
        })),
      }),
    ).toBe('position_domain_mismatch');
  });

  it('rejects insufficient institution experience', () => {
    expect(
      reason({
        experiences: candidate().experiences.map((experience) => ({
          ...experience,
          institutionId: 'township_govt_02',
        })),
      }),
    ).toBe('insufficient_institution_experience');
  });

  it('rejects insufficient region experience', () => {
    expect(
      reason({
        experiences: candidate().experiences.map((experience) => ({
          ...experience,
          regionId: 'region_other_town',
        })),
      }),
    ).toBe('insufficient_region_experience');
  });

  it('rejects insufficient position-domain experience', () => {
    const originalExperience = candidate().experiences[0];
    if (!originalExperience) throw new Error('Expected fixture experience');
    const currentExperience: CareerExperience = {
      ...originalExperience,
      positionId: 'admin_l1_0',
      positionDomain: 'local_governance' as const,
      startedAtDay: 200,
      endedAtDay: 200,
    };
    const historicalExperience: CareerExperience = {
      ...originalExperience,
      id: `${originalExperience.id}:history`,
      appointmentId: `${originalExperience.appointmentId}:history`,
      positionId: 'admin_l0_0',
      positionDomain: 'party_organs' as const,
      startedAtDay: 0,
      endedAtDay: 200,
    };
    expect(
      reason({
        experiences: [currentExperience, historicalExperience],
      }),
    ).toBe('insufficient_domain_experience');
  });

  it('rejects an insufficient count of qualified assessments', () => {
    expect(reason({ assessments: [{ year: 2025, score: 59, tier: 'unqualified' }] })).toBe(
      'insufficient_qualified_assessments',
    );
  });

  it('uses the last record when the latest assessment year is tied', () => {
    const firstAssessment: CareerAssessmentRecord = {
      year: 2024,
      score: 80,
      tier: 'qualified',
    };
    const secondAssessment: CareerAssessmentRecord = {
      year: 2025,
      score: 80,
      tier: 'qualified',
    };
    const lastLowAssessment: CareerAssessmentRecord = {
      year: 2025,
      score: 50,
      tier: 'unqualified',
    };
    const lastHighAssessment: CareerAssessmentRecord = {
      year: 2025,
      score: 80,
      tier: 'qualified',
    };
    const sameYearLow: CareerAssessmentRecord[] = [
      firstAssessment,
      secondAssessment,
      lastLowAssessment,
    ];
    expect(reason({ assessments: sameYearLow })).toBe('latest_assessment_below_minimum');
    const sameYearHigh: CareerAssessmentRecord[] = [
      firstAssessment,
      secondAssessment,
      lastHighAssessment,
    ];
    expect(reason({ assessments: sameYearHigh })).toBe(null);
  });

  it('rejects a candidate below the required specialty score', () => {
    expect(reason({ specialties: { public_management: 59 } })).toBe('specialty_below_minimum');
  });

  it('rejects a candidate listed in the vacancy conflict set', () => {
    expect(reason({}, rules, { ...context, conflictingCandidateIds: ['candidate'] })).toBe(
      'conflicting_candidate',
    );
  });

  it('rejects a vacancy without a configured scope', () => {
    const noScope = structuredClone(rules);
    noScope.eligibility.vacancyScopes = [];
    expect(reason({}, noScope)).toBe('vacancy_scope_not_found');
  });

  it('enforces global civil-service rank and leadership rules', () => {
    const civilRules = structuredClone(rules);
    civilRules.eligibility.minimumCivilServiceRank = 'clerk_1';
    expect(reason({}, civilRules)).toBe('civil_service_rank_below_minimum');
    expect(reason({ leadershipRank: 'county_chief' })).toBe('leadership_rank_not_allowed');
  });

  it('enforces global restriction and service rules', () => {
    expect(reason({ restrictionTypes: ['disciplinary_action'] })).toBe('restricted');
    const serviceRules = structuredClone(rules);
    serviceRules.eligibility.minimumServiceDays = 201;
    expect(reason({}, serviceRules)).toBe('insufficient_service');
  });
});
