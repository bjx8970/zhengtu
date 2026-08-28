/** Relative-selection contract tests: normalization, freezing, replay, and terminal outcomes. */

import { describe, expect, it } from 'vitest';
import { RelativeSelectionConfigSchema } from '../../../config/schemas';
import { RELATIVE_SELECTION_STAGES } from '../../../domain/career/state';
import type { RelativeSelectionConfig } from '../../../types/config';
import type {
  SelectionCandidateInput,
  SelectionVacancyEligibilityContext,
} from '../../../types/organization';
import {
  buildSelectionCandidatePool,
  createSelectionCandidateSnapshot,
} from '../relative-candidate-pool';
import {
  advanceRelativeSelectionStage,
  createRelativeSelection,
} from '../relative-selection-lifecycle';

const rules: RelativeSelectionConfig = {
  schemaVersion: 14,
  rulesVersion: 'test-v1',
  eligibility: {
    minimumCivilServiceRank: 'clerk_2',
    allowedLeadershipRanks: ['none', 'township_deputy'],
    minimumServiceDays: 0,
    excludedRestrictionTypes: ['disciplinary_action'],
    vacancyScopes: [
      {
        targetPositionId: 'admin_l2_0',
        allowedCurrentPositionIds: ['admin_l1_0'],
        requireSameInstitution: false,
        requireSameRegion: false,
        requireSamePositionDomain: false,
        minimumInstitutionExperienceDays: 0,
        minimumRegionExperienceDays: 0,
        minimumDomainExperienceDays: 0,
        minimumQualifiedAssessmentCount: 0,
        qualifiedAssessmentMinimumScore: 60,
        minimumLatestAssessmentScore: 0,
        requiredSpecialties: [],
      },
    ],
  },
  stages: RELATIVE_SELECTION_STAGES.map((id, index) => ({
    id,
    label: id,
    scoreWeights: { assessment: 1 },
    randomWeight: 0,
    eliminationThreshold: index === 5 ? 0 : 1,
    requiresUniqueWinner: index === 5,
  })),
};

function candidate(
  candidateId: string,
  candidateType: 'player' | 'npc',
  score = 80,
): SelectionCandidateInput {
  return {
    candidateId,
    candidateType,
    currentPositionId: 'admin_l1_0',
    institutionId: 'township_govt_01',
    regionId: 'region_qingyun_town',
    leadershipRank: 'none',
    civilServiceRank: 'clerk_2',
    appointmentStartedAtDay: null,
    serviceStartedAtDay: 0,
    experiences: [
      {
        id: `${candidateId}:experience`,
        appointmentId: `${candidateId}:appointment`,
        positionId: 'admin_l1_0',
        positionNameSnapshot: '乡镇科员',
        institutionId: 'township_govt_01',
        institutionNameSnapshot: '青云镇人民政府',
        institutionLevel: 'township',
        regionId: 'region_qingyun_town',
        positionDomain: 'local_governance',
        leadershipRank: 'none',
        startedAtDay: -180,
        endedAtDay: null,
        appointmentReason: 'initial_assignment',
        appointmentType: 'substantive',
        sourceOpportunityId: null,
        endReason: null,
        assessmentResults: [],
      },
    ],
    assessments: [{ year: 2025, score, tier: 'qualified' }],
    specialties: {},
    restrictionTypes: [],
    scoringInputs: { assessment: score },
  };
}

const eligibilityContext: SelectionVacancyEligibilityContext = {
  vacancyId: 'vacancy:test',
  positionId: 'admin_l2_0',
  institutionId: 'township_govt_01',
  regionId: 'region_qingyun_town',
  positionDomain: 'local_governance',
  sourceType: 'appointment',
  conflictingCandidateIds: [],
};

function create(candidates: readonly SelectionCandidateInput[], config = rules) {
  const result = createRelativeSelection({
    selectionId: 'selection:test',
    vacancyId: 'vacancy:test',
    startedAtDay: 10,
    candidates,
    rules: config,
    eligibilityContext,
    randomDraws: Array.from({ length: 20 }, (_, index) => (index % 10) / 10),
  });
  if (!result.success) throw new Error(result.detail);
  return result.selection;
}

describe('relative selection contract', () => {
  it('normalizes player and NPC through one snapshot and sorts stable IDs', () => {
    const npc = candidate('npc:b', 'npc');
    const player = candidate('player', 'player');
    const pool = buildSelectionCandidatePool([npc, player], rules, 10, eligibilityContext);
    expect(pool.map((item) => item.candidateId)).toEqual(['npc:b', 'player']);
    expect(createSelectionCandidateSnapshot(player)).toEqual(
      expect.objectContaining({ candidateType: 'player', candidateId: 'player' }),
    );
  });

  it('freezes candidates, rules version, and random draws at creation', () => {
    const source = candidate('player', 'player');
    const selection = create([source]);
    source.scoringInputs.assessment = 1;
    expect(selection.rulesVersion).toBe('test-v1');
    expect(selection.randomDraws).toHaveLength(20);
    expect(selection.candidates[0]?.scoringInputs.assessment).toBe(80);
  });

  it('persists six stage audits and produces one deterministic winner', () => {
    let selection = create([candidate('npc:z', 'npc', 60), candidate('player', 'player', 90)]);
    for (let day = 11; day <= 16; day++) {
      const result = advanceRelativeSelectionStage({ selection, resolvedAtDay: day, rules });
      if (!result.success) throw new Error(result.detail);
      selection = result.selection;
    }
    expect(selection.stageResults?.map((result) => result.stage)).toEqual([
      'eligibility_review',
      'democratic_recommendation',
      'organization_inspection',
      'collective_decision',
      'public_notice',
      'appointment',
    ]);
    expect(selection.stageResults?.every((result) => result.candidates.length > 0)).toBe(true);
    expect(selection.status).toBe('completed');
    expect(selection.winnerId).toBe('player');
    expect(selection.winner).toEqual({ type: 'player', id: 'player' });
  });

  it('reports no qualified candidates', () => {
    const result = createRelativeSelection({
      selectionId: 'selection:none',
      vacancyId: 'vacancy:none',
      startedAtDay: 1,
      candidates: [{ ...candidate('npc:x', 'npc'), restrictionTypes: ['disciplinary_action'] }],
      rules,
      eligibilityContext,
      randomDraws: [],
    });
    if (!result.success) throw new Error(result.detail);
    expect(result.selection.failure?.code).toBe('no_qualified_candidates');
  });

  it('uses Selection day for the same service qualification of player and NPC', () => {
    const serviceRules = structuredClone(rules);
    serviceRules.eligibility.minimumServiceDays = 10;
    const inputs = [candidate('player', 'player'), candidate('npc:x', 'npc')].map((item) => ({
      ...item,
      serviceStartedAtDay: 96,
    }));
    expect(buildSelectionCandidatePool(inputs, serviceRules, 100, eligibilityContext)).toHaveLength(
      0,
    );
    expect(buildSelectionCandidatePool(inputs, serviceRules, 105, eligibilityContext)).toHaveLength(
      0,
    );
    expect(buildSelectionCandidatePool(inputs, serviceRules, 106, eligibilityContext)).toHaveLength(
      2,
    );
  });

  it('reports stage exhaustion and unique-winner failure', () => {
    const exhaustedRules = structuredClone(rules);
    const firstStage = exhaustedRules.stages[0];
    if (!firstStage) throw new Error('Expected first stage');
    firstStage.eliminationThreshold = 100;
    const exhausted = create([candidate('npc:x', 'npc', 20)], exhaustedRules);
    const exhaustedResult = advanceRelativeSelectionStage({
      selection: exhausted,
      resolvedAtDay: 2,
      rules: exhaustedRules,
    });
    if (!exhaustedResult.success) throw new Error(exhaustedResult.detail);
    expect(exhaustedResult.selection.failure?.code).toBe('stage_no_survivors');

    let tied = create([candidate('npc:x', 'npc'), candidate('npc:y', 'npc')]);
    for (let day = 2; day <= 6; day++) {
      const stageResult = advanceRelativeSelectionStage({
        selection: tied,
        resolvedAtDay: day,
        rules,
      });
      if (!stageResult.success) throw new Error(stageResult.detail);
      tied = stageResult.selection;
    }
    const finalResult = advanceRelativeSelectionStage({ selection: tied, resolvedAtDay: 7, rules });
    if (!finalResult.success) throw new Error(finalResult.detail);
    expect(finalResult.selection.failure?.code).toBe('no_unique_winner');
  });

  it('replays identically and does not mutate the selection input', () => {
    const original = create([candidate('player', 'player', 90), candidate('npc:x', 'npc', 70)]);
    const first = advanceRelativeSelectionStage({ selection: original, resolvedAtDay: 2, rules });
    const second = advanceRelativeSelectionStage({ selection: original, resolvedAtDay: 2, rules });
    expect(first).toEqual(second);
    expect(original.stageResults).toEqual([]);
  });

  it('rejects invalid stage uniqueness rules and incomplete or invalid RNG', () => {
    const invalidRules = structuredClone(rules);
    const firstStage = invalidRules.stages[0];
    if (!firstStage) throw new Error('Expected first stage');
    firstStage.requiresUniqueWinner = true;
    expect(RelativeSelectionConfigSchema.safeParse(invalidRules).success).toBe(false);

    const short = createRelativeSelection({
      selectionId: 'selection:short',
      vacancyId: 'vacancy:short',
      startedAtDay: 1,
      candidates: [candidate('player', 'player')],
      rules,
      eligibilityContext,
      randomDraws: [0.1],
    });
    expect(short).toMatchObject({ success: false, error: 'invalid_random_draws' });
    const illegal = createRelativeSelection({
      selectionId: 'selection:illegal',
      vacancyId: 'vacancy:illegal',
      startedAtDay: 1,
      candidates: [candidate('player', 'player')],
      rules,
      eligibilityContext,
      randomDraws: Array.from({ length: 6 }, (_, index) => (index === 3 ? 2 : 0.1)),
    });
    expect(illegal).toMatchObject({ success: false, error: 'invalid_random_draws' });
  });
});
