/**
 * 组织世界的只读派生查询。
 */

import type { OrganizationState, VacancyInstance } from '../../types/organization';

function seatIsEmpty(seat: OrganizationState['seats'][number]): boolean {
  return (
    seat.occupant === null && seat.currentAppointmentId === null && seat.occupiedAtDay === null
  );
}

/**
 * 按稳定 ID 查询 Vacancy。
 *
 * @param organization 组织世界状态
 * @param vacancyId Vacancy 稳定 ID
 * @returns 找到的 Vacancy，或 undefined
 */
export function findVacancyById(
  organization: Readonly<OrganizationState>,
  vacancyId: string,
): VacancyInstance | undefined {
  return organization.vacancies.find((vacancy) => vacancy.vacancyId === vacancyId);
}

/**
 * 查询 Seat 上仍然有效的唯一 Vacancy。
 *
 * @param organization 组织世界状态
 * @param seatId Seat 稳定 ID
 * @returns open/selecting Vacancy，或 undefined
 */
export function findActiveVacancyBySeat(
  organization: Readonly<OrganizationState>,
  seatId: string,
): VacancyInstance | undefined {
  return organization.vacancies.find(
    (vacancy) =>
      vacancy.seatId === seatId && (vacancy.status === 'open' || vacancy.status === 'selecting'),
  );
}

/**
 * 查询职位下全部仍然有效的 Vacancy。
 *
 * @param organization 组织世界状态
 * @param positionId 职位稳定 ID
 * @returns 按存档顺序返回 open/selecting Vacancy
 */
export function findActiveVacanciesByPosition(
  organization: Readonly<OrganizationState>,
  positionId: string,
): VacancyInstance[] {
  return organization.vacancies.filter(
    (vacancy) =>
      vacancy.positionId === positionId &&
      (vacancy.status === 'open' || vacancy.status === 'selecting'),
  );
}

/**
 * 判断职位是否至少有一个可落位的实际空 Seat。
 *
 * @param organization 组织世界状态
 * @param positionId 目标职位 ID
 * @returns 存在未被玩家或 NPC 占据的 Seat 时返回 true
 */
export function hasVacantOrganizationSeat(
  organization: Readonly<OrganizationState>,
  positionId: string,
): boolean {
  return organization.seats.some((seat) => seat.positionId === positionId && seatIsEmpty(seat));
}
