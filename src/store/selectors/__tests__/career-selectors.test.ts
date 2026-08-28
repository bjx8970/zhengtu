/**
 * 职业选拔展示选择器测试。
 *
 * 通过冻结的候选审计构造场景，验证选择器不会因角色当前属性变化而改变
 * 历史排名，并覆盖进行中、淘汰、获选、NPC 获胜和无合格候选结果。
 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../game-store';
import { selectCareerSelectionView } from '../career-selectors';
import type { CareerProcess, RelativeSelectionStageResult } from '../../../domain/career/state';
import type { StaffingSelection, SelectionCandidateSnapshot } from '../../../types/organization';
import type { PlayerSave } from '../../../types/player';

function candidate(
  candidateId: string,
  candidateType: 'player' | 'npc',
): SelectionCandidateSnapshot {
  return {
    candidateId,
    candidateType,
    currentPositionId: null,
    institutionId: null,
    regionId: null,
    leadershipRank: 'none',
    civilServiceRank: 'clerk_2',
    appointmentStartedAtDay: null,
    serviceStartedAtDay: 0,
    experiences: [],
    assessments: [],
    specialties: {},
    restrictionTypes: [],
    scoringInputs: { competence: candidateType === 'player' ? 80 : 60 },
  };
}

function result(
  stage: RelativeSelectionStageResult['stage'],
  values: Array<[string, number, boolean]>,
  survivors: string[],
): RelativeSelectionStageResult {
  return {
    stage,
    resolvedAtDay: 10,
    candidates: values.map(([candidateId, score, eliminated], index) => ({
      candidateId,
      score,
      rank: index + 1,
      eliminated,
    })),
    survivingCandidateIds: survivors,
  };
}

function process(overrides: Partial<CareerProcess> = {}): CareerProcess {
  return {
    id: 'process-1',
    type: 'leadership_selection',
    status: 'active',
    opportunityId: 'opportunity-1',
    selectionId: 'selection-1',
    vacancyId: 'vacancy-1',
    currentStage: 'democratic_recommendation',
    startedAtDay: 1,
    completedAtDay: null,
    stageResults: [],
    ...overrides,
  };
}

function selection(
  candidates: SelectionCandidateSnapshot[],
  stageResults: RelativeSelectionStageResult[],
  overrides: Partial<StaffingSelection> = {},
): StaffingSelection {
  return {
    selectionId: 'selection-1',
    vacancyId: 'vacancy-1',
    status: 'active',
    currentStage: 'democratic_recommendation',
    startedAtDay: 1,
    completedAtDay: null,
    candidates,
    stageAudits: [],
    winner: null,
    playerCareerProcessId: 'process-1',
    randomDraws: [],
    stageResults,
    rulesVersion: 'phase4-relative-v1',
    winnerId: null,
    failure: null,
    ...overrides,
  };
}

function baseState(
  currentProcess: CareerProcess | null,
  completedProcesses: CareerProcess[] = [],
): PlayerSave {
  const state = createInitialState();
  state.career.activeProcess = currentProcess;
  state.career.completedProcesses = completedProcesses;
  return state;
}

describe('selectCareerSelectionView', () => {
  it('reads current frozen rank and score while selection is in progress', () => {
    const current = process();
    const state = baseState(current);
    state.organization.selections = [
      selection(
        [candidate('player', 'player'), candidate('npc-1', 'npc')],
        [
          result(
            'eligibility_review',
            [
              ['player', 82, false],
              ['npc-1', 74, false],
            ],
            ['player', 'npc-1'],
          ),
        ],
      ),
    ];

    const view = selectCareerSelectionView(state);
    expect(view).toMatchObject({
      totalCandidates: 2,
      survivorCount: 2,
      playerRank: 1,
      playerScore: 82,
      playerRelativePerformance: '暂列第 1 名',
      outcome: 'in_progress',
    });
    expect(view?.resolvedStageCount).toBe(1);
  });

  it('reports a player eliminated in a completed stage', () => {
    const current = process({ currentStage: 'organization_inspection' });
    const state = baseState(current);
    state.organization.selections = [
      selection(
        [candidate('player', 'player'), candidate('npc-1', 'npc')],
        [
          result(
            'eligibility_review',
            [
              ['npc-1', 80, false],
              ['player', 40, true],
            ],
            ['npc-1'],
          ),
        ],
        {
          status: 'failed',
          completedAtDay: 10,
          failure: { code: 'stage_no_survivors', stage: 'eligibility_review', detail: '淘汰' },
        },
      ),
    ];

    const view = selectCareerSelectionView(state);
    expect(view?.playerEliminated).toBe(true);
    expect(view?.playerRelativePerformance).toBe('已在资格审查淘汰');
    expect(view?.outcome).toBe('not_selected');
  });

  it('keeps not_selected when player was eliminated before a later no-unique-winner failure', () => {
    const current = process({ currentStage: 'collective_decision' });
    const state = baseState(current);
    state.organization.selections = [
      selection(
        [candidate('player', 'player'), candidate('npc-1', 'npc')],
        [
          result(
            'eligibility_review',
            [
              ['npc-1', 80, false],
              ['player', 40, true],
            ],
            ['npc-1'],
          ),
          result('democratic_recommendation', [['npc-1', 80, false]], ['npc-1']),
        ],
        {
          status: 'failed',
          completedAtDay: 10,
          failure: {
            code: 'no_unique_winner',
            stage: 'democratic_recommendation',
            detail: '最高分并列',
          },
        },
      ),
    ];

    expect(selectCareerSelectionView(state)?.outcome).toBe('not_selected');
  });

  it('keeps not_selected when player was eliminated before another terminal failure', () => {
    const current = process({ currentStage: 'collective_decision' });
    const state = baseState(current);
    state.organization.selections = [
      selection(
        [candidate('player', 'player'), candidate('npc-1', 'npc')],
        [
          result(
            'eligibility_review',
            [
              ['player', 40, true],
              ['npc-1', 80, false],
            ],
            ['npc-1'],
          ),
        ],
        {
          status: 'failed',
          completedAtDay: 10,
          failure: {
            code: 'stage_no_survivors',
            stage: 'collective_decision',
            detail: '阶段失败',
          },
        },
      ),
    ];

    expect(selectCareerSelectionView(state)?.outcome).toBe('not_selected');
  });

  it('uses the final appointed opportunity to distinguish player victory', () => {
    const completed = process({
      status: 'completed',
      completedAtDay: 20,
      currentStage: 'appointment',
    });
    const state = baseState(null, [completed]);
    state.career.opportunities = [
      {
        id: 'opportunity-1',
        definitionId: 'test',
        type: 'leadership_vacancy',
        status: 'resolved',
        source: {
          sourceType: 'vacancy',
          sourceId: 'vacancy-1',
          signalId: null,
          description: 'test',
        },
        vacancyId: 'vacancy-1',
        sourceSignal: null,
        appearedAtDay: 1,
        expiresAtDay: null,
        acceptedAtDay: 1,
        rejectedAtDay: null,
        resolvedAtDay: 20,
        cancelledAtDay: null,
        requiresSelection: true,
        eligibilityConditions: [],
        finalOutcome: 'appointed',
        reason: 'test',
        target: {
          positionId: 'position-test',
          positionName: '测试职位',
          institutionId: 'institution-test',
          institutionName: '测试机构',
          regionId: 'region_qingyun_town',
          institutionLevel: 'township',
          positionDomain: 'government_general',
          leadershipRank: 'township_deputy',
        },
        appointmentType: 'substantive',
        appointmentReason: 'promotion',
      },
    ];
    state.organization.selections = [
      selection(
        [candidate('player', 'player'), candidate('npc-1', 'npc')],
        [
          result(
            'appointment',
            [
              ['player', 95, false],
              ['npc-1', 80, true],
            ],
            ['player'],
          ),
        ],
        {
          status: 'completed',
          completedAtDay: 20,
          currentStage: 'appointment',
          winnerId: 'player',
          winner: { type: 'player', id: 'player' },
        },
      ),
    ];

    expect(selectCareerSelectionView(state)?.outcome).toBe('appointed');
  });

  it('keeps a terminal player winner in progress while appointment continuation is pending', () => {
    const current = process({ currentStage: 'appointment' });
    const state = baseState(current);
    state.organization.selections = [
      selection(
        [candidate('player', 'player')],
        [result('appointment', [['player', 95, false]], ['player'])],
        {
          status: 'completed',
          completedAtDay: 20,
          winnerId: 'player',
          winner: { type: 'player', id: 'player' },
        },
      ),
    ];

    expect(selectCareerSelectionView(state)).toMatchObject({
      winnerName: '玩家',
      outcome: 'in_progress',
      processActive: true,
    });
  });

  it('shows an NPC winner and uses the cadre snapshot name', () => {
    const completed = process({
      status: 'completed',
      completedAtDay: 20,
      currentStage: 'appointment',
    });
    const state = baseState(null, [completed]);
    const firstCadre = state.organization.cadres[0];
    if (!firstCadre) throw new Error('Expected initialized cadre');
    firstCadre.cadreId = 'npc-1';
    firstCadre.name = '李干部';
    state.organization.selections = [
      selection(
        [candidate('player', 'player'), candidate('npc-1', 'npc')],
        [
          result(
            'appointment',
            [
              ['npc-1', 95, false],
              ['player', 70, true],
            ],
            ['npc-1'],
          ),
        ],
        {
          status: 'completed',
          completedAtDay: 20,
          winnerId: 'npc-1',
          winner: { type: 'npc', id: 'npc-1' },
        },
      ),
    ];

    expect(selectCareerSelectionView(state)).toMatchObject({
      winnerName: '李干部',
      outcome: 'not_selected',
    });
  });

  it('reports no candidates without falsely marking the player eliminated', () => {
    const state = baseState(process({ status: 'failed', completedAtDay: 1 }));
    state.organization.selections = [
      selection([], [], {
        status: 'failed',
        completedAtDay: 1,
        failure: { code: 'no_qualified_candidates', stage: null, detail: '没有符合资格的候选人' },
      }),
    ];

    expect(selectCareerSelectionView(state)).toMatchObject({
      totalCandidates: 0,
      survivorCount: 0,
      playerEliminated: false,
      outcome: 'no_candidates',
      playerRelativePerformance: '尚未产生排名',
    });
  });

  it('supports Schema 13 legacy selections with missing optional fields', () => {
    const current = process();
    const state = baseState(current);
    const legacy = selection([candidate('player', 'player')], [], {
      rulesVersion: undefined,
      stageResults: undefined,
      winnerId: undefined,
      failure: undefined,
    });
    state.organization.selections = [legacy];
    expect(selectCareerSelectionView(state)).toMatchObject({
      totalCandidates: 1,
      survivorCount: 1,
      playerRank: null,
      outcome: 'in_progress',
    });
    state.character.competence = 0;
    expect(selectCareerSelectionView(state)?.playerScore).toBeNull();
  });
});
