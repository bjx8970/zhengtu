/**
 * 组织世界跨引用与占用一致性校验。
 *
 * 校验器保持纯函数，可同时供存档解码、测试和后续事务提交前复核使用。
 */

import type { CurrentAppointment } from '../../domain/career/state';
import type { OrganizationState } from '../../types/organization';
import { collectVacancyInvariantErrors } from './organization-invariant-checks';

/**
 * 审计干部、席位、空缺和世界选拔之间的不变量。
 *
 * @param state 待审计的组织世界状态
 * @param playerAppointment 玩家当前任职事实；已结束任职用于断言玩家不再占席
 * @returns 可读错误列表，空数组表示一致
 */
export function validateOrganizationInvariants(
  state: Readonly<OrganizationState>,
  playerAppointment: Readonly<CurrentAppointment>,
): string[] {
  const errors: string[] = [];
  const cadreIds = state.cadres.map((cadre) => cadre.cadreId);
  const seatIds = state.seats.map((seat) => seat.seatId);
  const vacancyIds = state.vacancies.map((vacancy) => vacancy.vacancyId);
  const selectionIds = state.selections.map((selection) => selection.selectionId);
  const departureIds = state.departures.map((departure) => departure.departureId);
  for (const [label, ids] of [
    ['cadre', cadreIds],
    ['seat', seatIds],
    ['vacancy', vacancyIds],
    ['selection', selectionIds],
    ['departure', departureIds],
  ] as const) {
    if (new Set(ids).size !== ids.length) errors.push(`Duplicate ${label} identity`);
  }

  const cadres = new Map(state.cadres.map((cadre) => [cadre.cadreId, cadre]));
  const seats = new Map(state.seats.map((seat) => [seat.seatId, seat]));
  const departureAppointments = new Set<string>();
  const playerSeats = state.seats.filter((seat) => seat.occupant?.type === 'player');
  if (playerAppointment.status === 'active' && playerSeats.length !== 1)
    errors.push('Active player appointment must occupy exactly one organization seat');
  if (playerAppointment.status !== 'active' && playerSeats.length !== 0)
    errors.push('Ended player appointment cannot occupy an organization seat');
  for (const seat of state.seats) {
    const occupied = seat.occupant !== null;
    if (occupied !== (seat.currentAppointmentId !== null && seat.occupiedAtDay !== null))
      errors.push(`Seat ${seat.seatId} occupancy metadata is inconsistent`);
    if (
      seat.occupant?.type === 'player' &&
      (playerAppointment.status !== 'active' ||
        seat.currentAppointmentId !== playerAppointment.appointmentId ||
        seat.positionId !== playerAppointment.positionId ||
        seat.institutionId !== playerAppointment.institutionId ||
        seat.regionId !== playerAppointment.regionId ||
        seat.institutionLevel !== playerAppointment.institutionLevel ||
        seat.positionDomain !== playerAppointment.positionDomain ||
        seat.leadershipRank !== playerAppointment.leadershipRank)
    )
      errors.push(`Player seat ${seat.seatId} does not match the active player appointment`);
    if (seat.occupant?.type === 'npc') {
      const cadre = cadres.get(seat.occupant.id);
      if (!cadre) errors.push(`Seat ${seat.seatId} references unknown cadre`);
      else if (cadre.currentAppointment?.appointmentId !== seat.currentAppointmentId)
        errors.push(`Seat ${seat.seatId} does not match cadre appointment`);
    }
  }
  for (const cadre of state.cadres) {
    const activeExperiences = cadre.experiences.filter(
      (experience) => experience.endedAtDay === null,
    );
    if (cadre.currentAppointment === null && activeExperiences.length > 0)
      errors.push(`Cadre ${cadre.cadreId} has an open experience without an appointment`);
    if (
      cadre.currentAppointment !== null &&
      (activeExperiences.length !== 1 ||
        activeExperiences[0]?.appointmentId !== cadre.currentAppointment.appointmentId)
    )
      errors.push(`Cadre ${cadre.cadreId} active appointment and experience do not match`);
    const occupiedSeats = state.seats.filter(
      (seat) => seat.occupant?.type === 'npc' && seat.occupant.id === cadre.cadreId,
    );
    if (cadre.currentAppointment !== null && occupiedSeats.length !== 1)
      errors.push(`Cadre ${cadre.cadreId} must occupy exactly one seat`);
    if (cadre.status !== 'active' && cadre.currentAppointment !== null)
      errors.push(`Cadre ${cadre.cadreId} has an appointment after exit`);
    if (cadre.status === 'active' && cadre.exitedAtDay !== null)
      errors.push(`Active cadre ${cadre.cadreId} has an exit day`);
    if (cadre.status !== 'active' && cadre.exitedAtDay === null)
      errors.push(`Exited cadre ${cadre.cadreId} is missing exit day`);
  }
  for (const departure of state.departures) {
    if (departure.appointmentId !== null) {
      if (departureAppointments.has(departure.appointmentId))
        errors.push(`Duplicate departure appointment ${departure.appointmentId}`);
      departureAppointments.add(departure.appointmentId);
    }
    const cadre = cadres.get(departure.cadreId);
    if (!cadre) errors.push(`Departure ${departure.departureId} references unknown cadre`);
    if (departure.appointmentId === null) {
      if (departure.experienceId !== null || departure.seatId !== null)
        errors.push(`Unassigned departure ${departure.departureId} has an appointment reference`);
      if (
        departure.positionId !== null ||
        departure.institutionId !== null ||
        departure.regionId !== null
      )
        errors.push(`Unassigned departure ${departure.departureId} has a Seat target`);
    } else {
      if (departure.experienceId === null || departure.seatId === null)
        errors.push(`Seated departure ${departure.departureId} is missing an appointment target`);
      else {
        if (
          !cadre?.experiences.some(
            (experience) =>
              experience.id === departure.experienceId &&
              experience.appointmentId === departure.appointmentId &&
              experience.endedAtDay === departure.occurredAtDay &&
              experience.endReason === departure.reason,
          )
        )
          errors.push(`Departure ${departure.departureId} does not match a closed experience`);
        const seat = seats.get(departure.seatId);
        if (!seat) errors.push(`Departure ${departure.departureId} references unknown seat`);
        if (
          seat &&
          (seat.positionId !== departure.positionId ||
            seat.institutionId !== departure.institutionId ||
            seat.regionId !== departure.regionId)
        )
          errors.push(`Departure ${departure.departureId} target does not match its seat`);
        if (seat?.occupant?.type === 'npc' && seat.occupant.id === departure.cadreId)
          errors.push(`Departure ${departure.departureId} Seat is still occupied by the cadre`);
      }
    }
    if (
      cadre &&
      cadre.currentAppointment?.appointmentId === departure.appointmentId &&
      departure.appointmentId !== null
    )
      errors.push(`Departure ${departure.departureId} still matches current appointment`);
    if (cadre && cadre.exitedAtDay !== null && cadre.exitedAtDay < departure.occurredAtDay)
      errors.push(`Departure ${departure.departureId} occurs after cadre exit day`);
  }
  errors.push(...collectVacancyInvariantErrors(state));
  if (new Set(state.processedProducerKeys).size !== state.processedProducerKeys.length)
    errors.push('Duplicate organization producer key');
  return errors;
}
