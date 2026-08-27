/**
 * Relative staffing Selection 的完整存档事务适配层。
 *
 * 本模块只负责把可变 PlayerSave 转成一次性的冻结候选快照，并将纯
 * Selection Engine 的结果原子提交；阶段推进永远不重新读取干部事实。
 */

import { unwrap } from 'solid-js/store';
import type {
  CareerOpportunity,
  CareerProcess,
  CareerAssessmentRecord,
  CareerExperience,
  CareerRestriction,
} from '../../domain/career/state';
import type { PlayerSave } from '../../types/player';
import type {
  OrganizationState,
  SelectionCandidateInput,
  RelativeStaffingSelection,
} from '../../types/organization';
import { buildSelectionCandidatePool } from '../../engine/career/relative-candidate-pool';
import { createRelativeSelection } from '../../engine/career/relative-selection-lifecycle';
import { beginVacancySelection } from '../../engine/organization/vacancy-selection-lifecycle';
import { getConfigLoader } from '../../config/loader';

type SelectionTransactionResult =
  | { success: true; state: PlayerSave; selection: RelativeStaffingSelection }
  | { success: false; error: string; detail: string };

function cloneSave(draft: PlayerSave): PlayerSave {
  return structuredClone(unwrap(draft));
}

function average(values: readonly number[], fallback: number): number {
  return values.length === 0
    ? fallback
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function activeRestrictions(restrictions: readonly CareerRestriction[], day: number): string[] {
  return restrictions
    .filter((restriction) => restriction.startedAtDay <= day)
    .filter((restriction) => restriction.endsAtDay === null || day < restriction.endsAtDay)
    .map((restriction) => restriction.type);
}

function assessmentsFromExperiences(
  experiences: readonly CareerExperience[],
): CareerAssessmentRecord[] {
  return experiences.flatMap((experience) => experience.assessmentResults);
}

function earliestServiceDay(experiences: readonly CareerExperience[], fallback: number): number {
  const starts = experiences.map((experience) => experience.startedAtDay);
  return Math.min(...starts, fallback);
}

function specialtyAverage(specialties: Record<string, number>): number {
  return average(Object.values(specialties), 0);
}

function playerCandidate(
  state: PlayerSave,
  day: number,
  daysPerYear: number,
): SelectionCandidateInput {
  const appointment = state.career.appointment;
  const assessments = assessmentsFromExperiences(state.career.experiences);
  const assessment = average(
    assessments.map((item) => item.score),
    50,
  );
  return {
    candidateId: 'player',
    candidateType: 'player',
    currentPositionId: appointment.status === 'active' ? appointment.positionId : null,
    institutionId: appointment.status === 'active' ? appointment.institutionId : null,
    regionId: appointment.status === 'active' ? appointment.regionId : null,
    leadershipRank: appointment.status === 'active' ? appointment.leadershipRank : 'none',
    civilServiceRank: state.career.civilServiceRank,
    appointmentStartedAtDay: appointment.status === 'active' ? appointment.startedAtDay : null,
    serviceStartedAtDay: earliestServiceDay(
      state.career.experiences,
      state.career.civilServiceRankStartedAtDay,
    ),
    assessments,
    specialties: structuredClone(state.career.specialties),
    restrictionTypes: activeRestrictions(state.career.restrictions, day),
    scoringInputs: {
      assessment,
      specialty: specialtyAverage(state.career.specialties),
      service: Math.min(
        100,
        Math.max(
          0,
          ((day -
            earliestServiceDay(
              state.career.experiences,
              state.career.civilServiceRankStartedAtDay,
            )) /
            daysPerYear) *
            100,
        ),
      ),
      network: state.character.network,
      integrity: state.character.integrity,
    },
  };
}

function cadreCandidate(
  cadre: OrganizationState['cadres'][number],
  day: number,
  daysPerYear: number,
): SelectionCandidateInput {
  const appointment =
    cadre.currentAppointment?.status === 'active' ? cadre.currentAppointment : null;
  const latestExperience = [...cadre.experiences].sort(
    (left, right) => right.startedAtDay - left.startedAtDay || right.id.localeCompare(left.id),
  )[0];
  const experience = appointment ? null : latestExperience;
  const assessments = structuredClone(
    cadre.assessments.length > 0
      ? cadre.assessments
      : assessmentsFromExperiences(cadre.experiences),
  );
  const assessment = average(
    assessments.map((item) => item.score),
    50,
  );
  const specialties = structuredClone(cadre.specialties);
  const serviceStartedAtDay = earliestServiceDay(
    cadre.experiences,
    cadre.civilServiceRankStartedAtDay,
  );
  return {
    candidateId: cadre.cadreId,
    candidateType: 'npc',
    currentPositionId: appointment?.positionId ?? experience?.positionId ?? null,
    institutionId: appointment?.institutionId ?? experience?.institutionId ?? null,
    regionId: appointment?.regionId ?? experience?.regionId ?? null,
    leadershipRank: appointment?.leadershipRank ?? experience?.leadershipRank ?? 'none',
    civilServiceRank: cadre.civilServiceRank,
    appointmentStartedAtDay: appointment?.startedAtDay ?? experience?.startedAtDay ?? null,
    serviceStartedAtDay,
    assessments,
    specialties,
    restrictionTypes: activeRestrictions(cadre.restrictions, day),
    scoringInputs: {
      assessment,
      specialty: specialtyAverage(specialties),
      service: Math.min(100, Math.max(0, ((day - serviceStartedAtDay) / daysPerYear) * 100)),
      network: 0,
      integrity: assessment,
    },
  };
}

function candidateInputs(
  state: PlayerSave,
  day: number,
  daysPerYear: number,
): SelectionCandidateInput[] {
  return [
    playerCandidate(state, day, daysPerYear),
    ...state.organization.cadres
      .filter((cadre) => cadre.status === 'active')
      .map((cadre) => cadreCandidate(cadre, day, daysPerYear)),
  ];
}

/**
 * 接受需要相对选拔的机会，并原子建立 Vacancy、Selection 和 CareerProcess。
 *
 * @param draft 完整 PlayerSave 草稿
 * @param opportunity 待接受且绑定 Vacancy 的机会
 * @param processId 已分配的玩家 CareerProcess ID
 * @param currentDay Selection 创建日
 * @param idFactory 运行时 ID 工厂（此事务不应调用其生成 Vacancy ID）
 * @param rng 创建时唯一允许调用的随机源
 * @returns 成功时返回未提交的完整事务副本；失败时 draft 保持不变
 */
export function createRelativeSelectionInTransaction(
  draft: PlayerSave,
  opportunity: Exclude<CareerOpportunity, { type: 'training' }>,
  processId: string,
  currentDay: number,
  idFactory: () => string,
  rng: () => number,
): SelectionTransactionResult {
  if (!opportunity.requiresSelection || !opportunity.vacancyId)
    return { success: false, error: 'selection_required', detail: '机会没有绑定选拔 Vacancy' };
  const transaction = cloneSave(draft);
  const vacancy = transaction.organization.vacancies.find(
    (item) => item.vacancyId === opportunity.vacancyId,
  );
  if (!vacancy)
    return { success: false, error: 'vacancy_not_found', detail: '机会绑定的 Vacancy 不存在' };
  if (vacancy.status !== 'open' || vacancy.selectionId !== null)
    return {
      success: false,
      error: 'vacancy_not_open',
      detail: '机会绑定的 Vacancy 不是 open 状态',
    };
  const rules = getConfigLoader().getRelativeSelectionConfig();
  const gameConfig = getConfigLoader().getGameConfig();
  const inputs = candidateInputs(
    transaction,
    currentDay,
    gameConfig.daysPerMonth * gameConfig.monthsPerYear,
  );
  if (new Set(inputs.map((candidate) => candidate.candidateId)).size !== inputs.length)
    return { success: false, error: 'duplicate_candidate', detail: '候选人稳定 ID 重复' };
  const candidates = buildSelectionCandidatePool(inputs, rules, currentDay);
  const randomDraws = Array.from({ length: candidates.length * 6 }, () => {
    const draw = rng();
    return draw;
  });
  const selectionId = idFactory();
  const created = createRelativeSelection({
    selectionId,
    vacancyId: vacancy.vacancyId,
    startedAtDay: currentDay,
    candidates: inputs,
    rules,
    randomDraws,
    playerCareerProcessId: processId,
  });
  if (!created.success) return { success: false, error: created.error, detail: created.detail };
  const selection = created.selection;
  const opportunityIndex = transaction.career.opportunities.findIndex(
    (item) => item.id === opportunity.id,
  );
  if (opportunityIndex < 0)
    return { success: false, error: 'opportunity_not_found', detail: '机会在事务副本中不存在' };
  const process: CareerProcess = {
    id: processId,
    type: 'leadership_selection',
    status: 'active',
    opportunityId: opportunity.id,
    selectionId,
    vacancyId: vacancy.vacancyId,
    currentStage: 'eligibility_review',
    startedAtDay: currentDay,
    completedAtDay: null,
    stageResults: [],
    winnerId: null,
    failure: null,
  };
  const accepted = transaction.career.opportunities[opportunityIndex];
  if (!accepted)
    return { success: false, error: 'opportunity_not_found', detail: '机会在事务副本中不存在' };
  accepted.status = 'in_process';
  transaction.organization.selections.push(selection);
  if (selection.status === 'failed') {
    vacancy.selectionId = null;
    const resolved = transaction.career.opportunities[opportunityIndex];
    if (!resolved)
      return { success: false, error: 'opportunity_not_found', detail: '机会在事务副本中不存在' };
    resolved.status = 'resolved';
    resolved.resolvedAtDay = currentDay;
    resolved.finalOutcome = 'not_selected';
    process.status = 'failed';
    process.completedAtDay = currentDay;
    process.failure = selection.failure;
    transaction.career.completedProcesses.push(process);
    transaction.career.activeProcess = null;
    return { success: true, state: transaction, selection };
  }
  const begun = beginVacancySelection({
    organization: transaction.organization,
    currentDay,
    idFactory,
    vacancyId: vacancy.vacancyId,
    selectionId,
  });
  if (!begun.success || !begun.vacancy)
    return {
      success: false,
      error: begun.success ? 'selection_failed' : begun.error,
      detail: begun.success ? 'Selection 未绑定 Vacancy' : begun.detail,
    };
  transaction.organization = begun.organization;
  transaction.career.activeProcess = process;
  return {
    success: true,
    state: transaction,
    selection: transaction.organization.selections.find(
      (item) => item.selectionId === selectionId,
    ) as RelativeStaffingSelection,
  };
}

/**
 * 将组织 Selection 以强类型返回，供 reducer 在冻结契约上推进。
 *
 * @param organization 组织状态
 * @param selectionId Selection 标识
 * @returns 新契约 Selection；缺少 Schema 14 强字段时返回 null
 */
export function getRelativeSelection(
  organization: OrganizationState,
  selectionId: string,
): RelativeStaffingSelection | null {
  const selection = organization.selections.find((item) => item.selectionId === selectionId);
  if (
    !selection ||
    !selection.rulesVersion ||
    !selection.stageResults ||
    selection.winnerId === undefined ||
    selection.failure === undefined
  )
    return null;
  return selection as RelativeStaffingSelection;
}

/** @param selection 组织 Selection @returns 是否仍保留玩家候选 */
export function selectionHasPlayer(selection: RelativeStaffingSelection): boolean {
  const latest = selection.stageResults.at(-1);
  return !latest || latest.survivingCandidateIds.includes('player');
}
