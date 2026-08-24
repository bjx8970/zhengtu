/**
 * 玩家任职与组织 Seat occupant 同步事务测试。
 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../game-store';
import { releasePlayerSeat, transitionPlayerSeat } from '../organization-seat-transaction';

describe('organization seat transaction', () => {
  it('原子释放旧 Seat 并占据目标 Seat', () => {
    const state = createInitialState();
    const previousAppointmentId = state.career.appointment.appointmentId;
    const nextAppointment = {
      ...state.career.appointment,
      appointmentId: 'appointment:deputy',
      positionId: 'admin_l2_0',
      leadershipRank: 'township_deputy' as const,
      startedAtDay: 720,
      probation: null,
    };

    expect(transitionPlayerSeat(state.organization, previousAppointmentId, nextAppointment)).toBe(
      true,
    );
    expect(
      state.organization.seats.find((seat) => seat.positionId === 'admin_l1_0')?.occupant,
    ).toBeNull();
    expect(state.organization.seats.find((seat) => seat.positionId === 'admin_l2_0')).toMatchObject(
      {
        occupant: { type: 'player', id: 'player' },
        currentAppointmentId: 'appointment:deputy',
        occupiedAtDay: 720,
      },
    );
  });

  it('目标 Seat 已占用时不修改旧 Seat', () => {
    const state = createInitialState();
    const target = state.organization.seats.find((seat) => seat.positionId === 'admin_l2_0');
    if (!target) throw new Error('Expected target seat');
    target.occupant = { type: 'npc', id: 'cadre_chen_ming' };
    target.currentAppointmentId = 'occupied';
    target.occupiedAtDay = 0;

    expect(
      transitionPlayerSeat(state.organization, state.career.appointment.appointmentId, {
        ...state.career.appointment,
        appointmentId: 'appointment:blocked',
        positionId: 'admin_l2_0',
      }),
    ).toBe(false);
    expect(
      state.organization.seats.find((seat) => seat.positionId === 'admin_l1_0')?.occupant,
    ).toEqual({ type: 'player', id: 'player' });
  });

  it('职业阶段结束时释放玩家 Seat', () => {
    const state = createInitialState();

    expect(releasePlayerSeat(state.organization, state.career.appointment.appointmentId)).toBe(
      true,
    );
    expect(state.organization.seats.some((seat) => seat.occupant?.type === 'player')).toBe(false);
    expect(releasePlayerSeat(state.organization, 'missing-appointment')).toBe(false);
  });
});
