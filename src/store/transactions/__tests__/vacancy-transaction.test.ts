/** Vacancy Store 事务的原子性、幂等与生命周期测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../game-store';
import type { AppointmentCareerOpportunity } from '../../../domain/career/state';
import { getConfigLoader } from '../../../config/loader';
import type { CadreDepartureFact } from '../../../types/organization';
import { processCascadeSignalsInTransaction } from '../../reducers/event-reducer';
import {
  cancelVacancyInTransaction,
  consumeCadreDeparturesInTransaction,
  expireVacancyInTransaction,
  fillVacancyInTransaction,
  openVacancyForReleasedSeatInTransaction,
} from '../vacancy-transaction';

function retiredState() {
  const state = createInitialState();
  // Keep this producer unit focused on the departure transition; initial empty-seat
  // vacancies are covered by the initialization and migration tests.
  state.organization.vacancies = [];
  state.organization.processedProducerKeys = [];
  const cadre = state.organization.cadres.find((item) => item.currentAppointment);
  if (!cadre?.currentAppointment) throw new Error('Expected an assigned NPC');
  const appointment = cadre.currentAppointment;
  const experience = cadre.experiences.find((item) => item.endedAtDay === null);
  const seat = state.organization.seats.find(
    (item) => item.occupant?.type === 'npc' && item.occupant.id === cadre.cadreId,
  );
  if (!experience || !seat) throw new Error('Expected NPC experience and Seat');
  const day = 360;
  experience.endedAtDay = day;
  experience.endReason = 'retirement';
  cadre.currentAppointment = null;
  cadre.status = 'retired';
  cadre.exitedAtDay = day;
  cadre.exitReason = 'retirement';
  seat.occupant = null;
  seat.currentAppointmentId = null;
  seat.occupiedAtDay = null;
  const departure: CadreDepartureFact = {
    departureId: `departure:${cadre.cadreId}:${appointment.appointmentId}:${day}`,
    cadreId: cadre.cadreId,
    appointmentId: appointment.appointmentId,
    experienceId: experience.id,
    seatId: seat.seatId,
    positionId: seat.positionId,
    institutionId: seat.institutionId,
    regionId: seat.regionId,
    occurredAtDay: day,
    reason: 'retirement',
    sourceType: 'cadre_lifecycle',
  };
  state.organization.departures.push(departure);
  return { state, departure, seat };
}

function openState() {
  const source = retiredState();
  const opened = consumeCadreDeparturesInTransaction(source.state, 360, () => 'unused-id');
  if (!opened.success || opened.vacancies.length !== 1)
    throw new Error('Expected one opened Vacancy');
  return { ...source, vacancy: opened.vacancies[0] };
}

function promotionState() {
  const state = createInitialState();
  const oldSeat = state.organization.seats.find((seat) => seat.occupant?.type === 'player');
  const targetVacancy = state.organization.vacancies.find(
    (vacancy) => vacancy.status === 'open' && vacancy.seatId !== oldSeat?.seatId,
  );
  if (!oldSeat || !targetVacancy) throw new Error('Expected player Seat and target Vacancy');
  return { state, oldSeat, targetVacancy };
}

function linkedCareerState() {
  const { state, targetVacancy } = promotionState();
  const opportunity: AppointmentCareerOpportunity = {
    id: 'opportunity:linked-vacancy',
    definitionId: 'township_deputy_leadership_vacancy',
    type: 'leadership_vacancy',
    status: 'in_process',
    source: {
      sourceType: 'vacancy',
      sourceId: `vacancy:${targetVacancy.vacancyId}`,
      signalId: `signal:${targetVacancy.vacancyId}:opened`,
      description: 'vacancy.opened',
    },
    vacancyId: targetVacancy.vacancyId,
    sourceSignal: null,
    target: {
      positionId: targetVacancy.positionId,
      positionName: targetVacancy.positionNameSnapshot,
      institutionId: targetVacancy.institutionId,
      institutionName: targetVacancy.institutionNameSnapshot,
      regionId: targetVacancy.regionId,
      institutionLevel: targetVacancy.institutionLevel,
      positionDomain: targetVacancy.positionDomain,
      leadershipRank: targetVacancy.leadershipRank,
    },
    appointmentType: 'substantive',
    appointmentReason: 'promotion',
    appearedAtDay: 0,
    expiresAtDay: null,
    acceptedAtDay: 10,
    rejectedAtDay: 11,
    resolvedAtDay: 12,
    cancelledAtDay: null,
    requiresSelection: false,
    eligibilityConditions: [],
    finalOutcome: 'appointed',
    reason: 'linked Vacancy test',
  };
  const unrelated: AppointmentCareerOpportunity = {
    ...structuredClone(opportunity),
    id: 'opportunity:unrelated-vacancy',
    vacancyId: 'vacancy:unrelated',
    source: { ...opportunity.source, sourceId: 'vacancy:unrelated' },
    status: 'accepted',
  };
  state.career.opportunities = [opportunity, unrelated];
  state.career.activeProcess = {
    id: 'process:linked-vacancy',
    type: 'appointment_review',
    status: 'active',
    opportunityId: opportunity.id,
    currentStage: 'appointment',
    startedAtDay: 10,
    completedAtDay: null,
    stageResults: [],
  };
  return { state, targetVacancy, opportunity, unrelated };
}

describe('vacancy transaction', () => {
  it('consumes retirement departure into one stable Vacancy and producer key', () => {
    const { state, departure } = retiredState();
    const result = consumeCadreDeparturesInTransaction(state, 360, () => 'unused-id');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.vacancies).toHaveLength(1);
    expect(result.vacancies[0]).toMatchObject({
      vacancyId: `vacancy:${departure.departureId}`,
      sourceType: 'cadre_lifecycle',
      sourceId: departure.departureId,
      status: 'open',
      filledBy: null,
      filledAppointmentId: null,
      cancellationReason: null,
    });
    expect(state.organization.processedProducerKeys).toEqual([
      `vacancy:cadre_lifecycle:${departure.departureId}`,
    ]);
  });

  it('consumes unassigned departure key without creating Vacancy', () => {
    const state = createInitialState();
    state.organization.vacancies = [];
    state.organization.processedProducerKeys = [];
    const cadre = state.organization.cadres.find((item) => !item.currentAppointment);
    if (!cadre) throw new Error('Expected unassigned NPC');
    const departure: CadreDepartureFact = {
      departureId: `departure:${cadre.cadreId}:unassigned:360`,
      cadreId: cadre.cadreId,
      appointmentId: null,
      experienceId: null,
      seatId: null,
      positionId: null,
      institutionId: null,
      regionId: null,
      occurredAtDay: 360,
      reason: 'disciplinary_exit',
      sourceType: 'cadre_lifecycle',
    };
    state.organization.departures.push(departure);

    const result = consumeCadreDeparturesInTransaction(state, 360, () => 'unused-id');
    expect(result).toMatchObject({ success: true, vacancies: [] });
    expect(state.organization.processedProducerKeys).toEqual([
      `vacancy:cadre_lifecycle:${departure.departureId}`,
    ]);
  });

  it('replaying the same producer is a no-op and does not emit another signal', () => {
    const { state } = retiredState();
    const first = consumeCadreDeparturesInTransaction(state, 360, () => 'unused-id');
    if (!first.success) throw new Error('Expected initial producer success');
    const before = structuredClone(state.organization);
    const second = consumeCadreDeparturesInTransaction(state, 360, () => 'unused-id');

    expect(second).toMatchObject({ success: true, vacancies: [], emittedSignals: [] });
    expect(state.organization).toEqual(before);
  });

  it('rejects a partially missing departure Seat reference without consuming its key', () => {
    const { state, departure } = retiredState();
    departure.seatId = null;
    const before = structuredClone(state.organization);
    const result = consumeCadreDeparturesInTransaction(state, 360, () => 'unused-id');

    expect(result).toMatchObject({ success: false, error: 'producer_conflict' });
    expect(state.organization).toEqual(before);
  });

  it('rejects a departure whose Seat target snapshot conflicts', () => {
    const { state, departure } = retiredState();
    departure.positionId = 'position:wrong';
    const before = structuredClone(state.organization);
    const result = consumeCadreDeparturesInTransaction(state, 360, () => 'unused-id');

    expect(result).toMatchObject({ success: false, error: 'producer_conflict' });
    expect(state.organization).toEqual(before);
  });

  it('rejects a second active Vacancy on the same Seat without partial mutation', () => {
    const { state, seat } = retiredState();
    const first = openVacancyForReleasedSeatInTransaction(
      state,
      {
        seatId: seat.seatId,
        reason: 'retirement',
        sourceType: 'system',
        sourceId: 'first',
        openedAtDay: 360,
        closesAtDay: null,
        vacancyId: 'vacancy:first',
      },
      () => 'unused-id',
    );
    expect(first.success).toBe(true);
    const before = structuredClone(state.organization);
    const second = openVacancyForReleasedSeatInTransaction(
      state,
      {
        seatId: seat.seatId,
        reason: 'retirement',
        sourceType: 'system',
        sourceId: 'second',
        openedAtDay: 360,
        closesAtDay: null,
        vacancyId: 'vacancy:second',
      },
      () => 'unused-id',
    );
    expect(second).toMatchObject({ success: false, error: 'active_vacancy_exists' });
    expect(state.organization).toEqual(before);
  });

  it('fills, cancels and expires Vacancy atomically', () => {
    const filled = openState();
    const filledVacancy = filled.vacancy;
    if (!filledVacancy) throw new Error('Expected Vacancy');
    const fill = fillVacancyInTransaction(filled.state, {
      vacancyId: filledVacancy.vacancyId,
      occupant: { type: 'npc', id: 'npc:test-fill' },
      appointmentId: 'appointment:new',
      selectionId: null,
      opportunityId: null,
      currentDay: 361,
      idFactory: () => 'unused-id',
      previousAppointmentId: null,
      releasedSeatReason: null,
    });
    expect(fill).toMatchObject({ success: true, vacancy: { status: 'filled' } });
    if (!filled.vacancy) throw new Error('Expected Vacancy');
    expect(
      filled.state.organization.seats.find((item) => item.seatId === filled.seat.seatId)?.occupant,
    ).toEqual({ type: 'npc', id: 'npc:test-fill' });
    expect(
      filled.state.organization.vacancies.find((item) => item.vacancyId === filledVacancy.vacancyId)
        ?.status,
    ).toBe('filled');

    const cancelled = openState();
    if (!cancelled.vacancy) throw new Error('Expected Vacancy');
    const cancel = cancelVacancyInTransaction(cancelled.state, {
      vacancyId: cancelled.vacancy.vacancyId,
      cancellationReason: 'system',
      currentDay: 361,
      idFactory: () => 'unused-id',
    });
    expect(cancel).toMatchObject({
      success: true,
      vacancy: { status: 'cancelled', cancellationReason: 'system' },
    });

    const expired = openState();
    if (!expired.vacancy) throw new Error('Expected Vacancy');
    expired.vacancy.closesAtDay = 361;
    const expire = expireVacancyInTransaction(expired.state, {
      vacancyId: expired.vacancy.vacancyId,
      currentDay: 361,
      idFactory: () => 'unused-id',
    });
    expect(expire).toMatchObject({
      success: true,
      vacancy: { status: 'expired', cancellationReason: 'expired' },
    });
  });

  it.each([['cancel', 'cancelled'] as const, ['expire', 'expired'] as const])(
    'clears linked career state when Vacancy %s closes',
    (operation, terminalStatus) => {
      const { state, targetVacancy, opportunity, unrelated } = linkedCareerState();
      const unrelatedBefore = structuredClone(unrelated);
      if (operation === 'expire') targetVacancy.closesAtDay = 10;
      const result =
        operation === 'cancel'
          ? cancelVacancyInTransaction(state, {
              vacancyId: targetVacancy.vacancyId,
              cancellationReason: 'system',
              currentDay: 20,
              idFactory: () => 'unused-id',
            })
          : expireVacancyInTransaction(state, {
              vacancyId: targetVacancy.vacancyId,
              currentDay: 20,
              idFactory: () => 'unused-id',
            });

      expect(result).toMatchObject({
        success: true,
        vacancy: { status: terminalStatus },
      });
      const invalidated = state.career.opportunities.find((item) => item.id === opportunity.id);
      expect(invalidated).toMatchObject({
        status: 'cancelled',
        acceptedAtDay: null,
        rejectedAtDay: null,
        resolvedAtDay: null,
        cancelledAtDay: 20,
        finalOutcome: null,
      });
      expect(state.career.opportunities.find((item) => item.id === unrelated.id)).toEqual(
        unrelatedBefore,
      );
      expect(state.career.activeProcess).toBeNull();
      expect(state.career.completedProcesses).toHaveLength(1);
      expect(state.career.completedProcesses[0]).toMatchObject({
        opportunityId: opportunity.id,
        status: 'cancelled',
        completedAtDay: 20,
        stageResults: [expect.objectContaining({ outcome: 'cancelled', resolvedAtDay: 20 })],
      });

      if (!result.success) return;
      const definitions = getConfigLoader().getAllEventDefinitions();
      processCascadeSignalsInTransaction(
        state,
        result.emittedSignals,
        20,
        () => 0.5,
        () => 'unused-id',
        definitions,
      );
      expect(state.career.completedProcesses).toHaveLength(1);
      processCascadeSignalsInTransaction(
        state,
        result.emittedSignals,
        20,
        () => 0.5,
        () => 'unused-id',
        definitions,
      );
      expect(state.career.completedProcesses).toHaveLength(1);
    },
  );

  it('rejects mismatch and terminal fill without changing state', () => {
    const source = openState();
    if (!source.vacancy) throw new Error('Expected Vacancy');
    const before = structuredClone(source.state.organization);
    const mismatch = fillVacancyInTransaction(source.state, {
      vacancyId: source.vacancy.vacancyId,
      occupant: { type: 'npc', id: 'npc:test-fill' },
      appointmentId: 'appointment:new',
      selectionId: 'selection:wrong',
      opportunityId: null,
      currentDay: 361,
      idFactory: () => 'unused-id',
      previousAppointmentId: null,
      releasedSeatReason: null,
    });
    expect(mismatch).toMatchObject({ success: false, error: 'selection_mismatch' });
    expect(source.state.organization).toEqual(before);

    const filled = fillVacancyInTransaction(source.state, {
      vacancyId: source.vacancy.vacancyId,
      occupant: { type: 'npc', id: 'npc:test-fill' },
      appointmentId: 'appointment:new',
      selectionId: null,
      opportunityId: null,
      currentDay: 361,
      idFactory: () => 'unused-id',
      previousAppointmentId: null,
      releasedSeatReason: null,
    });
    expect(filled.success).toBe(true);
    const afterFill = structuredClone(source.state.organization);
    const terminal = fillVacancyInTransaction(source.state, {
      vacancyId: source.vacancy.vacancyId,
      occupant: { type: 'npc', id: 'npc:test-fill' },
      appointmentId: 'appointment:again',
      selectionId: null,
      opportunityId: null,
      currentDay: 362,
      idFactory: () => 'unused-id',
      previousAppointmentId: null,
      releasedSeatReason: null,
    });
    expect(terminal).toMatchObject({ success: false, error: 'vacancy_terminal' });
    expect(source.state.organization).toEqual(afterFill);
  });

  it('promotion atomically releases old Seat, opens old Vacancy, and fills target', () => {
    const { state, oldSeat, targetVacancy } = promotionState();
    const previousAppointmentId = oldSeat.currentAppointmentId;
    if (!previousAppointmentId) throw new Error('Expected previous appointment');
    const appointmentId = 'appointment:promotion';
    const result = fillVacancyInTransaction(state, {
      vacancyId: targetVacancy.vacancyId,
      occupant: { type: 'player', id: 'player' },
      appointmentId,
      selectionId: null,
      opportunityId: null,
      currentDay: 720,
      idFactory: () => 'unused-id',
      previousAppointmentId,
      releasedSeatReason: 'promotion',
    });

    expect(result).toMatchObject({
      success: true,
      vacancy: { vacancyId: targetVacancy.vacancyId },
    });
    if (!result.success) return;
    expect(result.emittedSignals.map((signal) => signal.signalType)).toEqual([
      'vacancy.filled',
      'vacancy.opened',
    ]);
    expect(state.organization.seats.find((seat) => seat.seatId === oldSeat.seatId)).toMatchObject({
      occupant: null,
      currentAppointmentId: null,
      sourceTransitionId: appointmentId,
    });
    expect(
      state.organization.seats.find((seat) => seat.seatId === targetVacancy.seatId),
    ).toMatchObject({
      occupant: { type: 'player', id: 'player' },
      currentAppointmentId: appointmentId,
    });
    expect(state.organization.vacancies).toContainEqual(
      expect.objectContaining({
        vacancyId: `vacancy:appointment:${previousAppointmentId}:${oldSeat.seatId}`,
        seatId: oldSeat.seatId,
        reason: 'promotion',
        sourceType: 'appointment',
        sourceId: previousAppointmentId,
        openedAtDay: 720,
        status: 'open',
      }),
    );
    expect(state.organization.processedProducerKeys).toContain(
      `vacancy:appointment:${previousAppointmentId}:${oldSeat.seatId}`,
    );
  });

  it('rejects an already-appointed NPC filling another open Vacancy atomically', () => {
    const state = createInitialState();
    const npcSeat = state.organization.seats.find((seat) => seat.occupant?.type === 'npc');
    if (!npcSeat || !npcSeat.occupant || npcSeat.occupant.type !== 'npc')
      throw new Error('Expected an assigned NPC');
    const targetVacancy = state.organization.vacancies.find(
      (vacancy) => vacancy.status === 'open' && vacancy.seatId !== npcSeat.seatId,
    );
    if (!targetVacancy) throw new Error('Expected another open Vacancy');
    const before = structuredClone(state);
    const result = fillVacancyInTransaction(state, {
      vacancyId: targetVacancy.vacancyId,
      occupant: structuredClone(npcSeat.occupant),
      appointmentId: 'appointment:npc-double-seat',
      selectionId: null,
      opportunityId: null,
      currentDay: 720,
      idFactory: () => 'unused-id',
      previousAppointmentId: null,
      releasedSeatReason: null,
    });

    expect(result).toMatchObject({ success: false, error: 'appointment_mismatch' });
    if (!result.success) expect(result.detail).toContain('already occupies another Seat');
    expect(state).toEqual(before);
  });

  it('支持 lateral_transfer reason，且 previous 参数必须成对提供', () => {
    const { state, oldSeat, targetVacancy } = promotionState();
    const previousAppointmentId = oldSeat.currentAppointmentId;
    if (!previousAppointmentId) throw new Error('Expected previous appointment');
    const lateral = fillVacancyInTransaction(state, {
      vacancyId: targetVacancy.vacancyId,
      occupant: { type: 'player', id: 'player' },
      appointmentId: 'appointment:lateral',
      selectionId: null,
      opportunityId: null,
      currentDay: 721,
      idFactory: () => 'unused-id',
      previousAppointmentId,
      releasedSeatReason: 'lateral_transfer',
    });
    expect(lateral).toMatchObject({ success: true });
    expect(state.organization.vacancies).toContainEqual(
      expect.objectContaining({ reason: 'lateral_transfer' }),
    );

    const { state: invalidState, targetVacancy: invalidTarget } = promotionState();
    const before = structuredClone(invalidState.organization);
    const invalid = fillVacancyInTransaction(invalidState, {
      vacancyId: invalidTarget.vacancyId,
      occupant: { type: 'player', id: 'player' },
      appointmentId: 'appointment:invalid',
      selectionId: null,
      opportunityId: null,
      currentDay: 721,
      idFactory: () => 'unused-id',
      previousAppointmentId: null,
      releasedSeatReason: 'promotion',
    });
    expect(invalid).toMatchObject({ success: false, error: 'appointment_mismatch' });
    expect(invalidState.organization).toEqual(before);
  });

  it('旧 Seat 校验、active 冲突和目标失败均原子回滚，重复调用不重复', () => {
    const scenarios = ['missing', 'occupant', 'active', 'target'] as const;
    for (const scenario of scenarios) {
      const { state, oldSeat, targetVacancy } = promotionState();
      const previousAppointmentId = oldSeat.currentAppointmentId;
      if (!previousAppointmentId) throw new Error('Expected previous appointment');
      if (scenario === 'missing') oldSeat.currentAppointmentId = null;
      if (scenario === 'occupant') oldSeat.occupant = { type: 'npc', id: 'wrong-cadre' };
      if (scenario === 'active') {
        state.organization.vacancies.push({
          ...structuredClone(targetVacancy),
          vacancyId: 'vacancy:old-active',
          seatId: oldSeat.seatId,
          sourceId: 'old-active',
        });
      }
      if (scenario === 'target') targetVacancy.status = 'filled';
      const before = structuredClone(state.organization);
      const result = fillVacancyInTransaction(state, {
        vacancyId: targetVacancy.vacancyId,
        occupant: { type: 'player', id: 'player' },
        appointmentId: `appointment:${scenario}`,
        selectionId: null,
        opportunityId: null,
        currentDay: 722,
        idFactory: () => 'unused-id',
        previousAppointmentId,
        releasedSeatReason: 'promotion',
      });
      expect(result.success).toBe(false);
      expect(state.organization).toEqual(before);
    }

    const source = promotionState();
    const previousAppointmentId = source.oldSeat.currentAppointmentId;
    if (!previousAppointmentId) throw new Error('Expected previous appointment');
    const first = fillVacancyInTransaction(source.state, {
      vacancyId: source.targetVacancy.vacancyId,
      occupant: { type: 'player', id: 'player' },
      appointmentId: 'appointment:once',
      selectionId: null,
      opportunityId: null,
      currentDay: 723,
      idFactory: () => 'unused-id',
      previousAppointmentId,
      releasedSeatReason: 'promotion',
    });
    expect(first.success).toBe(true);
    const afterFirst = structuredClone(source.state.organization);
    const repeated = fillVacancyInTransaction(source.state, {
      vacancyId: source.targetVacancy.vacancyId,
      occupant: { type: 'player', id: 'player' },
      appointmentId: 'appointment:twice',
      selectionId: null,
      opportunityId: null,
      currentDay: 724,
      idFactory: () => 'unused-id',
      previousAppointmentId,
      releasedSeatReason: 'promotion',
    });
    expect(repeated).toMatchObject({ success: false });
    expect(source.state.organization).toEqual(afterFirst);
  });
});
