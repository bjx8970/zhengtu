/**
 * Vacancy selecting、回退与终态转换纯 Engine。
 *
 * 这些转换与 open/fill 共用同一份组织快照复制约束；所有业务失败返回
 * 可诊断结果，不把部分 mutation 泄漏给调用方。
 */

import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type {
  BeginVacancySelectionInput,
  CancelVacancyInput,
  ExpireVacancyInput,
  OrganizationSeat,
  OrganizationState,
  StaffingSelection,
  VacancyInstance,
  VacancyLifecycleError,
  VacancyLifecycleResult,
} from '../../types/organization';
import { findVacancyById } from './organization-selectors';
import { cancelledSignal } from './vacancy-signals';

function success(
  organization: OrganizationState,
  vacancy: VacancyInstance | null,
  emittedSignals: DomainSignalSnapshot[] = [],
): VacancyLifecycleResult {
  return { success: true, organization, vacancy, emittedSignals };
}

function failure(error: VacancyLifecycleError, detail: string): VacancyLifecycleResult {
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

function requireSelectingSelection(
  organization: OrganizationState,
  vacancy: VacancyInstance,
  expectedSelectionId?: string,
): StaffingSelection | VacancyLifecycleResult {
  if (!vacancy.selectionId)
    return failure('selection_not_found', 'Selecting Vacancy has no Selection');
  if (expectedSelectionId !== undefined && vacancy.selectionId !== expectedSelectionId)
    return failure('selection_mismatch', 'Selection is not attached');
  const selection = organization.selections.find(
    (item) => item.selectionId === vacancy.selectionId,
  );
  if (!selection)
    return failure('selection_not_found', `Selection ${vacancy.selectionId} does not exist`);
  if (
    selection.vacancyId !== vacancy.vacancyId ||
    (selection.status !== 'pending' && selection.status !== 'active')
  )
    return failure('selection_mismatch', 'Selection is not active');
  return selection;
}

/**
 * 开始 Vacancy 选拔。
 *
 * @param input Vacancy 与已建立 Selection 的标识
 * @returns 更新后的 selecting Vacancy 或业务失败诊断
 */
export function beginVacancySelection(input: BeginVacancySelectionInput): VacancyLifecycleResult {
  const organization = cloneOrganization(input);
  const vacancy = findVacancyById(organization, input.vacancyId);
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (vacancy.status !== 'open')
    return failure('vacancy_terminal', `Vacancy ${input.vacancyId} is not open`);
  const seat = seatFor(organization, vacancy.seatId);
  if (!seat || !seatIsEmpty(seat))
    return failure('seat_occupied', `Seat ${vacancy.seatId} is occupied`);
  const selection = organization.selections.find((item) => item.selectionId === input.selectionId);
  if (!selection)
    return failure('selection_not_found', `Selection ${input.selectionId} does not exist`);
  if (selection.vacancyId !== vacancy.vacancyId)
    return failure('selection_mismatch', `Selection ${input.selectionId} targets another Vacancy`);
  if (selection.status !== 'pending' && selection.status !== 'active')
    return failure('selection_mismatch', `Selection ${input.selectionId} is terminal`);
  selection.status = 'active';
  vacancy.status = 'selecting';
  vacancy.selectionId = input.selectionId;
  return success(organization, vacancy);
}

/**
 * 开始 Vacancy 选拔的简短契约别名。
 *
 * @param input Vacancy 与已建立 Selection 的标识
 * @returns 更新后的 selecting Vacancy 或业务失败诊断
 */
export function beginSelection(input: BeginVacancySelectionInput): VacancyLifecycleResult {
  return beginVacancySelection(input);
}

/**
 * 将选拔失败的 Vacancy 退回可继续竞争状态。
 *
 * @param input Vacancy 与当前日
 * @returns 更新后的 open Vacancy 或业务失败诊断
 */
export function returnVacancyToOpen(input: BeginVacancySelectionInput): VacancyLifecycleResult {
  const organization = cloneOrganization(input);
  const vacancy = findVacancyById(organization, input.vacancyId);
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (vacancy.status !== 'selecting')
    return failure('vacancy_terminal', `Vacancy ${input.vacancyId} is not selecting`);
  const selectionCheck = requireSelectingSelection(organization, vacancy, input.selectionId);
  if ('success' in selectionCheck) return selectionCheck;
  const selection = selectionCheck;
  selection.status = 'failed';
  selection.completedAtDay = input.currentDay;
  vacancy.status = 'open';
  vacancy.selectionId = null;
  return success(organization, vacancy);
}

/**
 * 将选拔失败的 Vacancy 退回 open 的简短契约别名。
 *
 * @param input Vacancy 与 Selection 的标识
 * @returns 更新后的 open Vacancy 或业务失败诊断
 */
export function returnToOpen(input: BeginVacancySelectionInput): VacancyLifecycleResult {
  return returnVacancyToOpen(input);
}

/**
 * 取消 Vacancy。
 *
 * @param input Vacancy 与取消原因
 * @returns cancelled Vacancy 与领域信号或业务失败诊断
 */
export function cancelVacancy(input: CancelVacancyInput): VacancyLifecycleResult {
  const organization = cloneOrganization(input);
  const vacancy = findVacancyById(organization, input.vacancyId);
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (vacancy.status !== 'open' && vacancy.status !== 'selecting')
    return failure('vacancy_terminal', `Vacancy ${input.vacancyId} cannot be cancelled`);
  const selection =
    vacancy.status === 'selecting' ? requireSelectingSelection(organization, vacancy) : null;
  if (selection && 'success' in selection) return selection;
  const seat = seatFor(organization, vacancy.seatId);
  if (!seat || !seatIsEmpty(seat))
    return failure('seat_occupied', `Seat ${vacancy.seatId} is occupied`);
  vacancy.status = 'cancelled';
  vacancy.closedAtDay = input.currentDay;
  vacancy.cancellationReason = input.cancellationReason;
  if (selection) {
    selection.status = 'cancelled';
    selection.completedAtDay = input.currentDay;
  }
  return success(organization, vacancy, [cancelledSignal(vacancy)]);
}

/**
 * 使到达关闭日期的 Vacancy 过期。
 *
 * @param input Vacancy 与当前日
 * @returns expired Vacancy 与 vacancy.cancelled 信号或业务失败诊断
 */
export function expireVacancy(input: ExpireVacancyInput): VacancyLifecycleResult {
  const organization = cloneOrganization(input);
  const vacancy = findVacancyById(organization, input.vacancyId);
  if (!vacancy) return failure('vacancy_not_found', `Vacancy ${input.vacancyId} does not exist`);
  if (vacancy.status !== 'open' && vacancy.status !== 'selecting')
    return failure('vacancy_terminal', `Vacancy ${input.vacancyId} cannot expire`);
  if (vacancy.closesAtDay === null || input.currentDay < vacancy.closesAtDay)
    return failure('vacancy_terminal', `Vacancy ${input.vacancyId} is not due to expire`);
  const selection =
    vacancy.status === 'selecting' ? requireSelectingSelection(organization, vacancy) : null;
  if (selection && 'success' in selection) return selection;
  const seat = seatFor(organization, vacancy.seatId);
  if (!seat || !seatIsEmpty(seat))
    return failure('seat_occupied', `Seat ${vacancy.seatId} is occupied`);
  vacancy.status = 'expired';
  vacancy.closedAtDay = input.currentDay;
  vacancy.cancellationReason = 'expired';
  if (selection) {
    selection.status = 'cancelled';
    selection.completedAtDay = input.currentDay;
  }
  return success(organization, vacancy, [cancelledSignal(vacancy)]);
}
