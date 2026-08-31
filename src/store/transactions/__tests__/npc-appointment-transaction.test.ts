/** NPC 选拔胜者任职事务的原子性、幂等与组织一致性测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../game-store';
import type { PlayerSave } from '../../../types/player';
import type { StaffingSelection } from '../../../types/organization';
import { validateOrganizationInvariants } from '../../../engine/organization/organization-invariants';
import { appointNpcSelectionWinnerInTransaction } from '../npc-appointment-transaction';

function npcSelection(state: PlayerSave, cadreId: string, vacancyId: string): StaffingSelection {
  const cadre = state.organization.cadres.find((item) => item.cadreId === cadreId);
  if (!cadre) throw new Error('Expected cadre');
  const appointment = cadre.currentAppointment;
  const latestExperience = cadre.experiences.at(-1);
  return {
    selectionId: `selection:${cadreId}:${vacancyId}`,
    vacancyId,
    status: 'completed',
    currentStage: 'appointment',
    startedAtDay: 100,
    completedAtDay: 120,
    candidates: [
      {
        candidateId: cadreId,
        candidateType: 'npc',
        currentPositionId: appointment?.positionId ?? latestExperience?.positionId ?? null,
        institutionId: appointment?.institutionId ?? latestExperience?.institutionId ?? null,
        regionId: appointment?.regionId ?? latestExperience?.regionId ?? null,
        leadershipRank: appointment?.leadershipRank ?? latestExperience?.leadershipRank ?? 'none',
        civilServiceRank: cadre.civilServiceRank,
        appointmentStartedAtDay:
          appointment?.startedAtDay ?? latestExperience?.startedAtDay ?? null,
        serviceStartedAtDay: cadre.civilServiceRankStartedAtDay,
        experiences: structuredClone(cadre.experiences),
        assessments: structuredClone(cadre.assessments),
        specialties: structuredClone(cadre.specialties),
        restrictionTypes: [],
        scoringInputs: {},
      },
    ],
    stageAudits: [],
    winner: { type: 'npc', id: cadreId },
    playerCareerProcessId: null,
    randomDraws: [],
    rulesVersion: 'test',
    stageResults: [],
    winnerId: cadreId,
    failure: null,
  };
}

function assignedState() {
  const state = createInitialState();
  const cadre = state.organization.cadres.find((item) => item.currentAppointment);
  const vacancy = state.organization.vacancies.find((item) => item.status === 'open');
  if (!cadre || !vacancy) throw new Error('Expected assigned NPC and open Vacancy');
  const selection = npcSelection(state, cadre.cadreId, vacancy.vacancyId);
  state.organization.selections.push(selection);
  vacancy.status = 'selecting';
  vacancy.selectionId = selection.selectionId;
  return { state, cadre, vacancy, selection };
}

function lateralState() {
  const state = createInitialState();
  const pair = state.organization.cadres
    .filter((item) => item.status === 'active' && item.currentAppointment !== null)
    .flatMap((cadre) =>
      state.organization.vacancies
        .filter(
          (vacancy) =>
            vacancy.status === 'open' &&
            vacancy.leadershipRank === cadre.currentAppointment?.leadershipRank &&
            (vacancy.institutionId !== cadre.currentAppointment.institutionId ||
              vacancy.regionId !== cadre.currentAppointment.regionId),
        )
        .map((vacancy) => ({ cadre, vacancy })),
    )[0];
  if (!pair) throw new Error('Expected a real cross-institution or cross-region lateral pair');
  const selection = npcSelection(state, pair.cadre.cadreId, pair.vacancy.vacancyId);
  state.organization.selections.push(selection);
  pair.vacancy.status = 'selecting';
  pair.vacancy.selectionId = selection.selectionId;
  return { state, cadre: pair.cadre, vacancy: pair.vacancy, selection };
}

function unassignedState() {
  const state = createInitialState();
  const cadre = state.organization.cadres.find((item) => !item.currentAppointment);
  const vacancy = state.organization.vacancies.find((item) => item.status === 'open');
  if (!cadre || !vacancy) throw new Error('Expected unassigned NPC and open Vacancy');
  const selection = npcSelection(state, cadre.cadreId, vacancy.vacancyId);
  state.organization.selections.push(selection);
  vacancy.status = 'selecting';
  vacancy.selectionId = selection.selectionId;
  return { state, cadre, vacancy, selection };
}

describe('NPC appointment transaction', () => {
  it('closes old experience, releases one old Seat and fills the selected Vacancy', () => {
    const { state, cadre, vacancy } = assignedState();
    const oldAppointment = cadre.currentAppointment;
    const oldExperience = cadre.experiences.find((item) => item.endedAtDay === null);
    const oldSeat = state.organization.seats.find(
      (seat) => seat.currentAppointmentId === oldAppointment?.appointmentId,
    );
    if (!oldAppointment || !oldExperience || !oldSeat) throw new Error('Expected old appointment');
    const result = appointNpcSelectionWinnerInTransaction(state, {
      selectionId: `selection:${cadre.cadreId}:${vacancy.vacancyId}`,
      vacancyId: vacancy.vacancyId,
      cadreId: cadre.cadreId,
      currentDay: 200,
      idFactory: (() => {
        let index = 0;
        return () => `npc-new-${index++}`;
      })(),
    });
    expect(result).toMatchObject({ success: true, vacancy: { status: 'filled' } });
    expect(result.success && result.emittedSignals.map((signal) => signal.signalType)).toEqual([
      'vacancy.filled',
      'vacancy.opened',
    ]);
    const updatedCadre = state.organization.cadres.find((item) => item.cadreId === cadre.cadreId);
    const updatedOldExperience = updatedCadre?.experiences.find(
      (item) => item.id === oldExperience.id,
    );
    expect(updatedOldExperience).toMatchObject({ endedAtDay: 200, endReason: 'promotion' });
    expect(updatedCadre?.currentAppointment).toMatchObject({
      appointmentId: 'npc-new-0',
      positionId: vacancy.positionId,
      institutionId: vacancy.institutionId,
      regionId: vacancy.regionId,
      appointmentReason: 'promotion',
      appointmentType: 'substantive',
      sourceOpportunityId: null,
    });
    expect(state.organization.seats.find((seat) => seat.seatId === oldSeat.seatId)).toMatchObject({
      occupant: null,
      currentAppointmentId: null,
    });
    expect(state.organization.seats.find((seat) => seat.seatId === vacancy.seatId)).toMatchObject({
      occupant: { type: 'npc', id: cadre.cadreId },
      currentAppointmentId: 'npc-new-0',
    });
    expect(
      state.organization.vacancies.filter((item) => item.sourceId === oldAppointment.appointmentId),
    ).toHaveLength(1);
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toEqual(
      [],
    );
  });

  it('preserves civil-service rank and rank start day', () => {
    const { state, cadre, vacancy } = assignedState();
    const rank = cadre.civilServiceRank;
    const rankStarted = cadre.civilServiceRankStartedAtDay;
    appointNpcSelectionWinnerInTransaction(state, {
      selectionId: `selection:${cadre.cadreId}:${vacancy.vacancyId}`,
      vacancyId: vacancy.vacancyId,
      cadreId: cadre.cadreId,
      currentDay: 250,
      idFactory: (() => {
        let index = 0;
        return () => `rank-${index++}`;
      })(),
    });
    const updatedCadre = state.organization.cadres.find((item) => item.cadreId === cadre.cadreId);
    expect(updatedCadre?.civilServiceRank).toBe(rank);
    expect(updatedCadre?.civilServiceRankStartedAtDay).toBe(rankStarted);
  });

  it('uses lateral_transfer for same leadership rank and snapshots target institution/region', () => {
    const { state, cadre, vacancy, selection } = lateralState();
    const oldAppointment = cadre.currentAppointment;
    const oldExperience = cadre.experiences.find((item) => item.endedAtDay === null);
    const originalCivilServiceRank = cadre.civilServiceRank;
    const originalRankStartedAtDay = cadre.civilServiceRankStartedAtDay;
    if (!oldAppointment || !oldExperience) throw new Error('Expected appointment and experience');
    const result = appointNpcSelectionWinnerInTransaction(state, {
      selectionId: selection.selectionId,
      vacancyId: vacancy.vacancyId,
      cadreId: cadre.cadreId,
      currentDay: 300,
      idFactory: (() => {
        let index = 0;
        return () => `lateral-${index++}`;
      })(),
    });
    expect(result.success).toBe(true);
    const updatedCadre = state.organization.cadres.find((item) => item.cadreId === cadre.cadreId);
    const updatedAppointment = updatedCadre?.currentAppointment;
    const updatedExperience = updatedCadre?.experiences.find((item) => item.endedAtDay === null);
    const closedExperience = updatedCadre?.experiences.find((item) => item.id === oldExperience.id);
    expect(updatedAppointment).toMatchObject({
      appointmentReason: 'lateral_transfer',
      leadershipRank: oldAppointment.leadershipRank,
      institutionId: vacancy.institutionId,
      regionId: vacancy.regionId,
    });
    expect(updatedExperience).toMatchObject({
      id: expect.any(String),
      positionId: vacancy.positionId,
      positionNameSnapshot: vacancy.positionNameSnapshot,
      institutionId: vacancy.institutionId,
      institutionNameSnapshot: vacancy.institutionNameSnapshot,
      institutionLevel: vacancy.institutionLevel,
      regionId: vacancy.regionId,
      positionDomain: vacancy.positionDomain,
      leadershipRank: vacancy.leadershipRank,
      appointmentReason: 'lateral_transfer',
      appointmentType: 'substantive',
      sourceOpportunityId: null,
    });
    expect(updatedAppointment?.leadershipRank).toBe(oldAppointment.leadershipRank);
    expect(
      updatedAppointment?.institutionId !== oldAppointment.institutionId ||
        updatedAppointment?.regionId !== oldAppointment.regionId,
    ).toBe(true);
    expect(closedExperience).toMatchObject({
      endedAtDay: 300,
      endReason: 'lateral_transfer',
    });
    expect(updatedCadre?.civilServiceRank).toBe(originalCivilServiceRank);
    expect(updatedCadre?.civilServiceRankStartedAtDay).toBe(originalRankStartedAtDay);
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toEqual(
      [],
    );
  });

  it('replays as a no-op without calling the ID factory or emitting signals', () => {
    const { state, cadre, vacancy, selection } = assignedState();
    const ids = ['once-appointment', 'once-experience'];
    let calls = 0;
    const first = appointNpcSelectionWinnerInTransaction(state, {
      selectionId: selection.selectionId,
      vacancyId: vacancy.vacancyId,
      cadreId: cadre.cadreId,
      currentDay: 350,
      idFactory: () => ids[calls++] ?? 'unexpected',
    });
    expect(first.success).toBe(true);
    const snapshot = structuredClone(state);
    const replay = appointNpcSelectionWinnerInTransaction(state, {
      selectionId: selection.selectionId,
      vacancyId: vacancy.vacancyId,
      cadreId: cadre.cadreId,
      currentDay: 999,
      idFactory: () => {
        throw new Error('idFactory must not be called on replay');
      },
    });
    expect(replay).toMatchObject({ success: true, emittedSignals: [] });
    expect(state).toEqual(snapshot);
  });

  it('rolls back when target Seat is occupied or target Vacancy was filled by another actor', () => {
    for (const mode of ['seat', 'vacancy'] as const) {
      const { state, cadre, vacancy, selection } = assignedState();
      if (mode === 'seat') {
        const targetSeat = state.organization.seats.find((seat) => seat.seatId === vacancy.seatId);
        if (!targetSeat) throw new Error('Expected target Seat');
        targetSeat.occupant = { type: 'npc', id: 'other' };
        targetSeat.currentAppointmentId = 'other-appointment';
        targetSeat.occupiedAtDay = 1;
      } else {
        vacancy.status = 'filled';
        vacancy.filledBy = { type: 'npc', id: 'other' };
        vacancy.filledAppointmentId = 'other-appointment';
        vacancy.closedAtDay = 1;
      }
      const before = structuredClone(state);
      const result = appointNpcSelectionWinnerInTransaction(state, {
        selectionId: selection.selectionId,
        vacancyId: vacancy.vacancyId,
        cadreId: cadre.cadreId,
        currentDay: 400,
        idFactory: () => 'unused',
      });
      expect(result.success).toBe(false);
      expect(state).toEqual(before);
    }
  });

  it('fills an unassigned NPC without creating an old Vacancy', () => {
    const { state, cadre, vacancy, selection } = unassignedState();
    const result = appointNpcSelectionWinnerInTransaction(state, {
      selectionId: selection.selectionId,
      vacancyId: vacancy.vacancyId,
      cadreId: cadre.cadreId,
      currentDay: 450,
      idFactory: (() => {
        let index = 0;
        return () => `unassigned-${index++}`;
      })(),
    });
    expect(result.success).toBe(true);
    expect(state.organization.vacancies).toHaveLength(
      createInitialState().organization.vacancies.length,
    );
    const updatedCadre = state.organization.cadres.find((item) => item.cadreId === cadre.cadreId);
    expect(updatedCadre?.currentAppointment).toMatchObject({
      appointmentReason: 'initial_assignment',
      sourceOpportunityId: null,
    });
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toEqual(
      [],
    );
  });
});
