/**
 * Vacancy 与 Selection 交叉引用不变量检查。
 *
 * 从组织总审计中拆出流程状态检查，保持每个 Engine 文件短小并让状态规则集中维护。
 */

import type { OrganizationState } from '../../types/organization';

function sameOccupant(
  left: OrganizationState['seats'][number]['occupant'],
  right: OrganizationState['seats'][number]['occupant'],
): boolean {
  return left?.type === right?.type && left?.id === right?.id;
}

/**
 * 检查 Vacancy、Seat、Selection 的生命周期与交叉引用不变量。
 *
 * @param state 待审计的组织状态
 * @returns Vacancy/Selection 领域错误列表
 */
export function collectVacancyInvariantErrors(state: Readonly<OrganizationState>): string[] {
  const errors: string[] = [];
  const seats = new Map(state.seats.map((seat) => [seat.seatId, seat]));
  const vacancies = new Map(state.vacancies.map((vacancy) => [vacancy.vacancyId, vacancy]));
  const activeVacancySeats = new Set<string>();
  for (const vacancy of state.vacancies) {
    const seat = seats.get(vacancy.seatId);
    if (!seat) errors.push(`Vacancy ${vacancy.vacancyId} references unknown seat`);
    if (seat && seat.positionId !== vacancy.positionId)
      errors.push(`Vacancy ${vacancy.vacancyId} target does not match its seat`);
    if (vacancy.status === 'open' || vacancy.status === 'selecting') {
      if (
        seat &&
        (seat.occupant !== null ||
          seat.currentAppointmentId !== null ||
          seat.occupiedAtDay !== null)
      )
        errors.push(`Active vacancy ${vacancy.vacancyId} has an occupied seat`);
      if (activeVacancySeats.has(vacancy.seatId))
        errors.push(`Seat ${vacancy.seatId} has multiple active vacancies`);
      activeVacancySeats.add(vacancy.seatId);
      if (
        vacancy.filledBy !== null ||
        vacancy.filledAppointmentId !== null ||
        vacancy.cancellationReason !== null
      )
        errors.push(`Active vacancy ${vacancy.vacancyId} has terminal fields`);
      if (vacancy.closedAtDay !== null)
        errors.push(`Active vacancy ${vacancy.vacancyId} has a closed day`);
      if (vacancy.status === 'selecting') {
        if (!vacancy.selectionId)
          errors.push(`Selecting vacancy ${vacancy.vacancyId} is missing selection`);
        else {
          const selection = state.selections.find(
            (candidate) => candidate.selectionId === vacancy.selectionId,
          );
          if (!selection)
            errors.push(`Selecting vacancy ${vacancy.vacancyId} references unknown selection`);
          else {
            if (selection.vacancyId !== vacancy.vacancyId)
              errors.push(`Selecting vacancy ${vacancy.vacancyId} targets another selection`);
            if (selection.status !== 'pending' && selection.status !== 'active')
              errors.push(`Selecting vacancy ${vacancy.vacancyId} references terminal selection`);
          }
        }
      }
    }
    if (vacancy.status === 'filled') {
      if (vacancy.filledBy === null || vacancy.filledAppointmentId === null)
        errors.push(`Filled vacancy ${vacancy.vacancyId} is missing occupant snapshot`);
      if (vacancy.cancellationReason !== null)
        errors.push(`Filled vacancy ${vacancy.vacancyId} has cancellation reason`);
      if (vacancy.closedAtDay === null)
        errors.push(`Filled vacancy ${vacancy.vacancyId} is missing closed day`);
      if (seat && seat.currentAppointmentId === vacancy.filledAppointmentId) {
        if (!sameOccupant(seat.occupant, vacancy.filledBy))
          errors.push(`Filled vacancy ${vacancy.vacancyId} occupant does not match its Seat`);
      }
    }
    if (vacancy.status === 'cancelled') {
      if (vacancy.cancellationReason === null)
        errors.push(`Cancelled vacancy ${vacancy.vacancyId} is missing cancellation reason`);
      if (vacancy.filledBy !== null || vacancy.filledAppointmentId !== null)
        errors.push(`Cancelled vacancy ${vacancy.vacancyId} has occupant snapshot`);
      if (vacancy.closedAtDay === null)
        errors.push(`Cancelled vacancy ${vacancy.vacancyId} is missing closed day`);
    }
    if (vacancy.status === 'expired') {
      if (vacancy.cancellationReason !== 'expired')
        errors.push(`Expired vacancy ${vacancy.vacancyId} must use expired reason`);
      if (vacancy.filledBy !== null || vacancy.filledAppointmentId !== null)
        errors.push(`Expired vacancy ${vacancy.vacancyId} has occupant snapshot`);
      if (vacancy.closedAtDay === null)
        errors.push(`Expired vacancy ${vacancy.vacancyId} is missing closed day`);
    }
    if (
      vacancy.selectionId &&
      !state.selections.some((item) => item.selectionId === vacancy.selectionId)
    )
      errors.push(`Vacancy ${vacancy.vacancyId} references unknown selection`);
  }
  for (const selection of state.selections) {
    const vacancy = vacancies.get(selection.vacancyId);
    if (!vacancy) errors.push(`Selection ${selection.selectionId} references unknown vacancy`);
    if (
      (selection.status === 'pending' || selection.status === 'active') &&
      vacancy?.status !== 'selecting'
    )
      errors.push(`Active selection ${selection.selectionId} requires a selecting vacancy`);
    const candidateKeys = selection.candidates.map(
      (candidate) => `${candidate.candidateType}:${candidate.candidateId}`,
    );
    if (new Set(candidateKeys).size !== candidateKeys.length)
      errors.push(`Selection ${selection.selectionId} has duplicate candidates`);
    if (selection.winner) {
      const key = `${selection.winner.type === 'npc' ? 'npc' : 'player'}:${selection.winner.id}`;
      if (!candidateKeys.includes(key))
        errors.push(`Selection ${selection.selectionId} winner is not a candidate`);
    }
  }
  return errors;
}
