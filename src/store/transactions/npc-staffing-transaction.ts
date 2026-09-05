/**
 * NPC 自主补员事务：玩家机会缺位时，组织以同一相对选拔框架自行填补 Vacancy。
 *
 * 本事务只在统一时间轴的 `npc_staffing` 节点内调用，作用于"非初始编制、
 * 已过补员延迟、且没有处于可接受状态的玩家机会"的 open Vacancy。候选池、
 * 资格判定、评分与赢家唯一性全部复用相对选拔引擎，与玩家参与的选拔共享
 * 同一契约；赢家任职复用 NPC 任职事务，从而天然产生原岗位级联 Vacancy。
 *
 * 重试与幂等语义：
 * - 永久消费键 `npc-staffing:{vacancyId}` 只在 Vacancy 被成功填补后写入；
 * - 失败（空候选池 / 阶段无幸存者 / 无唯一赢家）不写永久键，Vacancy 保持
 *   合法 open，按 `npcStaffingRetryIntervalDays` 无状态退避在后续日期重试，
 *   让随时间变化的资格事实（经历、考核、冲突解除）可以重新产生合格候选；
 * - 当日尝试键 `npc-staffing:{vacancyId}:{day}` 保证同日 continuation 重放
 *   不会重复创建同一次 attempt；
 * - 整个 attempt 在状态副本上执行，任何结构性失败都不会把半完成的
 *   Selection/键泄漏到调用方。
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
  /** 本 attempt 创建的 Selection 稳定 ID；未创建时为 null */
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
 * 自主补员；玩家机会处于 available/in_process 时等待玩家决定；永久消费键
 * 表示该空缺已成功填补；当日尝试键保证同日重放不重复创建 attempt。
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
  const keys = draft.organization.processedProducerKeys;
  // 该空缺已被成功填补（永久消费事实）。
  if (keys.includes(`npc-staffing:${vacancyId}`)) return false;
  // 同日已尝试过：continuation 重放不重复创建同一次 attempt。
  if (keys.includes(`npc-staffing:${vacancyId}:${currentDay}`)) return false;
  const config = getConfigLoader().getGameConfig();
  const overdueDays = currentDay - vacancy.openedAtDay - config.npcStaffingDelayDays;
  if (overdueDays < 0) return false;
  // 无状态退避：失败后按固定间隔重试，让资格事实有时间变化。
  if (overdueDays % config.npcStaffingRetryIntervalDays !== 0) return false;
  const linkedOpportunities = draft.career.opportunities.filter(
    (opportunity) => opportunity.vacancyId === vacancyId,
  );
  const playerWindowActive = linkedOpportunities.some(
    (opportunity) => opportunity.status === 'available' || opportunity.status === 'in_process',
  );
  return !playerWindowActive;
}

/**
 * 对单个达到条件的 Vacancy 执行 NPC-only 相对选拔并尝试完成任职。
 *
 * 整个 attempt 在状态副本上原子执行：除"失败 Selection 审计 + 当日键"与
 * "成功填补"两个完整终态外，任何结构性失败都不会修改调用方状态。
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
  if (!isNpcStaffingDue(draft, vacancyId, currentDay)) return skip('not_due');
  const vacancy = draft.organization.vacancies.find((item) => item.vacancyId === vacancyId);
  if (!vacancy) return skip('vacancy_not_found');
  const seat = draft.organization.seats.find((item) => item.seatId === vacancy.seatId);
  if (!seat || seat.occupant !== null) return skip('seat_occupied');

  const transaction = structuredClone(draft);
  const transactionVacancy = transaction.organization.vacancies.find(
    (item) => item.vacancyId === vacancyId,
  );
  if (!transactionVacancy) return skip('vacancy_not_found');

  const loader = getConfigLoader();
  const rules = loader.getRelativeSelectionConfig();
  const gameConfig = loader.getGameConfig();
  const daysPerYear = gameConfig.daysPerMonth * gameConfig.monthsPerYear;
  const conflictingCandidateIds = [
    ...new Set(
      transaction.organization.selections
        .filter((selection) => selection.status === 'pending' || selection.status === 'active')
        .flatMap((selection) => selection.candidates.map((candidate) => candidate.candidateId)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const eligibilityContext: SelectionVacancyEligibilityContext = {
    vacancyId: transactionVacancy.vacancyId,
    positionId: transactionVacancy.positionId,
    institutionId: transactionVacancy.institutionId,
    regionId: transactionVacancy.regionId,
    positionDomain: transactionVacancy.positionDomain,
    sourceType: transactionVacancy.sourceType,
    conflictingCandidateIds,
  };

  // 岗位没有相对选拔 scope 时（如科员编制）不存在 NPC 选拔空间，直接跳过。
  const hasScope = rules.eligibility.vacancyScopes.some(
    (scope) => scope.targetPositionId === transactionVacancy.positionId,
  );
  if (!hasScope) return skip('no_vacancy_scope');
  const npcInputs = buildNpcSelectionCandidateInputs(transaction, currentDay, daysPerYear);
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
  let selection = created.selection;
  // 当前没有合格候选：引擎返回 terminal failed 而非失败结果。此时不进入
  // begin/推进，也不写任何键——空缺保持合法 open，等待资格事实变化后重试。
  if (selection.status === 'failed') return skip('no_qualified_candidates');

  transaction.organization.selections.push(selection);
  transaction.organization.processedProducerKeys.push(`npc-staffing:${vacancyId}:${currentDay}`);

  const began = beginVacancySelection({
    organization: transaction.organization,
    currentDay,
    idFactory,
    vacancyId,
    selectionId,
  });
  if (!began.success) return skip(`vacancy_begin_failed:${began.error}`);
  transaction.organization = began.organization;

  // 与玩家被淘汰后的结算一致：剩余阶段在同一事务内有界结算完毕。
  for (let stage = 0; stage < 6; stage += 1) {
    const advanced = advanceRelativeSelectionStage({
      selection,
      resolvedAtDay: currentDay,
      rules,
    });
    if (!advanced.success) return skip(`stage_failed:${advanced.error}`);
    selection = advanced.selection;
    if (selection.status === 'completed' || selection.status === 'failed') break;
  }
  const selectionIndex = transaction.organization.selections.findIndex(
    (item) => item.selectionId === selectionId,
  );
  if (selectionIndex >= 0) transaction.organization.selections[selectionIndex] = selection;

  if (selection.status === 'failed' || selection.winnerId === null) {
    // 失败审计：保留 terminal failed Selection 与当日键，Vacancy 重开为 open；
    // 不写永久消费键，后续按退避间隔重试。
    const failedVacancy = transaction.organization.vacancies.find(
      (item) => item.vacancyId === vacancyId,
    );
    if (failedVacancy && failedVacancy.status === 'selecting') {
      failedVacancy.status = 'open';
      failedVacancy.selectionId = null;
    }
    Object.assign(draft, transaction);
    return { staffed: false, reason: 'selection_failed', selectionId, winnerId: null };
  }

  const appointed = appointNpcSelectionWinnerInTransaction(transaction, {
    selectionId,
    vacancyId,
    cadreId: selection.winnerId,
    currentDay,
    idFactory,
  });
  if (!appointed.success) return skip(`appointment_failed:${appointed.error}`);
  processCascadeSignalsInTransaction(
    transaction,
    appointed.emittedSignals,
    currentDay,
    rng,
    idFactory,
    definitions,
  );
  // 成功填补：永久消费键阻止同一空缺实例再次补员。
  transaction.organization.processedProducerKeys.push(`npc-staffing:${vacancyId}`);
  Object.assign(draft, transaction);
  return { staffed: true, reason: null, selectionId, winnerId: selection.winnerId };
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
