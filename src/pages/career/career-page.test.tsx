/**
 * 职业选拔页面测试。
 *
 * 页面通过真实 Store 的 LOAD_SAVE 入口装载冻结 Selection，验证关键测试标识
 * 和中文结果展示，而不是绕过页面组件注入派生数据。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { createInitialState, dispatch } from '../../store/game-store';
import { CareerPage } from './career-page';
import type { CareerProcess, RelativeSelectionStageResult } from '../../domain/career/state';
import type { SelectionCandidateSnapshot, StaffingSelection } from '../../types/organization';

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
    scoringInputs: {},
  };
}

function makeState() {
  const state = createInitialState();
  const process: CareerProcess = {
    id: 'process-page',
    type: 'leadership_selection',
    status: 'active',
    opportunityId: 'opportunity-page',
    selectionId: 'selection-page',
    vacancyId: 'vacancy-page',
    currentStage: 'democratic_recommendation',
    startedAtDay: 1,
    completedAtDay: null,
    stageResults: [],
  };
  const result: RelativeSelectionStageResult = {
    stage: 'eligibility_review',
    resolvedAtDay: 2,
    candidates: [
      { candidateId: 'player', score: 88, rank: 1, eliminated: false },
      { candidateId: 'npc-page', score: 76, rank: 2, eliminated: false },
    ],
    survivingCandidateIds: ['player', 'npc-page'],
  };
  const selection: StaffingSelection = {
    selectionId: 'selection-page',
    vacancyId: 'vacancy-page',
    status: 'active',
    currentStage: 'democratic_recommendation',
    startedAtDay: 1,
    completedAtDay: null,
    candidates: [candidate('player', 'player'), candidate('npc-page', 'npc')],
    stageAudits: [],
    winner: null,
    playerCareerProcessId: 'process-page',
    randomDraws: [],
    stageResults: [result],
    rulesVersion: 'phase4-relative-v1',
    winnerId: null,
    failure: null,
  };
  state.career.activeProcess = process;
  state.organization.selections = [selection];
  return state;
}

describe('CareerPage relative selection display', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatch({ type: 'LOAD_SAVE', save: createInitialState() });
  });

  it('displays frozen candidate counts, six-stage progress, performance and outcome', () => {
    dispatch({ type: 'LOAD_SAVE', save: makeState() });
    render(() => <CareerPage />);

    expect(screen.getByTestId('career-selection-card')).toBeInTheDocument();
    expect(screen.getByTestId('selection-candidate-count')).toHaveTextContent('2 人');
    expect(screen.getByTestId('selection-survivor-count')).toHaveTextContent('2 人');
    expect(screen.getByTestId('selection-stage-progress')).toHaveTextContent('资格审查');
    expect(screen.getByTestId('selection-stage-progress')).toHaveTextContent('任职决定');
    expect(screen.getByTestId('selection-player-performance')).toHaveTextContent('暂列第 1 名');
    expect(screen.getByTestId('selection-player-eliminated')).toHaveTextContent('仍在选拔中');
    expect(screen.getByTestId('selection-winner')).toHaveTextContent('尚未产生');
    expect(screen.getByTestId('selection-outcome')).toHaveTextContent('选拔进行中');
    expect(screen.getByTestId('advance-career-process-opportunity-page')).toBeInTheDocument();
  });
});
