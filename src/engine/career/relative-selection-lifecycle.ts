/**
 * Pure creation and stage advancement for relative staff selections.
 *
 * A Selection owns all inputs needed for replay: candidate snapshots, rules
 * version, and random draws. Advancement never reads mutable world state.
 */
import {
  RELATIVE_SELECTION_STAGES,
  type RelativeSelectionStage,
  type RelativeSelectionStageResult,
  type SelectionFailure,
} from '../../domain/career/state';
import type {
  AdvanceRelativeSelectionInput,
  CreateRelativeSelectionInput,
  RelativeSelectionLifecycleResult,
  SelectionCandidateSnapshot,
  RelativeStaffingSelection,
  SeatOccupantRef,
} from '../../types/organization';
import {
  buildSelectionCandidatePool,
  createSelectionCandidateSnapshot,
} from './relative-candidate-pool';
import { scoreRelativeSelectionStage } from './relative-scoring';
function failure(
  code: SelectionFailure['code'],
  stage: RelativeSelectionStage | null,
  detail: string,
): SelectionFailure {
  return { code, stage, detail };
}
function occupantForCandidate(candidate: SelectionCandidateSnapshot): SeatOccupantRef {
  return candidate.candidateType === 'player'
    ? { type: 'player', id: 'player' }
    : { type: 'npc', id: candidate.candidateId };
}
/**
 * Create a Selection by freezing normalized, qualified candidates and inputs.
 *
 * @param input creation facts and complete random input
 * @returns newly created Selection, including a structured empty-pool failure
 */
export function createRelativeSelection(
  input: CreateRelativeSelectionInput,
): RelativeSelectionLifecycleResult {
  const candidates = buildSelectionCandidatePool(
    input.candidates,
    input.rules,
    input.startedAtDay,
    input.eligibilityContext,
  );
  const requiredDrawCount = candidates.length * RELATIVE_SELECTION_STAGES.length;
  if (
    input.randomDraws.length < requiredDrawCount ||
    input.randomDraws.some((draw) => !Number.isFinite(draw) || draw < 0 || draw > 1)
  )
    return {
      success: false,
      error: 'invalid_random_draws',
      detail: '随机输入必须包含每位候选人六阶段所需的 [0,1] 数值',
    };
  const selection: RelativeStaffingSelection = {
    selectionId: input.selectionId,
    vacancyId: input.vacancyId,
    status: candidates.length === 0 ? 'failed' : 'active',
    currentStage: RELATIVE_SELECTION_STAGES[0],
    startedAtDay: input.startedAtDay,
    completedAtDay: candidates.length === 0 ? input.startedAtDay : null,
    candidates,
    stageAudits: [],
    winner: null,
    playerCareerProcessId: input.playerCareerProcessId ?? null,
    randomDraws: [...input.randomDraws],
    rulesVersion: input.rules.rulesVersion,
    stageResults: [],
    winnerId: null,
    failure:
      candidates.length === 0
        ? failure('no_qualified_candidates', null, '没有符合资格的候选人')
        : null,
  };
  return { success: true, selection };
}
function currentSurvivors(selection: RelativeStaffingSelection): SelectionCandidateSnapshot[] {
  const last = selection.stageResults.at(-1);
  if (!last) return selection.candidates.map(createSelectionCandidateSnapshot);
  const candidatesById = new Map(
    selection.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  return last.survivingCandidateIds.flatMap((candidateId) => {
    const candidate = candidatesById.get(candidateId);
    return candidate ? [createSelectionCandidateSnapshot(candidate)] : [];
  });
}
/**
 * Advance exactly one fixed stage using only Selection-owned frozen inputs.
 *
 * @param input Selection, resolution day, and the same frozen rules
 * @returns detached Selection with one appended stage audit
 */
export function advanceRelativeSelectionStage(
  input: AdvanceRelativeSelectionInput,
): RelativeSelectionLifecycleResult {
  const selection = structuredClone(input.selection);
  if (selection.rulesVersion !== input.rules.rulesVersion)
    return { success: false, error: 'rules_mismatch', detail: '冻结规则版本不匹配' };
  const requiredDrawCount = selection.candidates.length * RELATIVE_SELECTION_STAGES.length;
  if (
    selection.randomDraws.length < requiredDrawCount ||
    selection.randomDraws.some((draw) => !Number.isFinite(draw) || draw < 0 || draw > 1)
  )
    return {
      success: false,
      error: 'invalid_random_draws',
      detail: '冻结随机输入不完整或包含非法数值',
    };
  if (selection.status === 'failed' || selection.status === 'completed')
    return { success: true, selection };
  const stageIndex = selection.stageResults.length;
  const stage = RELATIVE_SELECTION_STAGES[stageIndex];
  if (!stage) return { success: false, error: 'invalid_stage', detail: '选拔阶段序列已耗尽' };
  const stageConfig = input.rules.stages[stageIndex];
  if (!stageConfig || stageConfig.id !== stage)
    return { success: false, error: 'rules_mismatch', detail: '阶段规则顺序不匹配' };
  const survivors = currentSurvivors(selection);
  const drawOffset = selection.stageResults.reduce(
    (total, result) => total + result.candidates.length,
    0,
  );
  let candidateResults = scoreRelativeSelectionStage(
    survivors,
    stageConfig,
    selection.randomDraws,
    drawOffset,
  );
  let survivingCandidateIds = candidateResults
    .filter((candidate) => !candidate.eliminated)
    .map((candidate) => candidate.candidateId);
  const result: RelativeSelectionStageResult = {
    stage,
    resolvedAtDay: input.resolvedAtDay,
    candidates: candidateResults,
    survivingCandidateIds,
  };
  selection.stageResults = [...selection.stageResults, result];
  selection.stageAudits = [
    ...selection.stageAudits,
    {
      stage,
      resolvedAtDay: input.resolvedAtDay,
      survivingCandidateIds: [...survivingCandidateIds],
      candidates: candidateResults,
      detail: `${stage} stage resolved`,
    },
  ];
  if (survivingCandidateIds.length === 0) {
    selection.status = 'failed';
    selection.completedAtDay = input.resolvedAtDay;
    selection.failure = failure('stage_no_survivors', stage, '本阶段没有幸存候选人');
    return { success: true, selection };
  }
  if (stageConfig.requiresUniqueWinner) {
    const highest = candidateResults[0]?.score;
    const tied = candidateResults.filter(
      (candidate) => !candidate.eliminated && candidate.score === highest,
    );
    if (tied.length > 1) {
      selection.status = 'failed';
      selection.completedAtDay = input.resolvedAtDay;
      selection.failure = failure('no_unique_winner', stage, '最高分候选人并列，无法产生唯一赢家');
      return { success: true, selection };
    }
    const winner = candidateResults[0];
    if (!winner) return { success: false, error: 'invalid_stage', detail: '阶段没有评分结果' };
    candidateResults = candidateResults.map((candidate) => ({
      ...candidate,
      eliminated: candidate.candidateId !== winner.candidateId,
    }));
    survivingCandidateIds = [winner.candidateId];
    const finalResult = selection.stageResults.at(-1);
    const finalAudit = selection.stageAudits.at(-1);
    const winningCandidate = survivors.find(
      (candidate) => candidate.candidateId === winner.candidateId,
    );
    if (!finalResult || !finalAudit || !winningCandidate)
      return { success: false, error: 'invalid_stage', detail: '阶段审计结果不完整' };
    finalResult.candidates = candidateResults;
    finalResult.survivingCandidateIds = survivingCandidateIds;
    finalAudit.candidates = candidateResults;
    finalAudit.survivingCandidateIds = survivingCandidateIds;
    selection.status = 'completed';
    selection.completedAtDay = input.resolvedAtDay;
    selection.winnerId = winner.candidateId;
    selection.winner = occupantForCandidate(winningCandidate);
  } else {
    selection.currentStage = RELATIVE_SELECTION_STAGES[stageIndex + 1] ?? stage;
  }
  return { success: true, selection };
}
