/**
 * Schema 12 组织世界 round-trip、迁移与严格一致性测试。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../game-store';
import {
  decodeCurrentSave,
  migrateSchema11To12,
  migrateSchema10To11,
  migrateSchema12To13,
  migrateSchema13To14,
  validatePlayerSave,
  wrapSaveEnvelope,
} from '../save-codec';
import { CURRENT_CONTENT_VERSION, CURRENT_SCHEMA_VERSION } from '../../types/save';
import type { StaffingSelection, VacancyInstance } from '../../types/organization';
import { RELATIVE_SELECTION_STAGES } from '../../domain/career/state';

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

  it('Schema 12 → 13 仅补齐缺失 Vacancy 审计字段和 vacancyId', () => {
    const state = createInitialState();
    const organization = state.organization;
    const seat = organization.seats.find((item) => item.occupant === null);
    if (!seat) throw new Error('Expected vacant Seat');
    const legacyVacancy = {
      vacancyId: 'vacancy:legacy-departure',
      seatId: seat.seatId,
      positionId: seat.positionId,
      positionNameSnapshot: seat.positionNameSnapshot,
      institutionId: seat.institutionId,
      institutionNameSnapshot: seat.institutionNameSnapshot,
      regionId: seat.regionId,
      institutionLevel: seat.institutionLevel,
      positionDomain: seat.positionDomain,
      leadershipRank: seat.leadershipRank,
      openedAtDay: 1,
      reason: 'retirement',
      status: 'open',
      sourceType: 'cadre_lifecycle',
      sourceId: 'departure:legacy-departure',
      closesAtDay: null,
      closedAtDay: null,
      selectionId: null,
    };
    const raw = wrapSaveEnvelope({
      ...state,
      organization: {
        ...organization,
        vacancies: [legacyVacancy as unknown as VacancyInstance],
      },
    }) as unknown as Record<string, unknown>;
    raw.schemaVersion = 12;
    const rawState = raw.state as Record<string, unknown>;
    const career = rawState.career as Record<string, unknown>;
    career.opportunities = [];
    (rawState.organization as Record<string, unknown>).processedProducerKeys = [];

    const migrated = migrateSchema12To13(raw);
    expect(migrated.schemaVersion).toBe(13);
    const migrated14 = migrateSchema13To14(migrated);
    const migratedState = migrated.state as Record<string, unknown>;
    const migratedOrg = migratedState.organization as Record<string, unknown>;
    expect((migratedOrg.vacancies as Array<Record<string, unknown>>)[0]).toMatchObject({
      filledBy: null,
      filledAppointmentId: null,
      cancellationReason: null,
    });
    const decoded = decodeCurrentSave(JSON.stringify(migrated14));
    expect(decoded.success).toBe(true);

    const malformed = structuredClone(raw);
    const malformedState = malformed.state as Record<string, unknown>;
    const malformedOrg = malformedState.organization as Record<string, unknown>;
    const malformedVacancy = (malformedOrg.vacancies as Array<Record<string, unknown>>)[0];
    if (!malformedVacancy) throw new Error('Expected legacy Vacancy');
    malformedVacancy.filledBy = 42;
    const malformedMigrated = migrateSchema12To13(malformed);
    const malformedVacancies = (
      (malformedMigrated.state as Record<string, unknown>).organization as Record<string, unknown>
    ).vacancies as Array<Record<string, unknown>>;
    expect(
      malformedVacancies.find((vacancy) => vacancy.vacancyId === malformedVacancy.vacancyId),
    ).toMatchObject({
      filledBy: 42,
    });
    expect(decodeCurrentSave(JSON.stringify(malformedMigrated)).success).toBe(false);
  });

  it('Schema 13 → 14 确定迁移 legacy Selection、终态流程字段并保持幂等', () => {
    const state = createInitialState();
    const vacancy = state.organization.vacancies[0];
    if (!vacancy) throw new Error('Expected initial Vacancy');
    const appointment = state.career.appointment;
    const candidate = {
      candidateId: 'player',
      candidateType: 'player',
      currentPositionId: appointment.positionId,
      institutionId: appointment.institutionId,
      regionId: appointment.regionId,
      leadershipRank: appointment.leadershipRank,
      civilServiceRank: state.career.civilServiceRank,
      appointmentStartedAtDay: appointment.startedAtDay,
      serviceStartedAtDay: 0,
      assessments: [],
      specialties: {},
      restrictionTypes: [],
      scoringInputs: { assessment: 50, specialty: 0, service: 0, network: 0, integrity: 50 },
    };
    const stageAudits = RELATIVE_SELECTION_STAGES.map((stage, index) => ({
      stage,
      resolvedAtDay: index + 1,
      survivingCandidateIds: ['player'],
      detail: 'legacy stage',
      candidates: [{ candidateId: 'player', score: 50, rank: 1, eliminated: false }],
    }));
    const legacySelection = {
      selectionId: 'legacy-completed-selection',
      vacancyId: vacancy.vacancyId,
      status: 'completed',
      currentStage: 'appointment',
      startedAtDay: 1,
      completedAtDay: 6,
      candidates: [candidate],
      stageAudits,
      winner: { type: 'player', id: 'player' },
      playerCareerProcessId: null,
      randomDraws: Array.from({ length: 6 }, () => 0.5),
    };
    const raw = wrapSaveEnvelope({
      ...state,
      organization: {
        ...state.organization,
        selections: [legacySelection as unknown as StaffingSelection],
      },
    }) as unknown as Record<string, unknown>;
    raw.schemaVersion = 13;
    const migrated = migrateSchema13To14(raw);
    expect(migrated.schemaVersion).toBe(14);
    const selection = (
      ((migrated.state as Record<string, unknown>).organization as Record<string, unknown>)
        .selections as Array<Record<string, unknown>>
    )[0];
    expect(selection).toMatchObject({
      rulesVersion: 'legacy-schema-13',
      winnerId: 'player',
      failure: null,
    });
    expect(selection?.stageResults).toHaveLength(6);
    expect((selection?.candidates as Array<Record<string, unknown>>)[0]?.experiences).toEqual([]);
    expect(migrateSchema13To14(migrated)).toEqual(migrated);
    expect(decodeCurrentSave(JSON.stringify(migrated)).success).toBe(true);

    const validSchema14 = structuredClone(migrated);
    const validOrganization = (validSchema14.state as Record<string, unknown>)
      .organization as Record<string, unknown>;
    const validSelection = structuredClone(selection);
    if (!validSelection) throw new Error('Expected migrated Selection');
    const npcCandidate = { ...candidate, candidateId: 'npc-1', candidateType: 'npc' };
    validSelection.candidates = [candidate, npcCandidate];
    validSelection.stageResults = RELATIVE_SELECTION_STAGES.map((stage, index) => {
      const finalStage = index === RELATIVE_SELECTION_STAGES.length - 1;
      const candidateResults = [
        { candidateId: 'player', score: 80, rank: 1, eliminated: false },
        { candidateId: 'npc-1', score: 70, rank: 2, eliminated: finalStage },
      ];
      return {
        stage,
        resolvedAtDay: index + 1,
        candidates: candidateResults,
        survivingCandidateIds: finalStage ? ['player'] : ['player', 'npc-1'],
      };
    });
    validOrganization.selections = [validSelection];
    validSelection.randomDraws = Array.from({ length: 12 }, () => 0.5);
    const validSerialized = JSON.stringify(validSchema14);
    const validResult = decodeCurrentSave(validSerialized);
    expect(validResult.success).toBe(true);

    const tamperedDecode = (
      mutate: (stageResults: Array<Record<string, unknown>>) => void,
    ): boolean => {
      const tampered = structuredClone(validSchema14);
      const tamperedOrganization = (tampered.state as Record<string, unknown>)
        .organization as Record<string, unknown>;
      const tamperedSelection = (
        tamperedOrganization.selections as Array<Record<string, unknown>>
      )[0];
      if (!tamperedSelection) throw new Error('Expected Schema 14 Selection');
      mutate(tamperedSelection.stageResults as Array<Record<string, unknown>>);
      return decodeCurrentSave(JSON.stringify(tampered)).success;
    };
    expect(
      tamperedDecode((stageResults) => {
        const first = stageResults[0];
        if (!first) throw new Error('Expected first stage');
        const candidates = first.candidates as Array<Record<string, unknown>>;
        first.candidates = [candidates[0]];
      }),
    ).toBe(false);
    expect(
      tamperedDecode((stageResults) => {
        const first = stageResults[0];
        const second = stageResults[1];
        if (!first || !second) throw new Error('Expected first two stages');
        const candidates = first.candidates as Array<Record<string, unknown>>;
        second.candidates = [candidates[0]];
      }),
    ).toBe(false);
    expect(
      tamperedDecode((stageResults) => {
        const first = stageResults[0];
        if (!first) throw new Error('Expected first stage');
        first.survivingCandidateIds = ['npc-1', 'player'];
      }),
    ).toBe(false);

    const active = structuredClone(raw);
    const activeOrganization = (active.state as Record<string, unknown>).organization as Record<
      string,
      unknown
    >;
    activeOrganization.selections = [
      { ...legacySelection, status: 'active', winner: null, stageAudits: [] },
    ];
    const activeMigrated = migrateSchema13To14(active);
    const activeMigratedOrganization = (activeMigrated.state as Record<string, unknown>)
      .organization as Record<string, unknown>;
    const activeSelection = (
      activeMigratedOrganization.selections as Array<Record<string, unknown>>
    )[0];
    expect(activeSelection).toMatchObject({
      status: 'failed',
      winnerId: null,
      failure: { code: 'stage_no_survivors', stage: 'appointment' },
    });
    expect(decodeCurrentSave(JSON.stringify(activeMigrated)).success).toBe(true);

    const invalidExperiences = structuredClone(migrated);
    const invalidOrganization = (invalidExperiences.state as Record<string, unknown>)
      .organization as Record<string, unknown>;
    const invalidSelection = (invalidOrganization.selections as Array<Record<string, unknown>>)[0];
    if (!invalidSelection) throw new Error('Expected migrated Selection');
    const invalidCandidate = (invalidSelection.candidates as Array<Record<string, unknown>>)[0];
    if (!invalidCandidate) throw new Error('Expected migrated candidate');
    invalidCandidate.experiences = [{ invalid: true }];
    expect(decodeCurrentSave(JSON.stringify(invalidExperiences)).success).toBe(false);

    const malformed = structuredClone(raw);
    const malformedSelection = (
      ((malformed.state as Record<string, unknown>).organization as Record<string, unknown>)
        .selections as Array<Record<string, unknown>>
    )[0];
    if (!malformedSelection) throw new Error('Expected migrated Selection');
    malformedSelection.rulesVersion = 42;
    const malformedMigrated = migrateSchema13To14(malformed);
    expect(decodeCurrentSave(JSON.stringify(malformedMigrated)).success).toBe(false);
  });

  it('Schema 12 空 Seat 按 seatId 稳定迁移为 initial Vacancy 与 producer key', () => {
    const state = createInitialState();
    const emptySeats = state.organization.seats.filter((seat) => seat.occupant === null);
    expect(emptySeats.length).toBeGreaterThanOrEqual(2);
    const raw = wrapSaveEnvelope({
      ...state,
      organization: {
        ...state.organization,
        vacancies: [],
        processedProducerKeys: [],
      },
    }) as unknown as Record<string, unknown>;
    raw.schemaVersion = 12;

    const migrated = migrateSchema12To13(raw);
    const migratedOrganization = (migrated.state as Record<string, unknown>).organization as Record<
      string,
      unknown
    >;
    const vacancies = migratedOrganization.vacancies as Array<Record<string, unknown>>;
    const sortedSeats = [...emptySeats].sort((left, right) =>
      left.seatId.localeCompare(right.seatId),
    );
    expect(vacancies.map((vacancy) => vacancy.seatId)).toEqual(
      sortedSeats.map((seat) => seat.seatId),
    );
    expect(vacancies.every((vacancy) => vacancy.reason === 'initial_opening')).toBe(true);
    expect(migratedOrganization.processedProducerKeys).toEqual(
      sortedSeats.map((seat) => `vacancy:initial:${seat.seatId}`),
    );
    const decoded = decodeCurrentSave(JSON.stringify(migrated));
    expect(decoded.success).toBe(true);
    if (!decoded.success || !decoded.state) return;
    const roundTrip = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(decoded.state)));
    expect(roundTrip.success).toBe(true);
    expect(
      roundTrip.state?.organization.vacancies.every(
        (vacancy) => vacancy.reason === 'initial_opening',
      ),
    ).toBe(true);
  });

  it('Schema 12 机会 sourceId 只移除一个 vacancy 前缀并保持迁移幂等', () => {
    const state = createInitialState();
    const existingInitial = state.organization.vacancies[0];
    if (!existingInitial) throw new Error('Expected initial Vacancy');
    const historicalVacancyId = 'vacancy:departure:1';
    state.organization.vacancies.push({
      ...structuredClone(existingInitial),
      vacancyId: historicalVacancyId,
      sourceId: 'departure:1',
    });
    const sources: Array<{ sourceType: string; sourceId: unknown }> = [
      { sourceType: 'vacancy', sourceId: `vacancy:${historicalVacancyId}` },
      { sourceType: 'vacancy', sourceId: `vacancy:${existingInitial.vacancyId}` },
      { sourceType: 'vacancy', sourceId: 'vacancy:initial:seat:legacy' },
      { sourceType: 'assessment', sourceId: 'assessment:1' },
      { sourceType: 'vacancy', sourceId: 'vacancy:' },
    ];
    const opportunities: Array<Record<string, unknown>> = sources.map((source, index) => ({
      id: `migration-source-${index}`,
      source,
    }));
    opportunities.push({
      id: 'migration-existing-vacancy-id',
      source: { sourceType: 'assessment', sourceId: 'assessment:existing' },
      vacancyId: 'vacancy:ghost-existing',
    });
    const raw = wrapSaveEnvelope({
      ...state,
      career: {
        ...state.career,
        opportunities: opportunities as unknown as typeof state.career.opportunities,
      },
    }) as unknown as Record<string, unknown>;
    raw.schemaVersion = 12;

    const migrated = migrateSchema12To13(raw);
    const migratedOpportunities = (
      (migrated.state as Record<string, unknown>).career as Record<string, unknown>
    ).opportunities as Array<Record<string, unknown>>;
    expect(migratedOpportunities.map((opportunity) => opportunity.vacancyId)).toEqual([
      historicalVacancyId,
      existingInitial.vacancyId,
      null,
      null,
      null,
      'vacancy:ghost-existing',
    ]);
    const migratedOrganization = (migrated.state as Record<string, unknown>).organization as Record<
      string,
      unknown
    >;
    const migratedVacancyIds = (
      migratedOrganization.vacancies as Array<Record<string, unknown>>
    ).map((vacancy) => vacancy.vacancyId);
    expect(migratedVacancyIds).toContain(historicalVacancyId);
    expect(migratedVacancyIds).not.toContain('initial:seat:legacy');
    expect(migrateSchema12To13(migrated)).toEqual(migrated);
  });

  it('已有匹配的 active initial Vacancy 与 key 时迁移幂等，occupied Seat 不新建 Vacancy', () => {
    const state = createInitialState();
    const beforeVacancies = structuredClone(state.organization.vacancies);
    const beforeKeys = [...state.organization.processedProducerKeys];
    const raw = wrapSaveEnvelope(state) as unknown as Record<string, unknown>;
    raw.schemaVersion = 12;

    const migrated = migrateSchema12To13(raw);
    const organization = (migrated.state as Record<string, unknown>).organization as Record<
      string,
      unknown
    >;
    expect(organization.vacancies).toEqual(beforeVacancies);
    expect(organization.processedProducerKeys).toEqual(beforeKeys);
    const occupiedSeatIds = state.organization.seats
      .filter((seat) => seat.occupant !== null)
      .map((seat) => seat.seatId);
    expect(
      (organization.vacancies as Array<Record<string, unknown>>).every(
        (vacancy) => !occupiedSeatIds.includes(vacancy.seatId as string),
      ),
    ).toBe(true);
  });

  it('initial Vacancy ID 或 producer key 冲突时迁移明确失败', () => {
    const state = createInitialState();
    const seat = state.organization.seats.find((item) => item.occupant === null);
    if (!seat) throw new Error('Expected empty Seat');
    const rawWithIdConflict = wrapSaveEnvelope({
      ...state,
      organization: {
        ...state.organization,
        vacancies: [
          {
            vacancyId: `vacancy:initial:${seat.seatId}`,
            seatId: seat.seatId,
            positionId: seat.positionId,
            positionNameSnapshot: seat.positionNameSnapshot,
            institutionId: seat.institutionId,
            institutionNameSnapshot: seat.institutionNameSnapshot,
            regionId: seat.regionId,
            institutionLevel: seat.institutionLevel,
            positionDomain: seat.positionDomain,
            leadershipRank: seat.leadershipRank,
            openedAtDay: state.organization.initializedAtDay,
            reason: 'initial_opening',
            status: 'open',
            sourceType: 'system',
            sourceId: 'initial:conflict',
            closesAtDay: null,
            closedAtDay: null,
            selectionId: null,
            filledBy: null,
            filledAppointmentId: null,
            cancellationReason: null,
          },
        ],
        processedProducerKeys: [],
      },
    }) as unknown as Record<string, unknown>;
    rawWithIdConflict.schemaVersion = 12;
    expect(() => migrateSchema12To13(rawWithIdConflict)).toThrow(/initial Vacancy ID conflict/);

    const rawWithKeyConflict = wrapSaveEnvelope({
      ...state,
      organization: {
        ...state.organization,
        vacancies: [],
        processedProducerKeys: [`vacancy:initial:${seat.seatId}`],
      },
    }) as unknown as Record<string, unknown>;
    rawWithKeyConflict.schemaVersion = 12;
    expect(() => migrateSchema12To13(rawWithKeyConflict)).toThrow(
      /initial Vacancy producer key conflict/,
    );
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
