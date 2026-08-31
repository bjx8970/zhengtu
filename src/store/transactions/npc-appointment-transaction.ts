/**
 * NPC 选拔胜者的任职事务。
 *
 * 本模块把已完成的 Selection 转换为干部、履历、Seat 与 Vacancy 的一次性
 * 事实变更，并复用 Vacancy Store 事务处理转岗时的旧席位释放。
 */

import { unwrap } from 'solid-js/store';
import type { CareerExperience, CurrentAppointment } from '../../domain/career/state';
import type { AppointmentReason } from '../../domain/career/types';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { PlayerSave } from '../../types/player';
import type {
  CadreProfile,
  OrganizationSeat,
  StaffingSelection,
  VacancyInstance,
} from '../../types/organization';
import {
  fillVacancyInTransaction,
  type FillVacancyTransactionInput,
  type VacancyTransactionFailure,
} from './vacancy-transaction';

/** NPC 任职事务的业务失败类型。 */
export type NpcAppointmentTransactionError =
  | VacancyTransactionFailure['error']
  | 'cadre_not_found'
  | 'cadre_inactive'
  | 'winner_mismatch'
  | 'selection_not_found'
  | 'selection_terminal'
  | 'selection_mismatch'
  | 'appointment_mismatch'
  | 'appointment_id_conflict'
  | 'experience_id_conflict';

/** NPC 任职事务失败结果。 */
export interface NpcAppointmentTransactionFailure {
  success: false;
  error: NpcAppointmentTransactionError;
  detail: string;
}

/** NPC 任职事务成功结果；signals 由调用方继续编排。 */
export interface NpcAppointmentTransactionSuccess {
  success: true;
  vacancy: VacancyInstance;
  emittedSignals: DomainSignalSnapshot[];
}

/** NPC 选拔胜者任职事务结果。 */
export type NpcAppointmentTransactionResult =
  NpcAppointmentTransactionSuccess | NpcAppointmentTransactionFailure;

/** NPC 选拔胜者任职事务输入。 */
export interface NpcAppointmentTransactionInput {
  selectionId: string;
  vacancyId: string;
  cadreId: string;
  currentDay: number;
  idFactory: () => string;
}

function failure(
  error: NpcAppointmentTransactionError,
  detail: string,
): NpcAppointmentTransactionFailure {
  return { success: false, error, detail };
}

function cloneSave(draft: PlayerSave): PlayerSave {
  return structuredClone(unwrap(draft));
}

function emptySeat(seat: OrganizationSeat): boolean {
  return (
    seat.occupant === null && seat.currentAppointmentId === null && seat.occupiedAtDay === null
  );
}

function matchingSeat(
  save: PlayerSave,
  cadreId: string,
  appointment: CurrentAppointment,
): OrganizationSeat[] {
  return save.organization.seats.filter(
    (seat) =>
      seat.occupant?.type === 'npc' &&
      seat.occupant.id === cadreId &&
      seat.currentAppointmentId === appointment.appointmentId,
  );
}

function occupiedCadreSeats(save: PlayerSave, cadreId: string): OrganizationSeat[] {
  return save.organization.seats.filter(
    (seat) => seat.occupant?.type === 'npc' && seat.occupant.id === cadreId,
  );
}

function matchingOpenExperiences(cadre: CadreProfile, appointmentId: string): CareerExperience[] {
  return cadre.experiences.filter(
    (experience) => experience.endedAtDay === null && experience.appointmentId === appointmentId,
  );
}

function appointmentMatchesSeat(appointment: CurrentAppointment, seat: OrganizationSeat): boolean {
  return (
    appointment.positionId === seat.positionId &&
    appointment.institutionId === seat.institutionId &&
    appointment.regionId === seat.regionId &&
    appointment.institutionLevel === seat.institutionLevel &&
    appointment.positionDomain === seat.positionDomain &&
    appointment.leadershipRank === seat.leadershipRank
  );
}

function appointmentIdExists(save: PlayerSave, appointmentId: string): boolean {
  return save.organization.cadres.some(
    (cadre) =>
      cadre.currentAppointment?.appointmentId === appointmentId ||
      cadre.experiences.some((experience) => experience.appointmentId === appointmentId),
  );
}

function experienceIdExists(save: PlayerSave, experienceId: string): boolean {
  return save.organization.cadres.some((cadre) =>
    cadre.experiences.some((experience) => experience.id === experienceId),
  );
}

function isIdempotent(
  save: PlayerSave,
  selection: StaffingSelection,
  vacancy: VacancyInstance,
  seat: OrganizationSeat,
  cadre: CadreProfile,
  cadreId: string,
): boolean {
  const appointment = cadre.currentAppointment;
  if (
    vacancy.status !== 'filled' ||
    selection.vacancyId !== vacancy.vacancyId ||
    vacancy.selectionId !== selection.selectionId ||
    vacancy.filledBy?.type !== 'npc' ||
    vacancy.filledBy.id !== cadreId ||
    vacancy.filledAppointmentId === null ||
    vacancy.closedAtDay === null ||
    vacancy.cancellationReason !== null ||
    seat.occupant?.type !== 'npc' ||
    seat.occupant.id !== cadreId ||
    seat.currentAppointmentId !== vacancy.filledAppointmentId ||
    seat.occupiedAtDay === null ||
    !appointment ||
    appointment.status !== 'active' ||
    appointment.appointmentId !== vacancy.filledAppointmentId ||
    selection.status !== 'completed' ||
    selection.winnerId !== cadreId ||
    selection.winner?.type !== 'npc' ||
    selection.winner.id !== cadreId
  )
    return false;
  const openExperiences = matchingOpenExperiences(cadre, appointment.appointmentId);
  const occupiedSeats = occupiedCadreSeats(save, cadreId);
  return (
    cadre.experiences.filter((experience) => experience.endedAtDay === null).length === 1 &&
    openExperiences.length === 1 &&
    openExperiences[0]?.endedAtDay === null &&
    occupiedSeats.length === 1 &&
    matchingSeat(save, cadreId, appointment).length === 1 &&
    appointmentMatchesSeat(appointment, seat)
  );
}

function buildAppointment(
  vacancy: VacancyInstance,
  currentDay: number,
  appointmentId: string,
  appointmentReason: AppointmentReason,
): CurrentAppointment {
  return {
    appointmentId,
    positionId: vacancy.positionId,
    institutionId: vacancy.institutionId,
    regionId: vacancy.regionId,
    institutionLevel: vacancy.institutionLevel,
    positionDomain: vacancy.positionDomain,
    leadershipRank: vacancy.leadershipRank,
    startedAtDay: currentDay,
    appointmentType: 'substantive',
    appointmentReason,
    sourceOpportunityId: null,
    status: 'active',
    endedAtDay: null,
    endReason: null,
    probation: null,
  };
}

function buildExperience(
  vacancy: VacancyInstance,
  appointment: CurrentAppointment,
  experienceId: string,
): CareerExperience {
  return {
    id: experienceId,
    appointmentId: appointment.appointmentId,
    positionId: vacancy.positionId,
    positionNameSnapshot: vacancy.positionNameSnapshot,
    institutionId: vacancy.institutionId,
    institutionNameSnapshot: vacancy.institutionNameSnapshot,
    institutionLevel: vacancy.institutionLevel,
    regionId: vacancy.regionId,
    positionDomain: vacancy.positionDomain,
    leadershipRank: vacancy.leadershipRank,
    startedAtDay: appointment.startedAtDay,
    endedAtDay: null,
    appointmentReason: appointment.appointmentReason,
    appointmentType: 'substantive',
    sourceOpportunityId: null,
    endReason: null,
    assessmentResults: [],
  };
}

/**
 * 将已结算 NPC Selection 胜者正式任职到其 Vacancy。
 *
 * @param draft 完整 PlayerSave 草稿；事务成功后才会被写回
 * @param input Selection、目标 Vacancy、NPC、当前日和 ID 工厂
 * @returns Vacancy 填补及旧 Seat 释放信号；失败时 draft 深度不变
 */
export function appointNpcSelectionWinnerInTransaction(
  draft: PlayerSave,
  input: NpcAppointmentTransactionInput,
): NpcAppointmentTransactionResult {
  const transaction = cloneSave(draft);
  const selection = transaction.organization.selections.find(
    (candidate) => candidate.selectionId === input.selectionId,
  );
  const vacancy = transaction.organization.vacancies.find(
    (candidate) => candidate.vacancyId === input.vacancyId,
  );
  const cadre = transaction.organization.cadres.find(
    (candidate) => candidate.cadreId === input.cadreId,
  );
  if (!selection)
    return failure('selection_not_found', `Selection ${input.selectionId} does not exist`);
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (!cadre) return failure('cadre_not_found', `Cadre ${input.cadreId} does not exist`);

  const targetSeat = transaction.organization.seats.find((seat) => seat.seatId === vacancy.seatId);
  if (!targetSeat) return failure('seat_not_found', `Seat ${vacancy.seatId} does not exist`);

  // A successful prior invocation is recognized before terminal-state rejection so
  // replay does not allocate IDs or emit duplicate domain signals.
  if (isIdempotent(transaction, selection, vacancy, targetSeat, cadre, input.cadreId))
    return { success: true, vacancy, emittedSignals: [] };

  if (selection.winnerId !== input.cadreId)
    return failure('winner_mismatch', 'Selection winner does not match the requested cadre');
  const winner = selection.candidates.find((candidate) => candidate.candidateId === input.cadreId);
  if (!winner || winner.candidateType !== 'npc')
    return failure('winner_mismatch', 'Selection winner is not an NPC candidate');
  if (
    selection.winner !== null &&
    (selection.winner.type !== 'npc' || selection.winner.id !== input.cadreId)
  )
    return failure('winner_mismatch', 'Selection winner reference is not the requested NPC');
  if (selection.vacancyId !== vacancy.vacancyId || vacancy.selectionId !== selection.selectionId)
    return failure('selection_mismatch', 'Selection and Vacancy are not mutually attached');
  if (selection.status !== 'completed')
    return failure('selection_terminal', 'Selection must be completed before NPC appointment');
  if (vacancy.status !== 'selecting')
    return failure('vacancy_terminal', 'Vacancy must remain selecting before NPC appointment');
  if (
    vacancy.filledBy !== null ||
    vacancy.filledAppointmentId !== null ||
    vacancy.closedAtDay !== null ||
    vacancy.cancellationReason !== null
  )
    return failure('vacancy_terminal', 'Vacancy already has a filling result');
  if (!emptySeat(targetSeat))
    return failure('seat_occupied', `Seat ${targetSeat.seatId} is occupied`);
  if (cadre.status !== 'active') return failure('cadre_inactive', 'Cadre is not active');

  const oldAppointment = cadre.currentAppointment;
  const openExperiences = cadre.experiences.filter((experience) => experience.endedAtDay === null);
  const oldExperiences = oldAppointment
    ? matchingOpenExperiences(cadre, oldAppointment.appointmentId)
    : openExperiences;
  const allCadreSeats = occupiedCadreSeats(transaction, input.cadreId);
  const oldSeats = oldAppointment
    ? matchingSeat(transaction, input.cadreId, oldAppointment)
    : allCadreSeats;
  if (oldAppointment) {
    if (
      oldAppointment.status !== 'active' ||
      openExperiences.length !== 1 ||
      oldExperiences.length !== 1 ||
      oldSeats.length !== 1 ||
      allCadreSeats.length !== 1 ||
      !oldSeats[0] ||
      !appointmentMatchesSeat(oldAppointment, oldSeats[0])
    )
      return failure(
        'appointment_mismatch',
        'Existing NPC appointment must match one open experience and Seat',
      );
  } else if (oldExperiences.length !== 0 || oldSeats.length !== 0) {
    return failure(
      'appointment_mismatch',
      'Unappointed NPC cannot have an open experience or occupied Seat',
    );
  }

  const appointmentReason: AppointmentReason = oldAppointment
    ? oldAppointment.leadershipRank === vacancy.leadershipRank
      ? 'lateral_transfer'
      : 'promotion'
    : 'initial_assignment';
  const releasedSeatReason = oldAppointment
    ? oldAppointment.leadershipRank === vacancy.leadershipRank
      ? 'lateral_transfer'
      : 'promotion'
    : null;
  const appointmentId = input.idFactory();
  const experienceId = input.idFactory();
  if (
    appointmentId === experienceId ||
    appointmentIdExists(transaction, appointmentId) ||
    transaction.career.appointment.appointmentId === appointmentId
  )
    return failure('appointment_id_conflict', `Appointment ID ${appointmentId} already exists`);
  if (
    experienceIdExists(transaction, experienceId) ||
    transaction.career.experiences.some((experience) => experience.id === experienceId)
  )
    return failure('experience_id_conflict', `Experience ID ${experienceId} already exists`);

  if (oldAppointment && oldExperiences[0]) {
    oldExperiences[0].endedAtDay = input.currentDay;
    oldExperiences[0].endReason = releasedSeatReason;
  }
  cadre.currentAppointment = buildAppointment(
    vacancy,
    input.currentDay,
    appointmentId,
    appointmentReason,
  );
  // fillVacancy requires a live Selection. Restore only this transaction copy;
  // the Engine then writes the canonical completed/winner terminal state.
  selection.status = 'active';
  const fillInput: FillVacancyTransactionInput = {
    vacancyId: input.vacancyId,
    occupant: { type: 'npc', id: input.cadreId },
    appointmentId,
    selectionId: input.selectionId,
    opportunityId: null,
    currentDay: input.currentDay,
    idFactory: input.idFactory,
    previousAppointmentId: oldAppointment?.appointmentId ?? null,
    releasedSeatReason,
  };
  const filled = fillVacancyInTransaction(transaction, fillInput);
  if (!filled.success) return filled;
  const appointedCadre = transaction.organization.cadres.find(
    (candidate) => candidate.cadreId === input.cadreId,
  );
  if (!appointedCadre?.currentAppointment)
    return failure('cadre_not_found', 'Cadre disappeared while filling Vacancy');
  appointedCadre.experiences.push(
    buildExperience(vacancy, appointedCadre.currentAppointment, experienceId),
  );
  Object.assign(draft, transaction);
  return filled;
}
