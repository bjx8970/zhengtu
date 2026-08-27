/**
 * 动态 Vacancy 生命周期纯 Engine。
 *
 * 本模块只在组织状态副本上执行 open、selection、fill、cancel 和 expire 转换；
 * producer、Store 事务与领域信号投递由调用方负责，确保失败时可以整体回滚。
 */

import type {
  FillVacancyInput,
  OpenVacancyInput,
  OrganizationSeat,
  OrganizationState,
  VacancyInstance,
  VacancyLifecycleResult,
} from '../../types/organization';
import { findVacancyById, findActiveVacancyBySeat } from './organization-selectors';

import { filledSignal, openedSignal } from './vacancy-signals';

export {
  beginSelection,
  beginVacancySelection,
  cancelVacancy,
  expireVacancy,
  returnToOpen,
  returnVacancyToOpen,
} from './vacancy-selection-lifecycle';

function success(
  organization: OrganizationState,
  vacancy: VacancyInstance | null,
  emittedSignals: import('../../domain/governance/types').DomainSignalSnapshot[] = [],
): VacancyLifecycleResult {
  return { success: true, organization, vacancy, emittedSignals };
}

function failure(
  error: NonNullable<Exclude<VacancyLifecycleResult, { success: true }>['error']>,
  detail: string,
): VacancyLifecycleResult {
  return { success: false, error, detail };
}

function cloneOrganization(input: {
  organization: Readonly<OrganizationState>;
}): OrganizationState {
  return structuredClone(input.organization);
}

function seatFor(organization: OrganizationState, seatId: string): OrganizationSeat | undefined {
  return organization.seats.find((seat) => seat.seatId === seatId);
}

function seatIsEmpty(seat: OrganizationSeat): boolean {
  return (
    seat.occupant === null && seat.currentAppointmentId === null && seat.occupiedAtDay === null
  );
}

/**
 * 创建 open Vacancy。
 *
 * @param input Seat、来源、原因和生命周期窗口
 * @returns 成功时返回新 Vacancy 与 vacancy.opened 信号，业务失败返回诊断
 */
export function openVacancy(input: OpenVacancyInput): VacancyLifecycleResult {
  const organization = cloneOrganization(input);
  const seat = seatFor(organization, input.seatId);
  if (!seat) return failure('seat_not_found', `Seat ${input.seatId} does not exist`);
  if (!seatIsEmpty(seat)) return failure('seat_occupied', `Seat ${input.seatId} is occupied`);
  const vacancyId = input.vacancyId ?? input.idFactory();
  if (organization.vacancies.some((item) => item.vacancyId === vacancyId))
    return failure('vacancy_identity_conflict', `Vacancy ${vacancyId} already exists`);
  if (findActiveVacancyBySeat(organization, input.seatId))
    return failure('active_vacancy_exists', `Seat ${input.seatId} already has an active Vacancy`);
  const vacancy: VacancyInstance = {
    vacancyId,
    seatId: seat.seatId,
    positionId: seat.positionId,
    positionNameSnapshot: seat.positionNameSnapshot,
    institutionId: seat.institutionId,
    institutionNameSnapshot: seat.institutionNameSnapshot,
    regionId: seat.regionId,
    institutionLevel: seat.institutionLevel,
    positionDomain: seat.positionDomain,
    leadershipRank: seat.leadershipRank,
    openedAtDay: input.currentDay,
    reason: input.reason,
    status: 'open',
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    closesAtDay: input.closesAtDay,
    closedAtDay: null,
    selectionId: null,
    filledBy: null,
    filledAppointmentId: null,
    cancellationReason: null,
  };
  organization.vacancies.push(vacancy);
  return success(organization, vacancy, [openedSignal(vacancy)]);
}

/**
 * 原子填补 Vacancy 与目标 Seat。
 *
 * @param input Vacancy、占用者、任职和转移事实
 * @returns filled Vacancy 与 vacancy.filled 信号或业务失败诊断
 */
export function fillVacancy(input: FillVacancyInput): VacancyLifecycleResult {
  const organization = cloneOrganization(input);
  const vacancy = findVacancyById(organization, input.vacancyId);
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (vacancy.status !== 'open' && vacancy.status !== 'selecting')
    return failure('vacancy_terminal', `Vacancy ${input.vacancyId} cannot be filled`);
  const selection = vacancy.selectionId
    ? organization.selections.find((item) => item.selectionId === vacancy.selectionId)
    : undefined;
  if (vacancy.status === 'selecting') {
    if (!vacancy.selectionId)
      return failure('selection_required', 'Selecting Vacancy requires Selection');
    if (!selection)
      return failure('selection_not_found', `Selection ${vacancy.selectionId} does not exist`);
    if (selection.vacancyId !== vacancy.vacancyId)
      return failure(
        'selection_mismatch',
        `Selection ${selection.selectionId} targets another Vacancy`,
      );
    if (selection.status !== 'pending' && selection.status !== 'active')
      return failure('selection_mismatch', `Selection ${selection.selectionId} is terminal`);
  }
  const seat = seatFor(organization, vacancy.seatId);
  if (!seat || !seatIsEmpty(seat))
    return failure('seat_occupied', `Seat ${vacancy.seatId} is occupied`);
  if (!input.occupant) return failure('occupant_missing', 'Vacancy fill requires an occupant');
  if (!input.appointmentId)
    return failure('appointment_missing', 'Vacancy fill requires an appointment');
  seat.occupant = structuredClone(input.occupant);
  seat.currentAppointmentId = input.appointmentId;
  seat.occupiedAtDay = input.currentDay;
  seat.sourceTransitionId = input.transitionId;
  vacancy.status = 'filled';
  vacancy.closedAtDay = input.currentDay;
  vacancy.filledBy = structuredClone(input.occupant);
  vacancy.filledAppointmentId = input.appointmentId;
  if (selection) {
    selection.status = 'completed';
    selection.completedAtDay = input.currentDay;
    selection.winner = structuredClone(input.occupant);
  }
  return success(organization, vacancy, [filledSignal(vacancy)]);
}
