/**
 * NPC 自主补员事务：玩家机会缺位时，组织以同一相对选拔框架自行填补 Vacancy。
 *
 * 本事务只在统一时间轴的 `npc_staffing` 节点内调用，作用于"非初始编制、
 * 已过补员延迟、且没有处于可接受状态的玩家机会"的 open Vacancy。候选池、
 * 资格判定、评分与赢家唯一性全部复用相对选拔引擎，与玩家参与的选拔共享
 * 同一契约；赢家任职复用 NPC 任职事务，从而天然产生原岗位级联 Vacancy。
 */

import type { EventDefinition } from '../../domain/events/definition';
import {
  advanceRelativeSelectionStage,
  createRelativeSelection,
} from '../../engine/career/relative-selection-lifecycle';
import { beginVacancySelection } from '../../engine/organization/vacancy-selection-lifecycle';
import { getConfigLoader } from '../../config/loader';
import type { PlayerSave } from '../../types/player';
import type { SelectionVacancyEligibilityContext } from '../../types/organization';
import { buildNpcSelectionCandidateInputs } from './selection-transaction';
import { appointNpcSelectionWinnerInTransaction } from './npc-appointment-transaction';
import { processCascadeSignalsInTransaction } from '../reducers/event-reducer';

/** 单个 Vacancy 的 NPC 自主补员结果。 */
export interface NpcStaffingOutcome {
  /** 是否真实创建了选拔并完成任职（false 表示按契约跳过） */
  staffed: boolean;
  /** 跳过或失败原因；成功时为 null */
  reason: string | null;
  /** 新建 Selection 的稳定 ID；未创建时为 null */
  selectionId: string | null;
  /** 赢家干部 ID；未产生时为 null */
  winnerId: string | null;
}

function skip(reason: string): NpcStaffingOutcome {
  return { staffed: false, reason, selectionId: null, winnerId: null };
}

/**
 * 判断 Vacancy 当前是否达到 NPC 自主补员条件（不含候选池判定）。
 *
 * 初始编制（sourceType `system`）永远等待设计好的玩家机会管线，不参与
 * 自主补员；玩家机会处于 available/in_process 时等待玩家决定。
 *
 * @param draft 完整存档事务草稿
 * @param vacancyId 待检查的 Vacancy ID
 * @param currentDay 当前绝对日
 * @returns 是否应尝试 NPC 自主补员
 */
export function isNpcStaffingDue(
  draft: PlayerSave,
  vacancyId: string,
  currentDay: number,
): boolean {
  const vacancy = draft.organization.vacancies.find((item) => item.vacancyId === vacancyId);
  if (!vacancy) return false;
  if (vacancy.status !== 'open' || vacancy.selectionId !== null) return false;
  // 初始编制岗位等待玩家职业进程解锁机会窗口，不由世界自动补员。
  if (vacancy.sourceType === 'system') return false;
  // 每个空缺实例只允许一次补员尝试：失败（含并列/无合格候选之外的结构性失败）
  // 后保持 open，等待后续真实 producer 产生新空缺实例，避免每日重试污染存档。
  if (draft.organization.processedProducerKeys.includes(`npc-staffing:${vacancyId}`)) return false;
  const config = getConfigLoader().getGameConfig();
  if (currentDay < vacancy.openedAtDay + config.npcStaffingDelayDays) return false;
  const linkedOpportunities = draft.career.opportunities.filter(
    (opportunity) => opportunity.vacancyId === vacancyId,
  );
  const playerWindowActive = linkedOpportunities.some(
    (opportunity) => opportunity.status === 'available' || opportunity.status === 'in_process',
  );
  return !playerWindowActive;
}

/**
 * 对单个达到条件的 Vacancy 执行 NPC-only 相对选拔并完成任职。
 *
 * @param draft 完整存档事务草稿（由统一时间轴事务提供）
 * @param vacancyId 待补员的 Vacancy ID
 * @param currentDay 当前绝对日
 * @param rng 时间轴共享随机源（Selection 创建时一次性冻结）
 * @param idFactory 事务共享稳定 ID 工厂
 * @param definitions 事件定义目录（级联信号使用）
 * @returns 补员结果；跳过与失败均以 reason 区分，不抛错
 */
export function staffVacancyByNpcSelectionInTransaction(
  draft: PlayerSave,
  vacancyId: string,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): NpcStaffingOutcome {
  const vacancy = draft.organization.vacancies.find((item) => item.vacancyId === vacancyId);
  if (!vacancy) return skip('vacancy_not_found');
  if (vacancy.status !== 'open' || vacancy.selectionId !== null) return skip('vacancy_not_open');
  const seat = draft.organization.seats.find((item) => item.seatId === vacancy.seatId);
  if (!seat || seat.occupant !== null) return skip('seat_occupied');

  const loader = getConfigLoader();
  const rules = loader.getRelativeSelectionConfig();
  const gameConfig = loader.getGameConfig();
  const daysPerYear = gameConfig.daysPerMonth * gameConfig.monthsPerYear;
  const conflictingCandidateIds = [
    ...new Set(
      draft.organization.selections
        .filter((selection) => selection.status === 'pending' || selection.status === 'active')
        .flatMap((selection) => selection.candidates.map((candidate) => candidate.candidateId)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const eligibilityContext: SelectionVacancyEligibilityContext = {
    vacancyId: vacancy.vacancyId,
    positionId: vacancy.positionId,
    institutionId: vacancy.institutionId,
    regionId: vacancy.regionId,
    positionDomain: vacancy.positionDomain,
    sourceType: vacancy.sourceType,
    conflictingCandidateIds,
  };
  // 岗位没有相对选拔 scope 时（如科员编制）不存在 NPC 选拔空间，直接跳过，
  // 避免每日节点重复构建候选池。
  const hasScope = rules.eligibility.vacancyScopes.some(
    (scope) => scope.targetPositionId === vacancy.positionId,
  );
  if (!hasScope) return skip('no_vacancy_scope');
  const npcInputs = buildNpcSelectionCandidateInputs(draft, currentDay, daysPerYear);
  const selectionId = idFactory();
  const randomDraws = Array.from({ length: npcInputs.length * 6 }, () => rng());
  const created = createRelativeSelection({
    selectionId,
    vacancyId,
    startedAtDay: currentDay,
    candidates: npcInputs,
    rules,
    eligibilityContext,
    randomDraws,
  });
  if (!created.success) return skip(`selection_creation_failed:${created.error}`);
  const selection = created.selection;
  draft.organization.selections.push(selection);
  draft.organization.processedProducerKeys.push(`npc-staffing:${vacancyId}`);

  const began = beginVacancySelection({
    organization: draft.organization,
    currentDay,
    idFactory,
    vacancyId,
    selectionId,
  });
  if (!began.success) return skip(`vacancy_begin_failed:${began.error}`);
  draft.organization = began.organization;

  // 与玩家被淘汰后的结算一致：剩余阶段在同一事务内有界结算完毕。
  // createRelativeSelection 返回的强契约 Selection 持有全部冻结输入。
  let current = selection;
  for (let stage = 0; stage < 6; stage += 1) {
    const advanced = advanceRelativeSelectionStage({
      selection: current,
      resolvedAtDay: currentDay,
      rules,
    });
    if (!advanced.success) return skip(`stage_failed:${advanced.error}`);
    current = advanced.selection;
    if (current.status === 'completed' || current.status === 'failed') break;
  }
  const index = draft.organization.selections.findIndex((item) => item.selectionId === selectionId);
  if (index >= 0) draft.organization.selections[index] = current;

  if (current.status === 'failed' || current.winnerId === null) {
    const failedVacancy = draft.organization.vacancies.find((item) => item.vacancyId === vacancyId);
    if (failedVacancy && failedVacancy.status === 'selecting') {
      failedVacancy.status = 'open';
      failedVacancy.selectionId = null;
    }
    return { staffed: false, reason: 'selection_failed', selectionId, winnerId: null };
  }

  const appointed = appointNpcSelectionWinnerInTransaction(draft, {
    selectionId,
    vacancyId,
    cadreId: current.winnerId,
    currentDay,
    idFactory,
  });
  if (!appointed.success) return skip(`appointment_failed:${appointed.error}`);
  processCascadeSignalsInTransaction(
    draft,
    appointed.emittedSignals,
    currentDay,
    rng,
    idFactory,
    definitions,
  );
  return { staffed: true, reason: null, selectionId, winnerId: current.winnerId };
}

/**
 * 扫描全部达到补员条件的 open Vacancy 并依次尝试 NPC 自主补员。
 *
 * @param draft 完整存档事务草稿
 * @param currentDay 当前绝对日
 * @param rng 时间轴共享随机源
 * @param idFactory 事务共享稳定 ID 工厂
 * @param definitions 事件定义目录
 * @returns 实际完成补员的 Vacancy ID 列表
 */
export function runNpcStaffingDueVacancies(
  draft: PlayerSave,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): string[] {
  const dueVacancyIds = draft.organization.vacancies
    .filter((vacancy) => isNpcStaffingDue(draft, vacancy.vacancyId, currentDay))
    .map((vacancy) => vacancy.vacancyId)
    .sort((left, right) => left.localeCompare(right));
  const staffed: string[] = [];
  for (const vacancyId of dueVacancyIds) {
    const outcome = staffVacancyByNpcSelectionInTransaction(
      draft,
      vacancyId,
      currentDay,
      rng,
      idFactory,
      definitions,
    );
    if (outcome.staffed) staffed.push(vacancyId);
  }
  return staffed;
}
