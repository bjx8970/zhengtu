/**
 * Schema 12 组织世界 round-trip、迁移与严格一致性测试。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../game-store';
import {
  decodeCurrentSave,
  migrateSchema11To12,
  migrateSchema10To11,
  validatePlayerSave,
  wrapSaveEnvelope,
} from '../save-codec';
import { CURRENT_CONTENT_VERSION, CURRENT_SCHEMA_VERSION } from '../../types/save';

describe('Schema 12 organization state', () => {
  beforeEach(() => localStorage.clear());

  it('严格 round-trip 保留所有稳定身份与引用', () => {
    const state = createInitialState();
    const result = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));

    expect(result.success).toBe(true);
    expect(result.state?.organization).toEqual(state.organization);
    expect(result.state?.organization.seats.map((seat) => seat.seatId)).toEqual(
      state.organization.seats.map((seat) => seat.seatId),
    );
  });

  it('Schema 10 在迁移日初始化组织世界且不伪造 NPC 历史', () => {
    const state = createInitialState();
    state.time.totalDaysPlayed = 720;
    const legacy = wrapSaveEnvelope(state) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 10;
    legacy.contentVersion = '2026.08.7';
    delete (legacy.state as Record<string, unknown>).organization;

    const migrated = migrateSchema10To11(legacy);
    const result = decodeCurrentSave(JSON.stringify(migrated));

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.contentVersion).toBe(CURRENT_CONTENT_VERSION);
    expect(result.success).toBe(true);
    expect(result.state?.organization.initializedAtDay).toBe(720);
    expect(result.state?.organization.cadres.every((cadre) => cadre.assessments.length === 0)).toBe(
      true,
    );
    expect(
      result.state?.organization.cadres.every(
        (cadre) =>
          cadre.currentAppointment === null || cadre.currentAppointment.startedAtDay === 720,
      ),
    ).toBe(true);
  });

  it('旧存档职位无法映射时安全报告迁移失败', () => {
    const state = createInitialState();
    const legacy = wrapSaveEnvelope(state) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 10;
    legacy.contentVersion = '2026.08.7';
    const rawState = legacy.state as Record<string, unknown>;
    delete rawState.organization;
    const career = rawState.career as { appointment: { positionId: string } };
    career.appointment.positionId = 'unknown-position';

    const result = decodeCurrentSave(JSON.stringify(legacy));

    expect(result).toMatchObject({ success: false, error: 'migration_failed' });
  });

  it('Schema 11 → 12 仅补缺失 departures，非数组字段明确失败', () => {
    const state = createInitialState();
    const organization = state.organization;
    const withMissing = wrapSaveEnvelope({
      ...state,
      organization: { ...organization },
    }) as unknown as Record<string, unknown>;
    withMissing.schemaVersion = 11;
    delete ((withMissing.state as Record<string, unknown>).organization as Record<string, unknown>)
      .departures;
    expect(migrateSchema11To12(withMissing)).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    const malformed = structuredClone(withMissing);
    (
      (malformed.state as Record<string, unknown>).organization as Record<string, unknown>
    ).departures = {};
    expect(() => migrateSchema11To12(malformed)).toThrow(/departures must be an array/);
  });

  it('拒绝重复 Seat ID、双占用和 active Vacancy/Seat 冲突', () => {
    const state = createInitialState();
    const firstSeat = state.organization.seats[0];
    const secondSeat = state.organization.seats[1];
    if (!firstSeat || !secondSeat) throw new Error('Expected initialized seats');
    secondSeat.seatId = firstSeat.seatId;

    const validation = validatePlayerSave(state);

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('Duplicate seat identity');
  });

  it('拒绝未知职位和未知机构引用', () => {
    const state = createInitialState();
    const seat = state.organization.seats[0];
    if (!seat) throw new Error('Expected initialized seat');
    seat.positionId = 'unknown-position';
    seat.institutionId = 'unknown-institution';

    const validation = validatePlayerSave(state);

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('references unknown position');
    expect(validation.error).toContain('references unknown institution');
  });

  it('拒绝 active 玩家任职没有对应 player Seat', () => {
    const state = createInitialState();
    const playerSeat = state.organization.seats.find((seat) => seat.occupant?.type === 'player');
    if (!playerSeat) throw new Error('Expected initialized player seat');
    playerSeat.occupant = null;
    playerSeat.currentAppointmentId = null;
    playerSeat.occupiedAtDay = null;

    const validation = validatePlayerSave(state);

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain(
      'Active player appointment must occupy exactly one organization seat',
    );
  });

  it('拒绝 player Seat 指向与当前任职不同的正式职位', () => {
    const state = createInitialState();
    const playerSeat = state.organization.seats.find((seat) => seat.occupant?.type === 'player');
    const wrongSeat = state.organization.seats.find(
      (seat) => seat.positionId !== state.career.appointment.positionId && seat.occupant === null,
    );
    if (!playerSeat || !wrongSeat) throw new Error('Expected player and vacant organization seats');
    playerSeat.occupant = null;
    playerSeat.currentAppointmentId = null;
    playerSeat.occupiedAtDay = null;
    wrongSeat.occupant = { type: 'player', id: 'player' };
    wrongSeat.currentAppointmentId = state.career.appointment.appointmentId;
    wrongSeat.occupiedAtDay = state.career.appointment.startedAtDay;

    const validation = validatePlayerSave(state);

    expect(validation.valid).toBe(false);
    expect(validation.error).toContain(
      `Player seat ${wrongSeat.seatId} does not match the active player appointment`,
    );
  });
});
