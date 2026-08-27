/** 组织 Seat/Vacancy selector 的空置语义测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../store/game-store';
import {
  findActiveVacanciesByPosition,
  findActiveVacancyBySeat,
  hasVacantOrganizationSeat,
} from '../organization-selectors';

describe('organization selectors', () => {
  it('只有三项 Seat 占用元数据全为空才算 vacant', () => {
    const state = createInitialState().organization;
    const seat = state.seats.find((candidate) => candidate.occupant === null);
    if (!seat) throw new Error('Expected empty Seat');
    expect(hasVacantOrganizationSeat(state, seat.positionId)).toBe(true);

    seat.currentAppointmentId = 'stale-appointment';
    expect(hasVacantOrganizationSeat(state, seat.positionId)).toBe(false);
    seat.currentAppointmentId = null;
    seat.occupiedAtDay = 1;
    expect(hasVacantOrganizationSeat(state, seat.positionId)).toBe(false);
  });

  it('active Vacancy selector 只返回 open/selecting', () => {
    const state = createInitialState().organization;
    const vacancy = state.vacancies[0];
    if (!vacancy) throw new Error('Expected initial Vacancy');
    expect(findActiveVacancyBySeat(state, vacancy.seatId)?.vacancyId).toBe(vacancy.vacancyId);
    expect(findActiveVacanciesByPosition(state, vacancy.positionId)).toContainEqual(vacancy);
    vacancy.status = 'filled';
    expect(findActiveVacancyBySeat(state, vacancy.seatId)).toBeUndefined();
    expect(findActiveVacanciesByPosition(state, vacancy.positionId)).not.toContainEqual(vacancy);
  });
});
