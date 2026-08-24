/**
 * 组织世界确定性初始化与不变量测试。
 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import { createInitialState } from '../../../store/game-store';
import type { OrganizationState, StaffingSelection } from '../../../types/organization';
import { createOrganizationState } from '../organization-initialization';
import { validateOrganizationInvariants } from '../organization-invariants';
import { hasVacantOrganizationSeat } from '../organization-selectors';

function initialize(): OrganizationState {
  const loader = getConfigLoader();
  const state = createInitialState();
  return createOrganizationState({
    initializedAtDay: state.time.totalDaysPlayed,
    playerAppointment: state.career.appointment,
    cadreTemplates: loader.getCadreTemplates(),
    positions: loader.getAllPositions(),
    institutions: loader.getAllInstitutions(),
  });
}

describe('createOrganizationState', () => {
  it('确定性建立玩家周围的有限干部与实际席位', () => {
    const first = initialize();
    const second = initialize();

    expect(second).toEqual(first);
    expect(first.cadres).toHaveLength(9);
    expect(first.cadres.length + 1).toBeGreaterThanOrEqual(10);
    expect(first.cadres.length + 1).toBeLessThanOrEqual(30);
    expect(first.seats).toHaveLength(10);
    expect(first.seats.filter((seat) => seat.occupant?.type === 'player')).toHaveLength(1);
    expect(first.seats.filter((seat) => seat.occupant?.type === 'npc')).toHaveLength(7);
    expect(first.cadres.filter((cadre) => cadre.currentAppointment === null)).toHaveLength(2);
    expect(hasVacantOrganizationSeat(first, 'admin_l2_0')).toBe(true);
    expect(hasVacantOrganizationSeat(first, 'admin_l1_0')).toBe(false);
    expect(validateOrganizationInvariants(first, 'initial-appointment-admin_l1_0')).toEqual([]);
  });

  it('玩家占据配置 NPC 职位时不会制造双 occupant', () => {
    const loader = getConfigLoader();
    const playerAppointment = {
      ...createInitialState().career.appointment,
      appointmentId: 'player-promoted',
      positionId: 'admin_l2_0',
      institutionId: 'township_govt_01',
      regionId: 'region_qingyun_town',
      leadershipRank: 'township_deputy' as const,
    };
    const organization = createOrganizationState({
      initializedAtDay: 720,
      playerAppointment,
      cadreTemplates: loader.getCadreTemplates(),
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
    });

    expect(organization.cadres.find((cadre) => cadre.cadreId === 'cadre_chen_ming')).toMatchObject({
      currentAppointment: null,
      experiences: [],
    });
    expect(organization.seats.filter((seat) => seat.positionId === 'admin_l2_0')).toHaveLength(1);
    expect(validateOrganizationInvariants(organization, 'player-promoted')).toEqual([]);
  });
});

describe('validateOrganizationInvariants', () => {
  it('拒绝同一干部占据两个席位', () => {
    const organization = initialize();
    const cadre = organization.cadres[0];
    const targetSeat = organization.seats.find((seat) => seat.occupant?.type === 'player');
    if (!cadre?.currentAppointment || !targetSeat) throw new Error('Expected initialized facts');
    targetSeat.occupant = { type: 'npc', id: cadre.cadreId };
    targetSeat.currentAppointmentId = cadre.currentAppointment.appointmentId;
    targetSeat.occupiedAtDay = cadre.currentAppointment.startedAtDay;

    expect(validateOrganizationInvariants(organization, null)).toContain(
      `Cadre ${cadre.cadreId} must occupy exactly one seat`,
    );
  });

  it('拒绝 occupied seat 上的活动 Vacancy', () => {
    const organization = initialize();
    const seat = organization.seats[0];
    if (!seat) throw new Error('Expected initialized seat');
    organization.vacancies.push({
      vacancyId: 'vacancy:test',
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
      sourceId: 'retirement:test',
      closesAtDay: null,
      closedAtDay: null,
      selectionId: null,
    });

    expect(
      validateOrganizationInvariants(organization, 'initial-appointment-admin_l1_0'),
    ).toContain('Active vacancy vacancy:test has an occupied seat');
  });

  it('拒绝不存在 Vacancy 的世界级选拔和非候选赢家', () => {
    const organization = initialize();
    const winnerCadre = organization.cadres[0];
    if (!winnerCadre) throw new Error('Expected initialized cadre');
    const selection: StaffingSelection = {
      selectionId: 'selection:test',
      vacancyId: 'vacancy:missing',
      status: 'failed',
      currentStage: 'eligibility_review',
      startedAtDay: 1,
      completedAtDay: 1,
      candidates: [],
      stageAudits: [],
      winner: { type: 'npc', id: winnerCadre.cadreId },
      playerCareerProcessId: null,
      randomDraws: [0.5],
    };
    organization.selections.push(selection);

    const errors = validateOrganizationInvariants(organization, 'initial-appointment-admin_l1_0');
    expect(errors).toContain('Selection selection:test references unknown vacancy');
    expect(errors).toContain('Selection selection:test winner is not a candidate');
  });
});
