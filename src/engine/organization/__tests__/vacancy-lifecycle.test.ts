/** Vacancy 五态转换、Seat 一致性与 NPC 离任 producer 测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../store/game-store';
import type { CadreDepartureFact, OrganizationState } from '../../../types/organization';
import {
  beginVacancySelection,
  cancelVacancy,
  expireVacancy,
  fillVacancy,
  openVacancy,
  returnVacancyToOpen,
} from '../vacancy-lifecycle';
import {
  cadreDepartureVacancyId,
  cadreDepartureVacancyKey,
  produceCadreDepartureVacancies,
} from '../vacancy-producers';

function organization(): OrganizationState {
  const state = createInitialState().organization;
  // 生命周期单测从空 Vacancy 集合开始，初始化空 Seat 的正式 Vacancy 由初始化单测覆盖。
  state.vacancies = [];
  state.processedProducerKeys = [];
  return state;
}

function emptySeat(state: OrganizationState) {
  const seat = state.seats.find((item) => item.occupant === null);
  if (!seat) throw new Error('Expected an empty Seat');
  return seat;
}

function open(state = organization()) {
  const seat = emptySeat(state);
  const result = openVacancy({
    organization: state,
    currentDay: 10,
    idFactory: () => 'vacancy:test',
    seatId: seat.seatId,
    reason: 'retirement',
    sourceType: 'system',
    sourceId: 'test-source',
    closesAtDay: 100,
  });
  if (!result.success || !result.vacancy) throw new Error('Expected open Vacancy');
  return { state, seat, result };
}

function selectionFor(state: OrganizationState, vacancyId: string): void {
  state.selections.push({
    selectionId: 'selection:test',
    vacancyId,
    status: 'pending',
    currentStage: 'eligibility_review',
    startedAtDay: 10,
    completedAtDay: null,
    candidates: [],
    stageAudits: [],
    winner: null,
    playerCareerProcessId: null,
    randomDraws: [],
  });
}

function applySelectingTransition(
  operation: 'return' | 'cancel' | 'expire',
  state: OrganizationState,
) {
  const vacancy = state.vacancies[0];
  if (!vacancy) throw new Error('Expected selecting Vacancy');
  if (operation === 'return')
    return returnVacancyToOpen({
      organization: state,
      currentDay: 20,
      idFactory: () => 'unused',
      vacancyId: vacancy.vacancyId,
      selectionId: vacancy.selectionId ?? 'selection:test',
    });
  if (operation === 'cancel')
    return cancelVacancy({
      organization: state,
      currentDay: 20,
      idFactory: () => 'unused',
      vacancyId: vacancy.vacancyId,
      cancellationReason: 'system',
    });
  return expireVacancy({
    organization: state,
    currentDay: 20,
    idFactory: () => 'unused',
    vacancyId: vacancy.vacancyId,
  });
}

describe('vacancy lifecycle engine', () => {
  it('支持 open/selecting/open 与取消、过期终态', () => {
    const first = open();
    expect(first.result.emittedSignals[0]).toMatchObject({
      signalType: 'vacancy.opened',
      data: {
        vacancyId: 'vacancy:test',
        seatId: first.seat.seatId,
        positionId: first.seat.positionId,
        institutionId: first.seat.institutionId,
        regionId: first.seat.regionId,
        reason: 'retirement',
      },
    });
    selectionFor(first.result.organization, first.result.vacancy!.vacancyId);
    const selecting = beginVacancySelection({
      organization: first.result.organization,
      currentDay: 20,
      idFactory: () => 'unused',
      vacancyId: 'vacancy:test',
      selectionId: 'selection:test',
    });
    expect(selecting.success ? selecting.vacancy?.status : undefined).toBe('selecting');
    if (!selecting.success) return;
    const reopened = returnVacancyToOpen({
      organization: selecting.organization,
      currentDay: 30,
      idFactory: () => 'unused',
      vacancyId: 'vacancy:test',
      selectionId: 'selection:test',
    });
    expect(reopened.success ? reopened.vacancy?.status : undefined).toBe('open');
    if (!reopened.success) return;
    const cancelled = cancelVacancy({
      organization: reopened.organization,
      currentDay: 40,
      idFactory: () => 'unused',
      vacancyId: 'vacancy:test',
      cancellationReason: 'opportunity_withdrawn',
    });
    expect(cancelled.success ? cancelled.vacancy?.cancellationReason : undefined).toBe(
      'opportunity_withdrawn',
    );
    expect(cancelled.success && cancelled.emittedSignals[0]).toMatchObject({
      signalType: 'vacancy.cancelled',
      data: { vacancyId: 'vacancy:test', cancellationReason: 'opportunity_withdrawn' },
    });

    const expiring = open();
    const expired = expireVacancy({
      organization: expiring.result.organization,
      currentDay: 100,
      idFactory: () => 'unused',
      vacancyId: 'vacancy:test',
    });
    expect(expired.success ? expired.vacancy?.status : undefined).toBe('expired');
    expect(expired.success ? expired.vacancy?.cancellationReason : undefined).toBe('expired');
  });

  it('禁止 occupied Seat、双 active Vacancy 与终态重放', () => {
    const state = organization();
    const occupied = state.seats.find((seat) => seat.occupant !== null);
    if (!occupied) throw new Error('Expected occupied Seat');
    expect(
      openVacancy({
        organization: state,
        currentDay: 1,
        idFactory: () => 'unused',
        seatId: occupied.seatId,
        reason: 'promotion',
        sourceType: 'system',
        sourceId: 'occupied',
        closesAtDay: null,
      }),
    ).toMatchObject({ success: false, error: 'seat_occupied' });
    const first = open();
    expect(
      openVacancy({
        organization: first.result.organization,
        currentDay: 11,
        idFactory: () => 'second',
        seatId: first.seat.seatId,
        reason: 'retirement',
        sourceType: 'system',
        sourceId: 'second',
        closesAtDay: null,
      }),
    ).toMatchObject({ success: false, error: 'active_vacancy_exists' });
    const cancelled = cancelVacancy({
      organization: first.result.organization,
      currentDay: 20,
      idFactory: () => 'unused',
      vacancyId: 'vacancy:test',
      cancellationReason: 'system',
    });
    if (!cancelled.success) return;
    expect(
      cancelVacancy({
        organization: cancelled.organization,
        currentDay: 21,
        idFactory: () => 'unused',
        vacancyId: 'vacancy:test',
        cancellationReason: 'system',
      }),
    ).toMatchObject({ success: false, error: 'vacancy_terminal' });
  });

  it('拒绝历史 Vacancy 身份冲突，并且生成身份只调用一次 idFactory', () => {
    const first = open();
    const cancelled = cancelVacancy({
      organization: first.result.organization,
      currentDay: 20,
      idFactory: () => 'unused',
      vacancyId: first.result.vacancy!.vacancyId,
      cancellationReason: 'system',
    });
    if (!cancelled.success) throw new Error('Expected cancelled Vacancy');
    expect(
      openVacancy({
        organization: cancelled.organization,
        currentDay: 21,
        idFactory: () => 'unused',
        seatId: first.seat.seatId,
        reason: 'promotion',
        sourceType: 'system',
        sourceId: 'reused',
        closesAtDay: null,
        vacancyId: first.result.vacancy!.vacancyId,
      }),
    ).toMatchObject({ success: false, error: 'vacancy_identity_conflict' });

    let calls = 0;
    const generatedState = organization();
    const generated = openVacancy({
      organization: generatedState,
      currentDay: 1,
      idFactory: () => {
        calls += 1;
        return 'vacancy:generated-once';
      },
      seatId: emptySeat(generatedState).seatId,
      reason: 'retirement',
      sourceType: 'system',
      sourceId: 'generated',
      closesAtDay: null,
    });
    expect(generated.success).toBe(true);
    expect(calls).toBe(1);
  });

  it('fill 原子写入 Seat 与 Vacancy 快照并发出信号', () => {
    const first = open();
    const filled = fillVacancy({
      organization: first.result.organization,
      currentDay: 20,
      idFactory: () => 'unused',
      vacancyId: 'vacancy:test',
      occupant: { type: 'npc', id: 'cadre_chen_ming' },
      appointmentId: 'appointment:new',
      transitionId: 'transition:test',
    });
    expect(filled.success).toBe(true);
    if (!filled.success) return;
    expect(filled.vacancy).toMatchObject({
      status: 'filled',
      filledBy: { type: 'npc', id: 'cadre_chen_ming' },
      filledAppointmentId: 'appointment:new',
      cancellationReason: null,
      closedAtDay: 20,
    });
    expect(
      filled.organization.seats.find((seat) => seat.seatId === first.seat.seatId),
    ).toMatchObject({
      occupant: { type: 'npc', id: 'cadre_chen_ming' },
      currentAppointmentId: 'appointment:new',
      occupiedAtDay: 20,
      sourceTransitionId: 'transition:test',
    });
    expect(filled.emittedSignals[0]).toMatchObject({
      signalType: 'vacancy.filled',
      data: { vacancyId: 'vacancy:test', seatId: first.seat.seatId, occupantType: 'npc' },
    });
  });

  it('selecting Vacancy 填补必须绑定 pending/active Selection', () => {
    const missing = open();
    missing.result.organization.vacancies[0]!.status = 'selecting';
    expect(
      fillVacancy({
        organization: missing.result.organization,
        currentDay: 20,
        idFactory: () => 'unused',
        vacancyId: 'vacancy:test',
        occupant: { type: 'npc', id: 'cadre_chen_ming' },
        appointmentId: 'appointment:new',
        transitionId: 'transition:test',
      }),
    ).toMatchObject({ success: false, error: 'selection_required' });

    const mismatched = open();
    selectionFor(mismatched.result.organization, 'vacancy:other');
    mismatched.result.organization.vacancies[0]!.status = 'selecting';
    mismatched.result.organization.vacancies[0]!.selectionId = 'selection:test';
    expect(
      fillVacancy({
        organization: mismatched.result.organization,
        currentDay: 20,
        idFactory: () => 'unused',
        vacancyId: 'vacancy:test',
        occupant: { type: 'npc', id: 'cadre_chen_ming' },
        appointmentId: 'appointment:new',
        transitionId: 'transition:test',
      }),
    ).toMatchObject({ success: false, error: 'selection_mismatch' });

    const terminal = open();
    selectionFor(terminal.result.organization, 'vacancy:test');
    terminal.result.organization.selections[0]!.status = 'failed';
    terminal.result.organization.vacancies[0]!.status = 'selecting';
    terminal.result.organization.vacancies[0]!.selectionId = 'selection:test';
    expect(
      fillVacancy({
        organization: terminal.result.organization,
        currentDay: 20,
        idFactory: () => 'unused',
        vacancyId: 'vacancy:test',
        occupant: { type: 'npc', id: 'cadre_chen_ming' },
        appointmentId: 'appointment:new',
        transitionId: 'transition:test',
      }),
    ).toMatchObject({ success: false, error: 'selection_mismatch' });
  });

  const selectingFailures = [
    { label: 'null', selectionId: null, selectionVacancyId: null, status: null },
    { label: 'missing', selectionId: 'selection:missing', selectionVacancyId: null, status: null },
    {
      label: 'wrong vacancy',
      selectionId: 'selection:test',
      selectionVacancyId: 'vacancy:other',
      status: 'pending',
    },
    {
      label: 'completed',
      selectionId: 'selection:test',
      selectionVacancyId: 'vacancy:test',
      status: 'completed',
    },
    {
      label: 'failed',
      selectionId: 'selection:test',
      selectionVacancyId: 'vacancy:test',
      status: 'failed',
    },
    {
      label: 'cancelled',
      selectionId: 'selection:test',
      selectionVacancyId: 'vacancy:test',
      status: 'cancelled',
    },
  ] as const;
  for (const testCase of selectingFailures) {
    it.each(['return', 'cancel', 'expire'] as const)(
      'selecting %s rejects %s Selection and preserves organization',
      (operation) => {
        const source = open();
        const vacancy = source.result.organization.vacancies[0];
        if (!vacancy) throw new Error('Expected Vacancy');
        vacancy.status = 'selecting';
        vacancy.selectionId = testCase.selectionId;
        if (testCase.selectionVacancyId) {
          selectionFor(source.result.organization, testCase.selectionVacancyId);
          source.result.organization.selections[0]!.status = testCase.status;
        }
        if (operation === 'expire') vacancy.closesAtDay = 10;
        const before = structuredClone(source.result.organization);
        const result = applySelectingTransition(operation, source.result.organization);
        expect(result).toMatchObject({
          success: false,
          error:
            testCase.label === 'null' || testCase.label === 'missing'
              ? 'selection_not_found'
              : 'selection_mismatch',
        });
        expect(source.result.organization).toEqual(before);
      },
    );
  }

  it.each(['return', 'cancel', 'expire'] as const)(
    'selecting with active Selection supports %s',
    (operation) => {
      const source = open();
      const vacancy = source.result.organization.vacancies[0];
      if (!vacancy) throw new Error('Expected Vacancy');
      selectionFor(source.result.organization, vacancy.vacancyId);
      source.result.organization.selections[0]!.status = 'active';
      vacancy.status = 'selecting';
      vacancy.selectionId = 'selection:test';
      if (operation === 'expire') vacancy.closesAtDay = 10;
      const result = applySelectingTransition(operation, source.result.organization);
      expect(result.success).toBe(true);
    },
  );

  it('departure producer 按稳定顺序创建、无 Seat no-op、重复幂等且冲突可诊断', () => {
    const state = organization();
    const assigned = state.cadres.find((cadre) => cadre.currentAppointment);
    if (!assigned?.currentAppointment) throw new Error('Expected assigned NPC');
    const seat = state.seats.find(
      (item) => item.occupant?.type === 'npc' && item.occupant.id === assigned.cadreId,
    );
    if (!seat) throw new Error('Expected NPC Seat');
    const departure: CadreDepartureFact = {
      departureId: 'departure:z',
      cadreId: assigned.cadreId,
      appointmentId: assigned.currentAppointment.appointmentId,
      experienceId: assigned.experiences[0]?.id ?? null,
      seatId: seat.seatId,
      positionId: seat.positionId,
      institutionId: seat.institutionId,
      regionId: seat.regionId,
      occurredAtDay: 50,
      reason: 'retirement',
      sourceType: 'cadre_lifecycle',
    };
    const noSeat: CadreDepartureFact = {
      ...departure,
      departureId: 'departure:a',
      appointmentId: null,
      experienceId: null,
      seatId: null,
      positionId: null,
      institutionId: null,
      regionId: null,
    };
    state.departures.push(departure, noSeat);
    seat.occupant = null;
    seat.currentAppointmentId = null;
    seat.occupiedAtDay = null;
    const before = structuredClone(state);
    const produced = produceCadreDepartureVacancies({
      organization: state,
      idFactory: () => 'unused',
    });
    expect(state).toEqual(before);
    expect(produced.success).toBe(true);
    if (!produced.success) return;
    expect(produced.organization.vacancies[0]).toMatchObject({
      vacancyId: cadreDepartureVacancyId(departure.departureId),
      sourceId: departure.departureId,
      reason: 'retirement',
    });
    expect(produced.organization.processedProducerKeys).toContain(
      cadreDepartureVacancyKey(noSeat.departureId),
    );
    expect(produced.emittedSignals[0]).toMatchObject({ signalType: 'vacancy.opened' });
    const repeated = produceCadreDepartureVacancies({
      organization: produced.organization,
      idFactory: () => 'different',
    });
    expect(repeated.success && repeated.organization.vacancies).toHaveLength(1);

    const recoveredState = structuredClone(produced.organization);
    recoveredState.processedProducerKeys = [];
    const recovered = produceCadreDepartureVacancies({
      organization: recoveredState,
      idFactory: () => 'different',
    });
    expect(recovered.success).toBe(true);
    expect(recovered.success && recovered.emittedSignals).toHaveLength(0);
    expect(recovered.success && recovered.organization.processedProducerKeys).toEqual([
      cadreDepartureVacancyKey(noSeat.departureId),
      cadreDepartureVacancyKey(departure.departureId),
    ]);

    const replayAfterReoccupation = structuredClone(produced.organization);
    const replaySeat = replayAfterReoccupation.seats.find((item) => item.seatId === seat.seatId);
    if (!replaySeat) throw new Error('Expected replay Seat');
    replaySeat.occupant = { type: 'npc', id: 'cadre:replacement' };
    replaySeat.currentAppointmentId = 'appointment:replacement';
    replaySeat.occupiedAtDay = 60;
    const replayOccupied = produceCadreDepartureVacancies({
      organization: replayAfterReoccupation,
      idFactory: () => 'different',
    });
    expect(replayOccupied.success).toBe(true);

    const conflictState = structuredClone(produced.organization);
    const vacancy = conflictState.vacancies[0];
    if (!vacancy) throw new Error('Expected produced Vacancy');
    vacancy.reason = 'promotion';
    const conflict = produceCadreDepartureVacancies({
      organization: conflictState,
      idFactory: () => 'unused',
    });
    expect(conflict).toMatchObject({ success: false, error: 'producer_conflict' });
  });
});
