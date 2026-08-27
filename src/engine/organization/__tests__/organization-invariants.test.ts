/** 组织 Vacancy/Selection/Seat 交叉引用不变量的正反例测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../store/game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../../../store/save-codec';
import type { StaffingSelection, VacancyInstance } from '../../../types/organization';
import { validateOrganizationInvariants } from '../organization-invariants';

function validFilledVacancy() {
  const state = createInitialState();
  const cadre = state.organization.cadres.find((candidate) => candidate.currentAppointment);
  if (!cadre?.currentAppointment) throw new Error('Expected assigned cadre');
  const seat = state.organization.seats.find(
    (candidate) => candidate.occupant?.type === 'npc' && candidate.occupant.id === cadre.cadreId,
  );
  if (!seat || !seat.currentAppointmentId || !seat.occupant) throw new Error('Expected NPC Seat');
  const vacancy: VacancyInstance = {
    vacancyId: 'vacancy:filled-test',
    seatId: seat.seatId,
    positionId: seat.positionId,
    positionNameSnapshot: seat.positionNameSnapshot,
    institutionId: seat.institutionId,
    institutionNameSnapshot: seat.institutionNameSnapshot,
    regionId: seat.regionId,
    institutionLevel: seat.institutionLevel,
    positionDomain: seat.positionDomain,
    leadershipRank: seat.leadershipRank,
    openedAtDay: 0,
    reason: 'promotion',
    status: 'filled',
    sourceType: 'appointment',
    sourceId: 'appointment:filled-test',
    closesAtDay: null,
    closedAtDay: 1,
    selectionId: null,
    filledBy: structuredClone(seat.occupant),
    filledAppointmentId: seat.currentAppointmentId,
    cancellationReason: null,
  };
  state.organization.vacancies.push(vacancy);
  return { state, seat, vacancy };
}

describe('organization invariants', () => {
  it('接受与 Seat occupant/appointment 完全一致的 filled Vacancy', () => {
    const { state } = validFilledVacancy();
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toEqual(
      [],
    );
  });

  it('拒绝 active closed day 与 filled Seat/occupant 不一致', () => {
    const state = createInitialState();
    const active = state.organization.vacancies[0];
    if (!active) throw new Error('Expected initial Vacancy');
    active.closedAtDay = 1;
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toContain(
      `Active vacancy ${active.vacancyId} has a closed day`,
    );

    const filled = validFilledVacancy();
    filled.seat.occupant = null;
    filled.seat.currentAppointmentId = filled.vacancy.filledAppointmentId;
    filled.seat.occupiedAtDay = filled.vacancy.closedAtDay;
    expect(
      validateOrganizationInvariants(filled.state.organization, filled.state.career.appointment),
    ).toContain(`Filled vacancy ${filled.vacancy.vacancyId} occupant does not match its Seat`);
  });

  it('允许旧 filled Vacancy 与后续旧岗释放/新 Vacancy 共存并可解码', () => {
    const state = createInitialState();
    const seat = state.organization.seats.find((candidate) => candidate.occupant === null);
    const template = seat
      ? state.organization.vacancies.find((vacancy) => vacancy.seatId === seat.seatId)
      : undefined;
    if (!seat || !template) throw new Error('Expected empty Seat and initial Vacancy');
    state.organization.vacancies = state.organization.vacancies.filter(
      (vacancy) => vacancy.seatId !== seat.seatId,
    );
    state.organization.vacancies.push(
      {
        ...structuredClone(template),
        vacancyId: 'vacancy:historical-filled',
        status: 'filled',
        closedAtDay: 10,
        filledBy: { type: 'player', id: 'player' },
        filledAppointmentId: 'appointment:old',
      },
      {
        ...structuredClone(template),
        vacancyId: 'vacancy:released-next',
        status: 'open',
        openedAtDay: 20,
      },
    );
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toEqual(
      [],
    );
    expect(decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state))).success).toBe(true);
  });

  it('selecting Vacancy 必须绑定 pending/active 且 vacancyId 一致的 Selection', () => {
    const state = createInitialState();
    const vacancy = state.organization.vacancies[0];
    if (!vacancy) throw new Error('Expected initial Vacancy');
    vacancy.status = 'selecting';
    vacancy.selectionId = 'selection:invariant-test';
    const selection: StaffingSelection = {
      selectionId: 'selection:invariant-test',
      vacancyId: vacancy.vacancyId,
      status: 'pending',
      currentStage: 'eligibility_review',
      startedAtDay: 1,
      completedAtDay: null,
      candidates: [],
      stageAudits: [],
      winner: null,
      playerCareerProcessId: null,
      randomDraws: [],
    };
    state.organization.selections.push(selection);
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toEqual(
      [],
    );
    selection.status = 'completed';
    expect(validateOrganizationInvariants(state.organization, state.career.appointment)).toContain(
      `Selecting vacancy ${vacancy.vacancyId} references terminal selection`,
    );
  });
});
