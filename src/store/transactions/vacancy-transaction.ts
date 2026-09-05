/**
 * Vacancy Store 事务适配层。
 *
 * Engine 只负责纯生命周期转换；本模块负责把转换应用到完整 PlayerSave
 * 副本，并在成功后同步职业机会、producer 幂等账本和领域信号。
 */

import { unwrap } from 'solid-js/store';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import {
  cancelVacancy,
  expireVacancy,
  fillVacancy,
  openVacancy,
} from '../../engine/organization/vacancy-lifecycle';
import { produceCadreDepartureVacancies } from '../../engine/organization/vacancy-producers';
import { producePoliticalCycleVacancies } from '../../engine/organization/political-cycle';
import type { VacancyLifecycleResult } from '../../types/organization';
import type {
  OrganizationState,
  SeatOccupantRef,
  VacancyCancellationReason,
  VacancyInstance,
  VacancyLifecycleError,
  VacancyReason,
  VacancySourceType,
} from '../../types/organization';
import type { PlayerSave } from '../../types/player';
import {
  invalidateCareerOpportunity,
  resolveCareerOpportunity,
} from '../../engine/career/career-opportunity-lifecycle';

/** NPC departure producer 的稳定幂等键前缀。 */
export const VACANCY_PRODUCER_PREFIX = 'vacancy:cadre_lifecycle:';

/** 事务层额外诊断；Engine 原始业务错误通过 engine_error 保留。 */
export type VacancyTransactionError = VacancyLifecycleError;

/** 事务失败结果；失败时调用方的 PlayerSave 必须保持不变。 */
export interface VacancyTransactionFailure {
  success: false;
  error:
    VacancyTransactionError | 'producer_conflict' | 'opportunity_mismatch' | 'appointment_mismatch';
  detail: string;
}

/** 单个 Vacancy 变更的成功结果。 */
export interface VacancyMutationSuccess {
  success: true;
  vacancy: VacancyInstance;
  emittedSignals: DomainSignalSnapshot[];
}

/** 单个离任 producer 批次的成功结果。 */
export interface VacancyProducerSuccess {
  success: true;
  vacancies: VacancyInstance[];
  processedProducerKeys: string[];
  emittedSignals: DomainSignalSnapshot[];
}

/** 统一的 Vacancy 事务结果。 */
export type VacancyMutationResult = VacancyMutationSuccess | VacancyTransactionFailure;

/** 单席位 Vacancy 来源输入。 */
export interface ReleasedSeatVacancyInput {
  seatId: string;
  reason: VacancyReason;
  sourceType: VacancySourceType;
  sourceId: string;
  openedAtDay: number;
  closesAtDay: number | null;
  vacancyId?: string;
}

/** 周期调整释放席位的事务输入。 */
export interface PoliticalCycleVacancyInput {
  cycle: import('../../domain/world-state').PoliticalCycleState;
  seatIds: readonly string[];
}

/** Vacancy 填补输入；selection/opportunity 用于跨领域一致性校验。 */
export interface FillVacancyTransactionInput {
  vacancyId: string;
  occupant: SeatOccupantRef;
  appointmentId: string;
  selectionId: string | null;
  opportunityId: string | null;
  currentDay: number;
  idFactory: () => string;
  /** Previous appointment being replaced; null means a standalone fill. */
  previousAppointmentId: string | null;
  /** Reason for opening the released old Seat; must pair with previousAppointmentId. */
  releasedSeatReason: 'promotion' | 'lateral_transfer' | 'rotation' | null;
}

/** Vacancy 取消输入。 */
export interface CancelVacancyTransactionInput {
  vacancyId: string;
  cancellationReason: VacancyCancellationReason;
  opportunityId?: string | null;
  currentDay: number;
  idFactory: () => string;
}

/** Vacancy 到期输入。 */
export interface ExpireVacancyTransactionInput {
  vacancyId: string;
  currentDay: number;
  idFactory: () => string;
}

function failure(
  error: VacancyTransactionFailure['error'],
  detail: string,
): VacancyTransactionFailure {
  return { success: false, error, detail };
}

function cloneSave(draft: PlayerSave): PlayerSave {
  return structuredClone(unwrap(draft));
}

function assignSave(draft: PlayerSave, transaction: PlayerSave): void {
  Object.assign(draft, transaction);
}

function assignOrganization(draft: PlayerSave, organization: OrganizationState): void {
  draft.organization = organization;
}

function sameOccupant(left: SeatOccupantRef | null, right: SeatOccupantRef): boolean {
  return left?.type === right.type && left.id === right.id;
}

function engineFailure(result: VacancyLifecycleResult): VacancyTransactionFailure {
  if (result.success) throw new Error('Expected failed Vacancy Engine result');
  return failure(result.error, result.detail);
}

function vacancySuccess(
  result: VacancyLifecycleResult,
): VacancyMutationSuccess | VacancyTransactionFailure {
  if (!result.success || !result.vacancy) return engineFailure(result);
  return { success: true, vacancy: result.vacancy, emittedSignals: result.emittedSignals };
}

/**
 * 在 Vacancy 终态事务副本中统一失效关联机会及其玩家流程。
 *
 * @param transaction 待提交的完整事务副本
 * @param vacancyId 已关闭 Vacancy 的稳定标识
 * @param currentDay 关闭发生的绝对日
 */
function invalidateLinkedCareerState(
  transaction: PlayerSave,
  vacancyId: string,
  currentDay: number,
): void {
  const linked = transaction.career.opportunities.filter(
    (opportunity) =>
      opportunity.vacancyId === vacancyId &&
      (opportunity.status === 'available' ||
        opportunity.status === 'accepted' ||
        opportunity.status === 'in_process'),
  );
  for (const opportunity of linked) {
    const result = invalidateCareerOpportunity(opportunity, currentDay);
    if (!result.success || !result.opportunity) continue;
    const index = transaction.career.opportunities.findIndex(
      (candidate) => candidate.id === opportunity.id,
    );
    if (index >= 0) transaction.career.opportunities[index] = result.opportunity;
  }

  const activeProcess = transaction.career.activeProcess;
  if (!activeProcess) return;
  const activeOpportunity = transaction.career.opportunities.find(
    (opportunity) => opportunity.id === activeProcess.opportunityId,
  );
  if (activeOpportunity?.vacancyId !== vacancyId) return;
  activeProcess.stageResults.push({
    stage: activeProcess.currentStage,
    resolvedAtDay: currentDay,
    outcome: 'cancelled',
    score: null,
    detail: `关联 Vacancy ${vacancyId} 已关闭`,
  });
  activeProcess.status = 'cancelled';
  activeProcess.completedAtDay = currentDay;
  transaction.career.completedProcesses.push(structuredClone(activeProcess));
  transaction.career.activeProcess = null;
}

/**
 * 消费所有未处理 NPC 离任事实并创建动态 Vacancy。
 *
 * @param draft 完整 PlayerSave 草稿
 * @param currentDay 当前绝对日（用于防止未来事实被提前消费）
 * @param idFactory 运行时 ID 工厂（传给 Engine）
 * @returns 批量创建结果；业务失败不修改 draft
 */
export function consumeCadreDeparturesInTransaction(
  draft: PlayerSave,
  currentDay: number,
  idFactory: () => string,
): VacancyProducerSuccess | VacancyTransactionFailure {
  const transaction = cloneSave(draft);
  const departures = [...transaction.organization.departures].sort(
    (left, right) =>
      left.occurredAtDay - right.occurredAtDay || left.departureId.localeCompare(right.departureId),
  );

  for (const departure of departures.filter((item) => item.occurredAtDay <= currentDay)) {
    const noAppointment =
      departure.seatId === null &&
      departure.appointmentId === null &&
      departure.positionId === null &&
      departure.institutionId === null &&
      departure.regionId === null;
    const hasPartialAppointment =
      departure.seatId === null ||
      departure.appointmentId === null ||
      departure.positionId === null ||
      departure.institutionId === null ||
      departure.regionId === null;
    if (!noAppointment && hasPartialAppointment)
      return failure(
        'producer_conflict',
        `Departure ${departure.departureId} has a partial appointment reference`,
      );
    if (!noAppointment) {
      const seat = transaction.organization.seats.find((item) => item.seatId === departure.seatId);
      if (!seat)
        return failure('seat_not_found', `Departure references missing Seat ${departure.seatId}`);
      if (
        seat.positionId !== departure.positionId ||
        seat.institutionId !== departure.institutionId ||
        seat.regionId !== departure.regionId
      )
        return failure(
          'producer_conflict',
          `Departure ${departure.departureId} target does not match its Seat`,
        );
    }

    if (noAppointment) continue;
  }

  const sourceOrganization = structuredClone(transaction.organization);
  sourceOrganization.departures = departures.filter((item) => item.occurredAtDay <= currentDay);
  const beforeVacancyIds = new Set(sourceOrganization.vacancies.map((item) => item.vacancyId));
  const beforeKeys = new Set(sourceOrganization.processedProducerKeys);
  const produced = produceCadreDepartureVacancies({ organization: sourceOrganization, idFactory });
  if (!produced.success) return engineFailure(produced);
  const vacancies = produced.organization.vacancies.filter(
    (item) => !beforeVacancyIds.has(item.vacancyId),
  );
  const processedProducerKeys = produced.organization.processedProducerKeys.filter(
    (key) => !beforeKeys.has(key),
  );
  transaction.organization = produced.organization;
  transaction.organization.departures = transaction.organization.departures.concat(
    departures.filter((item) => item.occurredAtDay > currentDay),
  );
  assignSave(draft, transaction);
  return {
    success: true,
    vacancies,
    processedProducerKeys,
    emittedSignals: produced.emittedSignals,
  };
}

/**
 * 原子提交政治周期调整产生的 Vacancy。
 *
 * @param draft 完整 PlayerSave 草稿
 * @param input 周期及需要释放的席位
 * @param idFactory 稳定运行时 ID 工厂
 * @returns 新建 Vacancy 批次；失败时 draft 不变
 */
export function producePoliticalCycleVacanciesInTransaction(
  draft: PlayerSave,
  input: PoliticalCycleVacancyInput,
  idFactory: () => string,
): VacancyProducerSuccess | VacancyTransactionFailure {
  const transaction = cloneSave(draft);
  const before = new Set(transaction.organization.vacancies.map((item) => item.vacancyId));
  const beforeKeys = new Set(transaction.organization.processedProducerKeys);
  const result = producePoliticalCycleVacancies({
    organization: transaction.organization,
    cycle: input.cycle,
    seatIds: input.seatIds,
    idFactory,
  });
  if (!result.success) return engineFailure(result);
  transaction.organization = result.organization;
  assignSave(draft, transaction);
  return {
    success: true,
    vacancies: result.organization.vacancies.filter((item) => !before.has(item.vacancyId)),
    processedProducerKeys: result.organization.processedProducerKeys.filter(
      (key) => !beforeKeys.has(key),
    ),
    emittedSignals: result.emittedSignals,
  };
}

/**
 * 为已释放席位创建 Vacancy，并将 Engine 结果原子提交到完整存档。
 *
 * @param draft 完整 PlayerSave 草稿
 * @param input 席位、来源及生命周期窗口
 * @param idFactory 运行时 ID 工厂
 * @returns 创建结果；业务失败不修改 draft
 */
export function openVacancyForReleasedSeatInTransaction(
  draft: PlayerSave,
  input: ReleasedSeatVacancyInput,
  idFactory: () => string,
): VacancyMutationResult {
  const transaction = cloneSave(draft);
  const result = openVacancy({
    organization: transaction.organization,
    currentDay: input.openedAtDay,
    idFactory,
    ...input,
  });
  const committed = vacancySuccess(result);
  if (!committed.success) return committed;
  if (!result.success) return engineFailure(result);
  assignOrganization(transaction, result.organization);
  assignSave(draft, transaction);
  return committed;
}

/**
 * 原子填补 Vacancy、Seat 及关联 CareerOpportunity。
 *
 * @param draft 完整 PlayerSave 草稿
 * @param input Vacancy、occupant、任职、选拔和机会标识
 * @returns 填补结果；业务失败不修改 draft
 */
export function fillVacancyInTransaction(
  draft: PlayerSave,
  input: FillVacancyTransactionInput,
): VacancyMutationResult {
  const transaction = cloneSave(draft);
  const hasPreviousAppointment = input.previousAppointmentId !== null;
  if (hasPreviousAppointment !== (input.releasedSeatReason !== null))
    return failure(
      'appointment_mismatch',
      'previousAppointmentId and releasedSeatReason must be provided together',
    );
  const vacancy = transaction.organization.vacancies.find(
    (item) => item.vacancyId === input.vacancyId,
  );
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (input.previousAppointmentId === null) {
    const occupiedOtherSeat = transaction.organization.seats.find(
      (seat) => seat.seatId !== vacancy.seatId && sameOccupant(seat.occupant, input.occupant),
    );
    if (occupiedOtherSeat)
      return failure(
        'appointment_mismatch',
        `Occupant ${input.occupant.type}:${input.occupant.id} already occupies another Seat ${occupiedOtherSeat.seatId}`,
      );
  }
  if (vacancy.selectionId !== input.selectionId)
    return failure('selection_mismatch', `Vacancy ${input.vacancyId} selection does not match`);
  const opportunity = input.opportunityId
    ? transaction.career.opportunities.find((item) => item.id === input.opportunityId)
    : null;
  if (input.opportunityId && (!opportunity || opportunity.vacancyId !== input.vacancyId))
    return failure(
      'opportunity_mismatch',
      `Opportunity does not target Vacancy ${input.vacancyId}`,
    );
  if (opportunity && opportunity.status !== 'accepted' && opportunity.status !== 'in_process')
    return failure(
      'opportunity_mismatch',
      `Opportunity ${opportunity.id} is not in a fillable state`,
    );

  let previousSeat: OrganizationState['seats'][number] | undefined;
  let releasedVacancyId: string | null = null;
  let releasedProducerKey: string | null = null;
  let releasedSignals: DomainSignalSnapshot[] = [];
  if (input.previousAppointmentId !== null && input.releasedSeatReason !== null) {
    const previousSeats = transaction.organization.seats.filter(
      (seat) =>
        sameOccupant(seat.occupant, input.occupant) &&
        seat.currentAppointmentId === input.previousAppointmentId,
    );
    if (previousSeats.length !== 1)
      return failure(
        'appointment_mismatch',
        `Previous appointment ${input.previousAppointmentId} does not identify one Seat`,
      );
    previousSeat = previousSeats[0];
    if (!previousSeat) return failure('appointment_mismatch', 'Previous Seat disappeared');
    if (previousSeat.seatId === vacancy.seatId)
      return failure(
        'appointment_mismatch',
        'Previous appointment Seat cannot equal target Vacancy Seat',
      );
    if (
      transaction.organization.vacancies.some(
        (candidate) =>
          candidate.seatId === previousSeat?.seatId &&
          (candidate.status === 'open' || candidate.status === 'selecting'),
      )
    )
      return failure(
        'producer_conflict',
        `Previous Seat ${previousSeat.seatId} already has an active Vacancy`,
      );
    releasedVacancyId = `vacancy:appointment:${input.previousAppointmentId}:${previousSeat.seatId}`;
    releasedProducerKey = releasedVacancyId;
    const existingReleasedVacancy = transaction.organization.vacancies.find(
      (candidate) => candidate.vacancyId === releasedVacancyId,
    );
    if (existingReleasedVacancy)
      return failure(
        'producer_conflict',
        `Released Seat Vacancy ID already exists: ${releasedVacancyId}`,
      );
    if (transaction.organization.processedProducerKeys.includes(releasedProducerKey))
      return failure(
        'producer_conflict',
        `Released Seat Vacancy producer key already exists: ${releasedProducerKey}`,
      );

    previousSeat.occupant = null;
    previousSeat.currentAppointmentId = null;
    previousSeat.occupiedAtDay = null;
    previousSeat.sourceTransitionId = input.appointmentId;
    const released = openVacancy({
      organization: transaction.organization,
      currentDay: input.currentDay,
      idFactory: input.idFactory,
      seatId: previousSeat.seatId,
      reason: input.releasedSeatReason,
      sourceType: 'appointment',
      sourceId: input.previousAppointmentId,
      closesAtDay: null,
      vacancyId: releasedVacancyId,
    });
    if (!released.success) return engineFailure(released);
    transaction.organization = released.organization;
    releasedSignals = released.emittedSignals;
  }

  const result = fillVacancy({
    organization: transaction.organization,
    currentDay: input.currentDay,
    idFactory: input.idFactory,
    vacancyId: input.vacancyId,
    occupant: input.occupant,
    appointmentId: input.appointmentId,
    transitionId: input.appointmentId,
  });
  const committed = vacancySuccess(result);
  if (!committed.success) return committed;
  if (!result.success) return engineFailure(result);
  transaction.organization = result.organization;

  if (opportunity) {
    const resolved = resolveCareerOpportunity(opportunity, input.currentDay, 'appointed');
    if (!resolved.success || !resolved.opportunity)
      return failure('opportunity_mismatch', `Opportunity ${opportunity.id} could not be resolved`);
    const index = transaction.career.opportunities.findIndex((item) => item.id === opportunity.id);
    if (index < 0)
      return failure('opportunity_mismatch', `Opportunity ${opportunity.id} disappeared`);
    transaction.career.opportunities[index] = resolved.opportunity;
  }
  if (releasedProducerKey) transaction.organization.processedProducerKeys.push(releasedProducerKey);
  assignSave(draft, transaction);
  if (!releasedProducerKey) return committed;
  return {
    success: true,
    vacancy: committed.vacancy,
    emittedSignals: [...committed.emittedSignals, ...releasedSignals],
  };
}

/**
 * 取消 Vacancy，并使其关联机会失效。
 *
 * @param draft 完整 PlayerSave 草稿
 * @param input Vacancy、取消原因和可选机会标识
 * @returns 取消结果；业务失败不修改 draft
 */
export function cancelVacancyInTransaction(
  draft: PlayerSave,
  input: CancelVacancyTransactionInput,
): VacancyMutationResult {
  const transaction = cloneSave(draft);
  const vacancy = transaction.organization.vacancies.find(
    (item) => item.vacancyId === input.vacancyId,
  );
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (
    input.opportunityId &&
    !transaction.career.opportunities.some(
      (item) => item.vacancyId === input.vacancyId && item.id === input.opportunityId,
    )
  )
    return failure(
      'opportunity_mismatch',
      `Opportunity does not target Vacancy ${input.vacancyId}`,
    );
  const result = cancelVacancy({
    organization: transaction.organization,
    currentDay: input.currentDay,
    idFactory: input.idFactory,
    vacancyId: input.vacancyId,
    cancellationReason: input.cancellationReason,
  });
  const committed = vacancySuccess(result);
  if (!committed.success) return committed;
  if (!result.success) return engineFailure(result);
  transaction.organization = result.organization;
  invalidateLinkedCareerState(transaction, input.vacancyId, input.currentDay);
  assignSave(draft, transaction);
  return committed;
}

/**
 * 使到期 Vacancy 进入 expired 终态，并使关联机会失效。
 *
 * @param draft 完整 PlayerSave 草稿
 * @param input Vacancy、当前日和 ID 工厂
 * @returns 到期结果；业务失败不修改 draft
 */
export function expireVacancyInTransaction(
  draft: PlayerSave,
  input: ExpireVacancyTransactionInput,
): VacancyMutationResult {
  const transaction = cloneSave(draft);
  const vacancy = transaction.organization.vacancies.find(
    (item) => item.vacancyId === input.vacancyId,
  );
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  const result = expireVacancy({
    organization: transaction.organization,
    currentDay: input.currentDay,
    idFactory: input.idFactory,
    vacancyId: input.vacancyId,
  });
  const committed = vacancySuccess(result);
  if (!committed.success) return committed;
  if (!result.success) return engineFailure(result);
  transaction.organization = result.organization;
  invalidateLinkedCareerState(transaction, input.vacancyId, input.currentDay);
  assignSave(draft, transaction);
  return committed;
}
