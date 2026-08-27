/**
 * 职业选拔只读视图选择器。
 *
 * 这里仅组合存档中的冻结 Selection 与 CareerProcess 审计结果，不从当前
 * 角色或干部属性重新计算分数，保证刷新、读档和历史记录展示完全一致。
 */

import {
  RELATIVE_SELECTION_STAGES,
  type RelativeSelectionStage,
  type RelativeSelectionStageResult,
  type SelectionCandidateStageResult,
  type SelectionFailure,
} from '../../domain/career/state';
import type { CareerProcess } from '../../domain/career/state';
import type { PlayerSave } from '../../types/player';
import type { StaffingSelection } from '../../types/organization';

const STAGE_LABELS: Record<RelativeSelectionStage, string> = {
  eligibility_review: '资格审查',
  democratic_recommendation: '民主推荐',
  organization_inspection: '组织考察',
  collective_decision: '集体决定',
  public_notice: '公示',
  appointment: '任职决定',
};

type SelectionStageView = {
  stage: RelativeSelectionStage;
  label: string;
  status: 'completed' | 'current' | 'pending';
};

type SelectionOutcome =
  'in_progress' | 'appointed' | 'not_selected' | 'no_candidates' | 'selection_failed';

type SelectionView = {
  selectionId: string;
  vacancyId: string;
  opportunityId: string;
  processStatus: CareerProcess['status'];
  processActive: boolean;
  totalCandidates: number;
  survivorCount: number;
  stages: SelectionStageView[];
  stageProgress: SelectionStageView[];
  resolvedStageCount: number;
  playerRank: number | null;
  playerScore: number | null;
  playerRelativePerformance: string;
  playerEliminated: boolean;
  winnerId: string | null;
  winnerName: string | null;
  outcome: SelectionOutcome;
  failureCode: SelectionFailure['code'] | null;
  failureDetail: string | null;
  failure: SelectionFailure | null;
  rulesVersion: string | null;
};

function getProcess(state: Readonly<PlayerSave>): CareerProcess | null {
  const active = state.career.activeProcess;
  if (active) return active;
  return (
    [...(state.career.completedProcesses ?? [])]
      .reverse()
      .find((process) => Boolean(process.selectionId)) ?? null
  );
}

function getSelection(
  state: Readonly<PlayerSave>,
  process: CareerProcess,
): StaffingSelection | null {
  if (!process.selectionId) return null;
  return (
    state.organization.selections.find(
      (selection) => selection.selectionId === process.selectionId,
    ) ?? null
  );
}

function stageResults(
  selection: StaffingSelection,
  process: CareerProcess,
): RelativeSelectionStageResult[] {
  if (selection.stageResults?.length) return selection.stageResults;
  if (selection.stageAudits.length) {
    return selection.stageAudits.map((audit) => ({
      stage: audit.stage,
      resolvedAtDay: audit.resolvedAtDay,
      candidates: audit.candidates ?? [],
      survivingCandidateIds: [...audit.survivingCandidateIds],
    }));
  }
  return process.stageResults
    .filter(
      (result): result is typeof result & { candidateResults: SelectionCandidateStageResult[] } =>
        Array.isArray(result.candidateResults),
    )
    .map((result) => ({
      stage: result.stage as RelativeSelectionStage,
      resolvedAtDay: result.resolvedAtDay,
      candidates: result.candidateResults,
      survivingCandidateIds: result.survivingCandidateIds ?? [],
    }));
}

function findPlayerId(selection: StaffingSelection): string | null {
  return (
    selection.candidates.find((candidate) => candidate.candidateType === 'player')?.candidateId ??
    null
  );
}

function resolveWinnerId(selection: StaffingSelection, process: CareerProcess): string | null {
  return selection.winnerId ?? selection.winner?.id ?? process.winnerId ?? null;
}

function formatPlayerPerformance(
  playerRank: number | null,
  playerScore: number | null,
  playerEliminated: boolean,
  eliminatedStage: RelativeSelectionStage | null,
): string {
  if (playerEliminated && eliminatedStage) return `已在${STAGE_LABELS[eliminatedStage]}淘汰`;
  if (playerRank === null) return '尚未产生排名';
  if (playerRank === 1) return '暂列第 1 名';
  const scoreGap = playerScore === null ? 0 : playerScore;
  return `暂列第 ${playerRank} 名，距第 1 名 ${scoreGap} 分`;
}

function getWinnerName(
  state: Readonly<PlayerSave>,
  selection: StaffingSelection,
  winnerId: string | null,
  playerId: string | null,
): string | null {
  if (!winnerId) return null;
  if (winnerId === playerId || selection.winner?.type === 'player') return '玩家';
  return state.organization.cadres.find((cadre) => cadre.cadreId === winnerId)?.name ?? winnerId;
}

/**
 * 读取当前或最近一次相对选拔的稳定展示视图。
 *
 * @param state 只读玩家存档
 * @returns 选拔展示数据；不存在可关联 Selection 时返回 null
 */
export function selectCareerSelectionView(state: Readonly<PlayerSave>): SelectionView | null {
  const process = getProcess(state);
  if (!process?.selectionId) return null;
  const selection = getSelection(state, process);
  if (!selection) return null;

  const results = stageResults(selection, process);
  const playerId = findPlayerId(selection);
  const lastPlayerResult = playerId
    ? [...results]
        .reverse()
        .find((result) => result.candidates.some((item) => item.candidateId === playerId))
    : undefined;
  const playerResult = lastPlayerResult?.candidates.find((item) => item.candidateId === playerId);
  const terminal =
    selection.status === 'completed' ||
    selection.status === 'failed' ||
    selection.status === 'cancelled';
  const terminalSurvivors = results.at(-1)?.survivingCandidateIds ?? [];
  const eliminatedStage =
    [...results]
      .reverse()
      .find((result) =>
        result.candidates.some((item) => item.candidateId === playerId && item.eliminated),
      )?.stage ?? null;
  const playerEliminated =
    playerId !== null &&
    (results.some((result) =>
      result.candidates.some((item) => item.candidateId === playerId && item.eliminated),
    ) ||
      (terminal && !terminalSurvivors.includes(playerId)));
  const failure = selection.failure ?? process.failure ?? null;
  const winnerId = resolveWinnerId(selection, process);
  const winnerIsNpc =
    selection.winner?.type === 'npc' || (winnerId !== null && winnerId !== playerId);
  const opportunity = state.career.opportunities.find((item) => item.id === process.opportunityId);
  const outcome: SelectionOutcome =
    failure?.code === 'no_qualified_candidates'
      ? 'no_candidates'
      : playerEliminated || winnerIsNpc
        ? 'not_selected'
        : failure
          ? 'selection_failed'
          : !terminal
            ? 'in_progress'
            : winnerId === playerId && opportunity?.finalOutcome === 'appointed'
              ? 'appointed'
              : process.id === state.career.activeProcess?.id && winnerId === playerId
                ? 'in_progress'
                : 'not_selected';
  const resolvedStages = new Set(results.map((result) => result.stage));
  const currentStage = selection.currentStage;
  const stages = RELATIVE_SELECTION_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    status: resolvedStages.has(stage)
      ? ('completed' as const)
      : !terminal && stage === currentStage
        ? ('current' as const)
        : ('pending' as const),
  }));
  const topScore = lastPlayerResult
    ? Math.max(...lastPlayerResult.candidates.map((candidate) => candidate.score))
    : null;

  return {
    selectionId: selection.selectionId,
    vacancyId: process.vacancyId ?? selection.vacancyId,
    opportunityId: process.opportunityId,
    processStatus: process.status,
    processActive: state.career.activeProcess?.id === process.id,
    totalCandidates: selection.candidates.length,
    survivorCount:
      failure?.code === 'no_qualified_candidates'
        ? 0
        : (results.at(-1)?.survivingCandidateIds.length ?? selection.candidates.length),
    stages,
    stageProgress: stages,
    resolvedStageCount: results.length,
    playerRank: playerResult?.rank ?? null,
    playerScore: playerResult?.score ?? null,
    playerRelativePerformance: formatPlayerPerformance(
      playerResult?.rank ?? null,
      topScore === null || playerResult?.score === null || playerResult?.score === undefined
        ? null
        : topScore - playerResult.score,
      playerEliminated,
      eliminatedStage,
    ),
    playerEliminated,
    winnerId,
    winnerName: getWinnerName(state, selection, winnerId, playerId),
    outcome,
    failureCode: failure?.code ?? null,
    failureDetail: failure?.detail ?? null,
    failure,
    rulesVersion: selection.rulesVersion ?? null,
  };
}
