/** Relative Selection Store 事务的冻结、绑定和随机输入审计测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../../game-store';
import type { AppointmentCareerOpportunity } from '../../../domain/career/state';
import type { PlayerSave } from '../../../types/player';
import { createRelativeSelectionInTransaction } from '../selection-transaction';
import { decodeCurrentSave, wrapSaveEnvelope } from '../../save-codec';
import { validateOrganizationInvariants } from '../../../engine/organization/organization-invariants';

function makePlayerWinner(state: PlayerSave): void {
  const selection = state.organization.selections[0];
  if (!selection) throw new Error('Expected Selection');
  for (const candidate of selection.candidates) {
    const player = candidate.candidateId === 'player';
    candidate.scoringInputs.assessment = player ? 100 : 0;
    candidate.scoringInputs.specialty = player ? 100 : 0;
    candidate.scoringInputs.service = player ? 100 : 0;
    candidate.scoringInputs.network = player ? 100 : 0;
    candidate.scoringInputs.integrity = player ? 100 : 0;
  }
}

function makeAllCandidatesIneligible(state: PlayerSave, day: number): void {
  const restriction = {
    id: 'selection-test-disciplinary',
    type: 'disciplinary_action' as const,
    startedAtDay: day,
    endsAtDay: null,
    reason: 'test',
    sourceType: 'system' as const,
    sourceId: null,
  };
  state.career.restrictions = [structuredClone(restriction)];
  for (const cadre of state.organization.cadres)
    cadre.restrictions = [structuredClone(restriction)];
}

function makeSelectionCandidatesEligible(state: PlayerSave): void {
  state.career.specialties = { local_governance: 80 };
  state.career.experiences = state.career.experiences.map((experience) => ({
    ...experience,
    assessmentResults: [{ year: 2025, score: 80, tier: 'qualified' }],
  }));
  for (const cadre of state.organization.cadres) {
    cadre.experiences = cadre.experiences.map((experience) => ({
      ...experience,
      assessmentResults: [{ year: 2025, score: 80, tier: 'qualified' }],
    }));
    cadre.assessments = [{ year: 2025, score: 80, tier: 'qualified' }];
  }
  const unassigned = state.organization.cadres.find((cadre) => cadre.currentAppointment === null);
  const template = state.career.experiences[0];
  if (!unassigned || !template)
    throw new Error('Expected an unassigned cadre and player experience');
  unassigned.experiences = [
    {
      ...structuredClone(template),
      id: `selection-experience:${unassigned.cadreId}`,
      appointmentId: `selection-appointment:${unassigned.cadreId}`,
      positionId: 'admin_l1_0',
      institutionId: 'township_govt_01',
      regionId: 'region_qingyun_town',
      institutionLevel: 'township',
      positionDomain: 'local_governance',
      leadershipRank: 'none',
      startedAtDay: 0,
      endedAtDay: 180,
      assessmentResults: [{ year: 2025, score: 80, tier: 'qualified' }],
    },
  ];
  unassigned.assessments = [{ year: 2025, score: 80, tier: 'qualified' }];
  unassigned.specialties = { local_governance: 80 };
}

function annualAssessment(score: number): { year: number; score: number; tier: 'qualified' } {
  return { year: 2012, score, tier: 'qualified' };
}

function prepareFormalSelectionFacts(
  state: PlayerSave,
  cadreIds: readonly string[],
  cadreScore: number,
): void {
  state.time.totalDaysPlayed = 180;
  state.career.specialties = { local_governance: 60 };
  const playerExperience = state.career.experiences[0];
  if (!playerExperience) throw new Error('Expected initial player experience');
  playerExperience.assessmentResults = [annualAssessment(60)];
  for (const cadreId of cadreIds) {
    const cadre = state.organization.cadres.find((item) => item.cadreId === cadreId);
    if (!cadre) throw new Error(`Expected cadre ${cadreId}`);
    cadre.assessments = [annualAssessment(cadreScore)];
  }
}

function formalCadreFacts(state: PlayerSave): Map<string, unknown> {
  return new Map(
    state.organization.cadres.map((cadre) => [
      cadre.cadreId,
      {
        positionId: cadre.currentAppointment?.positionId ?? null,
        specialties: structuredClone(cadre.specialties),
      },
    ]),
  );
}

function opportunityFor(
  state: PlayerSave,
  vacancyId?: string,
  opportunityId = 'selection-transaction-opportunity',
): AppointmentCareerOpportunity {
  const vacancy = state.organization.vacancies.find(
    (item) => item.status === 'open' && (vacancyId === undefined || item.vacancyId === vacancyId),
  );
  if (!vacancy) throw new Error('Expected an open Vacancy');
  return {
    id: opportunityId,
    definitionId: 'test-selection',
    type: 'leadership_vacancy',
    status: 'accepted',
    source: {
      sourceType: 'system',
      sourceId: 'test-selection',
      signalId: 'test-selection',
      description: 'test',
    },
    sourceSignal: null,
    vacancyId: vacancy.vacancyId,
    target: {
      positionId: vacancy.positionId,
      positionName: vacancy.positionNameSnapshot,
      institutionId: vacancy.institutionId,
      institutionName: vacancy.institutionNameSnapshot,
      regionId: vacancy.regionId,
      institutionLevel: vacancy.institutionLevel,
      positionDomain: vacancy.positionDomain,
      leadershipRank: vacancy.leadershipRank,
    },
    appointmentType: 'substantive',
    appointmentReason: 'promotion',
    appearedAtDay: 0,
    expiresAtDay: null,
    acceptedAtDay: 0,
    rejectedAtDay: null,
    resolvedAtDay: null,
    cancelledAtDay: null,
    requiresSelection: true,
    eligibilityConditions: [],
    finalOutcome: null,
    reason: 'test',
  };
}

describe('relative Selection transaction', () => {
  it('一次性绑定 Vacancy、Selection、CareerProcess 且只在创建时抽取 RNG', () => {
    const state = createInitialState();
    makeSelectionCandidatesEligible(state);
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    let randomCalls = 0;
    let idCalls = 0;
    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:test',
      180,
      () => `selection:${++idCalls}`,
      () => {
        randomCalls += 1;
        return 0.5;
      },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.state.career.opportunities[0]?.status).toBe('in_process');
    expect(result.state.career.activeProcess).toMatchObject({
      id: 'process:test',
      selectionId: result.selection.selectionId,
      vacancyId: opportunity.vacancyId,
    });
    expect(result.state.organization.vacancies).toContainEqual(
      expect.objectContaining({
        vacancyId: opportunity.vacancyId,
        status: 'selecting',
        selectionId: result.selection.selectionId,
      }),
    );
    expect(result.selection.candidates.map((candidate) => candidate.candidateId)).toEqual(
      [...result.selection.candidates.map((candidate) => candidate.candidateId)].sort(),
    );
    expect(randomCalls).toBe(result.selection.candidates.length * 6);
    const store = createTestStore(result.state);
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => {
        throw new Error('advance must not call RNG');
      },
    });
    expect(randomCalls).toBe(result.selection.candidates.length * 6);
  });

  it('正式副镇长 Vacancy 在 day 180 生成玩家与罗霞候选且不改写 NPC 原始事实', () => {
    const state = createInitialState();
    const originalCadreFacts = formalCadreFacts(state);
    prepareFormalSelectionFacts(state, ['cadre_luo_xia'], 100);
    const vacancy = state.organization.vacancies.find((item) => item.positionId === 'admin_l2_0');
    if (!vacancy) throw new Error('Expected initial admin_l2_0 Vacancy');
    const opportunity = opportunityFor(state, vacancy.vacancyId, 'formal-l2-opportunity');
    state.career.opportunities = [opportunity];

    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:formal-l2',
      180,
      () => 'selection:formal-l2',
      () => 0.5,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.selection.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'cadre_luo_xia',
      'player',
    ]);
    expect(formalCadreFacts(result.state)).toEqual(originalCadreFacts);
  });

  it('正式镇长 Vacancy 只依赖真实副职干部而不依赖 initiallyUnassigned 干部', () => {
    const state = createInitialState();
    prepareFormalSelectionFacts(state, ['cadre_zhou_lan', 'cadre_sun_qiang'], 100);
    const vacancy = state.organization.vacancies.find((item) => item.positionId === 'admin_l3_0');
    if (!vacancy) throw new Error('Expected initial admin_l3_0 Vacancy');
    const opportunity = opportunityFor(state, vacancy.vacancyId, 'formal-l3-opportunity');
    state.career.opportunities = [opportunity];

    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:formal-l3',
      180,
      () => 'selection:formal-l3',
      () => 0.5,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const candidateIds = result.selection.candidates.map((candidate) => candidate.candidateId);
    expect(candidateIds).toEqual(expect.arrayContaining(['cadre_zhou_lan', 'cadre_sun_qiang']));
    expect(candidateIds).not.toEqual(expect.arrayContaining(['cadre_chen_ming', 'cadre_wang_jun']));
  });

  it('正式副镇长 Selection 使用冻结 randomDraws 完成六阶段并由罗霞获选', () => {
    const state = createInitialState();
    prepareFormalSelectionFacts(state, ['cadre_luo_xia'], 100);
    const vacancy = state.organization.vacancies.find((item) => item.positionId === 'admin_l2_0');
    if (!vacancy) throw new Error('Expected initial admin_l2_0 Vacancy');
    const opportunity = opportunityFor(state, vacancy.vacancyId, 'formal-l2-winner-opportunity');
    state.career.opportunities = [opportunity];
    let creationRandomCalls = 0;
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:formal-l2-winner',
      180,
      () => 'selection:formal-l2-winner',
      () => {
        creationRandomCalls += 1;
        return 0.5;
      },
    );

    expect(created.success).toBe(true);
    if (!created.success) return;
    const sourceCadre = created.state.organization.cadres.find(
      (item) => item.cadreId === 'cadre_luo_xia',
    );
    const oldAppointment = sourceCadre?.currentAppointment;
    const oldExperience = sourceCadre?.experiences.find((item) => item.endedAtDay === null);
    const oldSeat = created.state.organization.seats.find(
      (item) => item.currentAppointmentId === oldAppointment?.appointmentId,
    );
    if (!sourceCadre || !oldAppointment || !oldExperience || !oldSeat)
      throw new Error('Expected NPC appointment, experience and Seat');
    expect(creationRandomCalls).toBe(created.selection.candidates.length * 6);
    const store = createTestStore(created.state);
    for (let stage = 0; stage < 6; stage += 1)
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => {
          throw new Error('Selection advancement must use frozen randomDraws');
        },
      });

    const persisted = store.getRawState().organization.selections[0];
    if (!persisted) throw new Error('Expected persisted formal Selection');
    expect(persisted.stageResults).toHaveLength(6);
    expect(persisted.winner).toEqual({ type: 'npc', id: 'cadre_luo_xia' });
    expect(persisted.winnerId).toBe('cadre_luo_xia');
    const settled = store.getRawState();
    const targetVacancy = settled.organization.vacancies.find(
      (item) => item.vacancyId === vacancy.vacancyId,
    );
    const winnerCadre = settled.organization.cadres.find(
      (item) => item.cadreId === 'cadre_luo_xia',
    );
    const releasedVacancy = settled.organization.vacancies.find(
      (item) => item.sourceId === oldAppointment.appointmentId,
    );
    const settledSelection = settled.organization.selections.find(
      (item) => item.selectionId === persisted.selectionId,
    );
    if (!targetVacancy || !winnerCadre || !winnerCadre.currentAppointment || !releasedVacancy)
      throw new Error('Expected settled NPC appointment and released Vacancy');
    if (!settledSelection) throw new Error('Expected settled Selection');
    const winnerExperiences = structuredClone(winnerCadre.experiences);
    const winnerAppointment = structuredClone(winnerCadre.currentAppointment);
    const releasedVacancySnapshot = structuredClone(releasedVacancy);
    const targetVacancySnapshot = structuredClone(targetVacancy);
    const selectionSnapshot = structuredClone(settledSelection);
    expect(targetVacancy).toMatchObject({
      status: 'filled',
      filledBy: { type: 'npc', id: 'cadre_luo_xia' },
      filledAppointmentId: winnerCadre.currentAppointment.appointmentId,
    });
    expect(winnerCadre?.currentAppointment).toMatchObject({
      positionId: vacancy.positionId,
      institutionId: vacancy.institutionId,
      status: 'active',
    });
    expect(winnerCadre?.experiences.filter((item) => item.endedAtDay === null)).toHaveLength(1);
    expect(winnerCadre?.experiences.find((item) => item.id === oldExperience?.id)).toMatchObject({
      endedAtDay: 180,
      endReason: 'promotion',
    });
    expect(
      settled.organization.vacancies.filter(
        (item) => item.sourceId === oldAppointment?.appointmentId,
      ),
    ).toHaveLength(1);
    expect(
      settled.organization.seats.find((item) => item.seatId === oldSeat?.seatId),
    ).toMatchObject({ occupant: null, currentAppointmentId: null });
    expect(settled.career.activeProcess).toBeNull();
    expect(settled.career.completedProcesses.at(-1)).toMatchObject({
      status: 'completed',
      winnerId: 'cadre_luo_xia',
      currentStage: 'appointment',
    });
    expect(settled.career.opportunities[0]).toMatchObject({
      status: 'resolved',
      finalOutcome: 'not_selected',
    });
    expect(
      validateOrganizationInvariants(settled.organization, settled.career.appointment),
    ).toEqual([]);
    const restored = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(settled)));
    expect(restored.success).toBe(true);
    if (!restored.success || !restored.state) return;
    const decoded = restored.state;
    expect(
      decoded.organization.vacancies.find((item) => item.vacancyId === releasedVacancy.vacancyId),
    ).toEqual(releasedVacancySnapshot);
    expect(
      decoded.organization.vacancies.find((item) => item.vacancyId === vacancy.vacancyId),
    ).toEqual(targetVacancySnapshot);
    expect(
      decoded.organization.cadres.find((item) => item.cadreId === 'cadre_luo_xia')
        ?.currentAppointment,
    ).toEqual(winnerAppointment);
    expect(
      decoded.organization.cadres.find((item) => item.cadreId === 'cadre_luo_xia')?.experiences,
    ).toEqual(winnerExperiences);
    const decodedSelection = decoded.organization.selections.find(
      (item) => item.selectionId === selectionSnapshot.selectionId,
    );
    expect(decodedSelection).toEqual(selectionSnapshot);
    expect(decodedSelection).toMatchObject({
      status: 'completed',
      currentStage: 'appointment',
      winner: { type: 'npc', id: 'cadre_luo_xia' },
      winnerId: 'cadre_luo_xia',
    });
    expect(
      validateOrganizationInvariants(decoded.organization, decoded.career.appointment),
    ).toEqual([]);
    const settledSnapshot = structuredClone(settled);
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _idFactory: () => {
        throw new Error('Completed NPC process must be idempotent');
      },
      _rng: () => 0.5,
    });
    expect(store.getRawState()).toEqual(settledSnapshot);
  });

  it('绑定 Vacancy 不合法时保持完整存档不变', () => {
    const state = createInitialState();
    makeSelectionCandidatesEligible(state);
    const opportunity = opportunityFor(state);
    opportunity.vacancyId = 'missing-vacancy';
    state.career.opportunities = [opportunity];
    const before = structuredClone(state);
    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:test',
      180,
      () => 'selection:test',
      () => 0.5,
    );
    expect(result.success).toBe(false);
    expect(state).toEqual(before);
  });

  it('无合格候选在接受事务内终止 Selection 但保留 open Vacancy', () => {
    const state = createInitialState();
    makeSelectionCandidatesEligible(state);
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    makeAllCandidatesIneligible(state, 0);
    let randomCalls = 0;
    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:no-qualified',
      180,
      () => 'selection:no-qualified',
      () => {
        randomCalls += 1;
        return 0.5;
      },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.selection).toMatchObject({
      status: 'failed',
      candidates: [],
      failure: { code: 'no_qualified_candidates', stage: null },
    });
    expect(result.state.career.activeProcess).toBeNull();
    expect(result.state.career.completedProcesses.at(-1)).toMatchObject({
      status: 'failed',
      failure: { code: 'no_qualified_candidates', stage: null },
    });
    expect(result.state.organization.vacancies[0]).toMatchObject({
      status: 'open',
      selectionId: null,
      closedAtDay: null,
    });
    expect(randomCalls).toBe(0);
  });

  it('冻结完整玩家/NPC履历，并按 Vacancy context 排除不同目标的 NPC', () => {
    const state = createInitialState();
    makeSelectionCandidatesEligible(state);
    const excluded = state.organization.cadres.find((cadre) => cadre.currentAppointment === null);
    if (!excluded) throw new Error('Expected an unassigned cadre');
    const sourceExperience = excluded.experiences[0];
    if (!sourceExperience) throw new Error('Expected cadre experience');
    sourceExperience.institutionId = 'subdistrict_01';
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:context',
      180,
      () => 'selection:context',
      () => 0.5,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const player = result.selection.candidates.find(
      (candidate) => candidate.candidateId === 'player',
    );
    expect(player?.experiences).toEqual(state.career.experiences);
    expect(player?.experiences).not.toBe(state.career.experiences);
    expect(
      result.selection.candidates.some((candidate) => candidate.candidateId === excluded.cadreId),
    ).toBe(false);
  });

  it('玩家首阶段淘汰后以有界循环完成剩余六阶段并由 NPC 真实任职', () => {
    const state = createInitialState();
    makeSelectionCandidatesEligible(state);
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:eliminated',
      180,
      () => 'selection:eliminated',
      () => 0.5,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const selection = created.state.organization.selections[0];
    if (!selection) throw new Error('Expected Selection');
    selection.candidates.forEach((candidate, index) => {
      candidate.scoringInputs.assessment = candidate.candidateId === 'player' ? 0 : 100 - index;
      candidate.scoringInputs.service = candidate.candidateId === 'player' ? 0 : 100 - index;
      candidate.scoringInputs.specialty = 100 - index;
      candidate.scoringInputs.integrity = 100 - index;
    });
    const store = createTestStore(created.state);
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => 0.5,
    });
    const result = store.getRawState();
    const persisted = result.organization.selections[0];
    if (!persisted) throw new Error('Expected persisted Selection');
    const stageResults = persisted.stageResults ?? [];
    expect(stageResults.map((stage) => stage.stage)).toEqual([
      'eligibility_review',
      'democratic_recommendation',
      'organization_inspection',
      'collective_decision',
      'public_notice',
      'appointment',
    ]);
    expect(new Set(stageResults.map((stage) => stage.stage)).size).toBe(6);
    expect(persisted?.winner?.type).toBe('npc');
    expect(result.career.activeProcess).toBeNull();
    const process = result.career.completedProcesses.at(-1);
    expect(process).toMatchObject({
      status: 'completed',
      winnerId: persisted?.winnerId,
      currentStage: 'appointment',
    });
    const targetVacancy = result.organization.vacancies.find(
      (vacancy) => vacancy.vacancyId === opportunity.vacancyId,
    );
    expect(targetVacancy).toMatchObject({
      status: 'filled',
      selectionId: persisted?.selectionId,
      filledBy: persisted?.winner,
    });
    const winnerCadre = result.organization.cadres.find(
      (cadre) => cadre.cadreId === persisted?.winnerId,
    );
    expect(winnerCadre?.currentAppointment).toMatchObject({
      positionId: opportunity.target.positionId,
      institutionId: opportunity.target.institutionId,
      regionId: opportunity.target.regionId,
      status: 'active',
    });
    expect(
      winnerCadre?.experiences.filter((experience) => experience.endedAtDay === null),
    ).toHaveLength(1);
    expect(
      result.career.opportunities.find((candidate) => candidate.id === opportunity.id),
    ).toMatchObject({ status: 'resolved', finalOutcome: 'not_selected' });
    const targetSeat = result.organization.seats.find(
      (seat) => seat.seatId === targetVacancy?.seatId,
    );
    expect(targetSeat).toMatchObject({
      occupant: persisted?.winner,
      currentAppointmentId: winnerCadre?.currentAppointment?.appointmentId,
    });
    expect(validateOrganizationInvariants(result.organization, result.career.appointment)).toEqual(
      [],
    );
  });

  it('pending/active Selection 的 NPC 冲突排除行为一致，终态 Selection 不排除', () => {
    const fixtureState = createInitialState();
    makeSelectionCandidatesEligible(fixtureState);
    const fixtureOpportunity = opportunityFor(fixtureState);
    fixtureState.career.opportunities = [fixtureOpportunity];
    const fixture = createRelativeSelectionInTransaction(
      fixtureState,
      fixtureOpportunity,
      'process:conflict-fixture',
      180,
      () => 'selection:conflict-fixture',
      () => 0.5,
    );
    expect(fixture.success).toBe(true);
    if (!fixture.success) return;
    const npc = fixture.selection.candidates.find((candidate) => candidate.candidateType === 'npc');
    if (!npc) throw new Error('Expected a legal NPC candidate in fixture Selection');
    const sourceVacancy = fixtureState.organization.vacancies.find(
      (vacancy) => vacancy.vacancyId === fixtureOpportunity.vacancyId,
    );
    const targetVacancy = fixtureState.organization.vacancies.find(
      (vacancy) => vacancy.status === 'open',
    );
    if (!sourceVacancy || !targetVacancy)
      throw new Error('Expected source selecting and target open Vacancies');
    Object.assign(targetVacancy, {
      positionId: sourceVacancy.positionId,
      positionNameSnapshot: sourceVacancy.positionNameSnapshot,
      institutionId: sourceVacancy.institutionId,
      institutionNameSnapshot: sourceVacancy.institutionNameSnapshot,
      regionId: sourceVacancy.regionId,
      institutionLevel: sourceVacancy.institutionLevel,
      positionDomain: sourceVacancy.positionDomain,
      leadershipRank: sourceVacancy.leadershipRank,
    });
    sourceVacancy.status = 'open';
    sourceVacancy.selectionId = null;
    const base = structuredClone(fixtureState);
    const run = (status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled') => {
      const state = structuredClone(base);
      const conflict = structuredClone(fixture.selection);
      conflict.status = status;
      conflict.candidates = [structuredClone(npc)];
      conflict.stageResults = [];
      conflict.stageAudits = [];
      conflict.winner = null;
      conflict.winnerId = null;
      conflict.failure = status === 'failed' ? fixture.selection.failure : null;
      state.organization.selections = [conflict];
      const opportunity = opportunityFor(
        state,
        targetVacancy.vacancyId,
        `selection-conflict-${status}`,
      );
      state.career.opportunities = [opportunity];
      return createRelativeSelectionInTransaction(
        state,
        opportunity,
        `process:conflict-${status}`,
        180,
        () => `selection:conflict-${status}`,
        () => 0.5,
      );
    };
    for (const status of ['pending', 'active'] as const) {
      const result = run(status);
      expect(result.success).toBe(true);
      if (!result.success) continue;
      expect(result.selection.candidates.map((candidate) => candidate.candidateId)).toContain(
        'player',
      );
      expect(result.selection.candidates.map((candidate) => candidate.candidateId)).not.toContain(
        npc.candidateId,
      );
    }
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const result = run(status);
      expect(result.success).toBe(true);
      if (!result.success) continue;
      expect(result.selection.candidates.map((candidate) => candidate.candidateId)).toContain(
        npc.candidateId,
      );
    }
  });

  it('最终玩家赢家在 blocker 下只完成一次 Selection，解除后复用冻结结果填补 Vacancy', () => {
    const state = createInitialState();
    makeSelectionCandidatesEligible(state);
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    let randomCalls = 0;
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:blocker',
      180,
      () => 'selection:blocker',
      () => {
        randomCalls += 1;
        return 0.5;
      },
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const oldPlayerAppointment = created.state.career.appointment;
    const oldPlayerSeat = created.state.organization.seats.find(
      (seat) => seat.currentAppointmentId === oldPlayerAppointment.appointmentId,
    );
    makePlayerWinner(created.state);
    created.state.events.activeBlockingEventId = 'selection-blocker';
    const store = createTestStore(created.state);
    const advance = (): void =>
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => {
          throw new Error('Selection stage must not redraw RNG');
        },
      });
    for (let index = 0; index < 6; index += 1) advance();
    const blocked = store.getRawState();
    expect(blocked.organization.selections[0]?.stageResults).toHaveLength(6);
    expect(blocked.organization.selections[0]?.status).toBe('completed');
    expect(blocked.career.activeProcess?.status).toBe('active');
    expect(randomCalls).toBe((blocked.organization.selections[0]?.candidates.length ?? -1) * 6);
    const frozen = structuredClone(blocked);
    advance();
    expect(store.getRawState()).toEqual(frozen);
    store.getRawState().events.activeBlockingEventId = null;
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _idFactory: () => 'appointment-id',
      _rng: () => 0.5,
    });
    expect(store.getRawState().career.appointment.positionId).toBe(opportunity.target.positionId);
    expect(store.getRawState().organization.vacancies[0]?.status).toBe('filled');
    expect(
      store
        .getRawState()
        .organization.vacancies.filter(
          (vacancy) => vacancy.sourceId === oldPlayerAppointment.appointmentId,
        ),
    ).toHaveLength(1);
    expect(
      store.getRawState().organization.seats.find((seat) => seat.seatId === oldPlayerSeat?.seatId),
    ).toMatchObject({ occupant: null, currentAppointmentId: null });
    expect(
      validateOrganizationInvariants(
        store.getRawState().organization,
        store.getRawState().career.appointment,
      ),
    ).toEqual([]);
    const settled = structuredClone(store.getRawState());
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _idFactory: () => {
        throw new Error('Completed process must be idempotent');
      },
      _rng: () => 0.5,
    });
    expect(store.getRawState()).toEqual(settled);
  });

  it('最终 NPC winner 在 blocker 下冻结，解除后复用 Selection 任职且不重抽', () => {
    const state = createInitialState();
    prepareFormalSelectionFacts(state, ['cadre_luo_xia'], 100);
    const vacancy = state.organization.vacancies.find((item) => item.positionId === 'admin_l2_0');
    if (!vacancy) throw new Error('Expected initial admin_l2_0 Vacancy');
    const opportunity = opportunityFor(state, vacancy.vacancyId, 'npc-blocker-opportunity');
    state.career.opportunities = [opportunity];
    let randomCalls = 0;
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:npc-blocker',
      180,
      () => 'selection:npc-blocker',
      () => {
        randomCalls += 1;
        return 0.5;
      },
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    for (const candidate of created.selection.candidates) {
      const npc = candidate.candidateType === 'npc';
      candidate.scoringInputs.assessment = npc ? 100 : 0;
      candidate.scoringInputs.specialty = npc ? 100 : 0;
      candidate.scoringInputs.service = npc ? 100 : 0;
      candidate.scoringInputs.network = npc ? 100 : 0;
      candidate.scoringInputs.integrity = npc ? 100 : 0;
    }
    const oldAppointment = state.organization.cadres.find(
      (cadre) => cadre.cadreId === 'cadre_luo_xia',
    )?.currentAppointment;
    created.state.events.activeBlockingEventId = 'npc-selection-blocker';
    const store = createTestStore(created.state);
    const advance = (): void =>
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => {
          throw new Error('Selection stage must not redraw RNG');
        },
      });
    for (let index = 0; index < 6; index += 1) advance();
    const blocked = store.getRawState();
    const selection = blocked.organization.selections[0];
    expect(selection).toMatchObject({ status: 'completed', winnerId: 'cadre_luo_xia' });
    expect(blocked.organization.vacancies[0]).toMatchObject({ status: 'open', selectionId: null });
    expect(blocked.career.activeProcess).toMatchObject({
      status: 'active',
      currentStage: 'appointment',
      winnerId: 'cadre_luo_xia',
    });
    expect(
      blocked.organization.cadres.find((cadre) => cadre.cadreId === 'cadre_luo_xia')
        ?.currentAppointment,
    ).toEqual(oldAppointment);
    expect(randomCalls).toBe(created.selection.candidates.length * 6);
    const frozen = structuredClone(blocked);
    advance();
    expect(store.getRawState()).toEqual(frozen);
    store.getRawState().events.activeBlockingEventId = null;
    let idCalls = 0;
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _idFactory: () => `npc-blocker-${idCalls++}`,
      // Signals may legitimately evaluate event probabilities; only Selection
      // advancement is forbidden from consuming fresh randomness here.
      _rng: () => 0.5,
    });
    const resumed = store.getRawState();
    expect(resumed.organization.vacancies[0]?.status).toBe('filled');
    expect(resumed.career.activeProcess).toBeNull();
    expect(resumed.career.completedProcesses.at(-1)).toMatchObject({
      status: 'completed',
      winnerId: 'cadre_luo_xia',
    });
    expect(resumed.organization.selections[0]?.stageResults).toHaveLength(6);
    expect(randomCalls).toBe(created.selection.candidates.length * 6);
  });

  it('NPC 延迟期间目标 Vacancy 被填补时，再推进原子失败且不写入部分任职', () => {
    const state = createInitialState();
    prepareFormalSelectionFacts(state, ['cadre_luo_xia'], 100);
    const vacancy = state.organization.vacancies.find((item) => item.positionId === 'admin_l2_0');
    if (!vacancy) throw new Error('Expected initial admin_l2_0 Vacancy');
    const opportunity = opportunityFor(state, vacancy.vacancyId, 'npc-conflict-opportunity');
    state.career.opportunities = [opportunity];
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:npc-conflict',
      180,
      () => 'selection:npc-conflict',
      () => 0.5,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const winnerBefore = created.state.organization.cadres.find(
      (item) => item.cadreId === 'cadre_luo_xia',
    );
    const oldWinnerAppointment = structuredClone(winnerBefore?.currentAppointment);
    const oldWinnerExperiences = structuredClone(winnerBefore?.experiences);
    for (const candidate of created.selection.candidates) {
      const npc = candidate.candidateType === 'npc';
      candidate.scoringInputs.assessment = npc ? 100 : 0;
      candidate.scoringInputs.specialty = npc ? 100 : 0;
      candidate.scoringInputs.service = npc ? 100 : 0;
      candidate.scoringInputs.network = npc ? 100 : 0;
      candidate.scoringInputs.integrity = npc ? 100 : 0;
    }
    created.state.events.activeBlockingEventId = 'npc-conflict-blocker';
    const store = createTestStore(created.state);
    for (let index = 0; index < 6; index += 1)
      store.dispatch({ type: 'ADVANCE_CAREER_PROCESS', opportunityId: opportunity.id });
    const targetVacancy = store
      .getRawState()
      .organization.vacancies.find((item) => item.vacancyId === vacancy.vacancyId);
    const targetSeat = store
      .getRawState()
      .organization.seats.find((item) => item.seatId === targetVacancy?.seatId);
    if (!targetVacancy || !targetSeat) throw new Error('Expected target Vacancy and Seat');
    const frozenSelectionSnapshot = structuredClone(store.getRawState().organization.selections[0]);
    targetSeat.occupant = { type: 'npc', id: 'other-cadre' };
    targetSeat.currentAppointmentId = 'other-appointment';
    targetSeat.occupiedAtDay = 180;
    targetVacancy.status = 'filled';
    targetVacancy.selectionId = null;
    targetVacancy.closedAtDay = 180;
    targetVacancy.filledBy = { type: 'npc', id: 'other-cadre' };
    targetVacancy.filledAppointmentId = 'other-appointment';
    const filledVacancySnapshot = structuredClone(targetVacancy);
    const occupiedSeatSnapshot = structuredClone(targetSeat);
    store.getRawState().events.activeBlockingEventId = null;
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _idFactory: () => 'unused',
    });
    const cancelled = store.getRawState();
    expect(cancelled.career.activeProcess).toBeNull();
    expect(cancelled.career.opportunities.find((item) => item.id === opportunity.id)).toMatchObject(
      {
        status: 'cancelled',
        cancelledAtDay: 180,
        finalOutcome: null,
      },
    );
    expect(cancelled.career.completedProcesses.at(-1)).toMatchObject({
      status: 'cancelled',
      currentStage: 'appointment',
      winnerId: 'cadre_luo_xia',
      stageResults: expect.arrayContaining([
        expect.objectContaining({
          stage: 'appointment',
          outcome: 'cancelled',
          detail: expect.stringContaining('无法任职'),
        }),
      ]),
    });
    expect(cancelled.organization.selections[0]).toEqual(frozenSelectionSnapshot);
    expect(
      cancelled.organization.vacancies.find((item) => item.vacancyId === vacancy.vacancyId),
    ).toEqual(filledVacancySnapshot);
    expect(cancelled.organization.seats.find((item) => item.seatId === targetSeat.seatId)).toEqual(
      occupiedSeatSnapshot,
    );
    const winnerAfter = cancelled.organization.cadres.find(
      (item) => item.cadreId === 'cadre_luo_xia',
    );
    expect(winnerAfter?.currentAppointment).toEqual(oldWinnerAppointment);
    expect(winnerAfter?.experiences).toEqual(oldWinnerExperiences);
    const cancelledSnapshot = structuredClone(cancelled);
    store.dispatch({ type: 'ADVANCE_CAREER_PROCESS', opportunityId: opportunity.id });
    expect(store.getRawState()).toEqual(cancelledSnapshot);
  });

  it('running action 期间 NPC 年度退休后解除死锁并保留生命周期关闭事实', () => {
    const state = createInitialState();
    prepareFormalSelectionFacts(state, ['cadre_luo_xia'], 100);
    const vacancy = state.organization.vacancies.find((item) => item.positionId === 'admin_l2_0');
    if (!vacancy) throw new Error('Expected initial admin_l2_0 Vacancy');
    const opportunity = opportunityFor(state, vacancy.vacancyId, 'npc-retirement-opportunity');
    state.career.opportunities = [opportunity];
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:npc-retirement',
      180,
      () => 'selection:npc-retirement',
      () => 0.5,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    for (const candidate of created.selection.candidates) {
      const npc = candidate.candidateType === 'npc';
      candidate.scoringInputs.assessment = npc ? 100 : 0;
      candidate.scoringInputs.specialty = npc ? 100 : 0;
      candidate.scoringInputs.service = npc ? 100 : 0;
      candidate.scoringInputs.network = npc ? 100 : 0;
      candidate.scoringInputs.integrity = npc ? 100 : 0;
    }
    const winner = created.state.organization.cadres.find(
      (item) => item.cadreId === 'cadre_luo_xia',
    );
    if (!winner?.currentAppointment) throw new Error('Expected NPC appointment');
    const oldAppointmentId = winner.currentAppointment.appointmentId;
    const oldExperienceId = winner.experiences.find((item) => item.endedAtDay === null)?.id;
    winner.birthYear = 1900;
    // Keep the timeline one day before year-end while retaining the Selection's
    // absolute day, so the real annual node retires the frozen winner first.
    created.state.time.month = 12;
    created.state.time.day = 30;
    const store = createTestStore(created.state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_draft_material',
      tierKey: 'primary',
      _idFactory: () => 'npc-retirement-running-action',
    });
    expect(store.getRawState().actions.slots.primary.occupants[0]).not.toBeNull();
    for (let stage = 0; stage < 6; stage += 1)
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => 0.5,
      });
    expect(store.getRawState().career.activeProcess).toMatchObject({
      status: 'active',
      currentStage: 'appointment',
      winnerId: 'cadre_luo_xia',
    });
    const annualIds = (() => {
      let index = 0;
      return () => `npc-retirement-annual-${index++}`;
    })();
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 1,
      _idFactory: annualIds,
    });
    expect(store.getRawState().time).toMatchObject({ totalDaysPlayed: 181, year: 2013 });
    const retired = store
      .getRawState()
      .organization.cadres.find((item) => item.cadreId === 'cadre_luo_xia');
    expect(retired).toMatchObject({ status: 'retired', currentAppointment: null });
    expect(retired?.experiences.find((item) => item.id === oldExperienceId)).toMatchObject({
      endedAtDay: 181,
      endReason: 'retirement',
    });
    expect(store.getRawState().organization.departures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cadreId: 'cadre_luo_xia',
          appointmentId: oldAppointmentId,
          reason: 'retirement',
        }),
      ]),
    );
    expect(store.getRawState().actions.slots.primary.occupants[0]).not.toBeNull();
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 1,
      _idFactory: annualIds,
    });
    expect(store.getRawState().actions.slots.primary.occupants[0]).toBeNull();
    const beforeResumeSelection = structuredClone(store.getRawState().organization.selections[0]);
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _rng: () => 0.5,
      _idFactory: annualIds,
    });
    const cancelled = store.getRawState();
    expect(cancelled.career.activeProcess).toBeNull();
    expect(cancelled.career.opportunities.find((item) => item.id === opportunity.id)).toMatchObject(
      {
        status: 'cancelled',
        finalOutcome: null,
      },
    );
    expect(cancelled.career.completedProcesses.at(-1)).toMatchObject({
      status: 'cancelled',
      winnerId: 'cadre_luo_xia',
      currentStage: 'appointment',
      stageResults: expect.arrayContaining([
        expect.objectContaining({ stage: 'appointment', outcome: 'cancelled' }),
      ]),
    });
    expect(cancelled.organization.selections[0]).toEqual(beforeResumeSelection);
    expect(
      cancelled.organization.vacancies.find((item) => item.vacancyId === vacancy.vacancyId),
    ).toMatchObject({ status: 'open', selectionId: null });
    expect(
      validateOrganizationInvariants(cancelled.organization, cancelled.career.appointment),
    ).toEqual([]);
    const cancelledSnapshot = structuredClone(cancelled);
    store.dispatch({ type: 'ADVANCE_CAREER_PROCESS', opportunityId: opportunity.id });
    expect(store.getRawState()).toEqual(cancelledSnapshot);
  });

  it('open Vacancy 重绑时发现目标 Seat 被占用也会取消冻结流程', () => {
    const state = createInitialState();
    prepareFormalSelectionFacts(state, ['cadre_luo_xia'], 100);
    const vacancy = state.organization.vacancies.find((item) => item.positionId === 'admin_l2_0');
    if (!vacancy) throw new Error('Expected initial admin_l2_0 Vacancy');
    const opportunity = opportunityFor(state, vacancy.vacancyId, 'npc-open-seat-conflict');
    state.career.opportunities = [opportunity];
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:npc-open-seat-conflict',
      180,
      () => 'selection:npc-open-seat-conflict',
      () => 0.5,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    for (const candidate of created.selection.candidates) {
      const npc = candidate.candidateType === 'npc';
      candidate.scoringInputs.assessment = npc ? 100 : 0;
      candidate.scoringInputs.specialty = npc ? 100 : 0;
      candidate.scoringInputs.service = npc ? 100 : 0;
      candidate.scoringInputs.network = npc ? 100 : 0;
      candidate.scoringInputs.integrity = npc ? 100 : 0;
    }
    created.state.events.activeBlockingEventId = 'npc-open-seat-blocker';
    const store = createTestStore(created.state);
    for (let index = 0; index < 6; index += 1)
      store.dispatch({ type: 'ADVANCE_CAREER_PROCESS', opportunityId: opportunity.id });
    const targetSeat = store
      .getRawState()
      .organization.seats.find((item) => item.seatId === vacancy.seatId);
    if (!targetSeat) throw new Error('Expected target Seat');
    const frozenSelectionSnapshot = structuredClone(store.getRawState().organization.selections[0]);
    targetSeat.occupant = { type: 'npc', id: 'other-cadre' };
    targetSeat.currentAppointmentId = 'other-appointment';
    targetSeat.occupiedAtDay = 180;
    const seatSnapshot = structuredClone(targetSeat);
    store.getRawState().events.activeBlockingEventId = null;
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId: opportunity.id,
      _idFactory: () => {
        throw new Error('Seat conflict must fail before ID allocation');
      },
    });
    const cancelled = store.getRawState();
    expect(cancelled.career.activeProcess).toBeNull();
    expect(cancelled.career.opportunities.find((item) => item.id === opportunity.id)).toMatchObject(
      {
        status: 'cancelled',
        finalOutcome: null,
      },
    );
    expect(cancelled.career.completedProcesses.at(-1)).toMatchObject({
      status: 'cancelled',
      winnerId: 'cadre_luo_xia',
      stageResults: expect.arrayContaining([
        expect.objectContaining({ stage: 'appointment', outcome: 'cancelled' }),
      ]),
    });
    expect(cancelled.organization.selections[0]).toEqual(frozenSelectionSnapshot);
    expect(
      cancelled.organization.vacancies.find((item) => item.vacancyId === vacancy.vacancyId),
    ).toMatchObject({
      status: 'open',
      selectionId: null,
    });
    expect(cancelled.organization.seats.find((item) => item.seatId === vacancy.seatId)).toEqual(
      seatSnapshot,
    );
  });

  it('中间阶段 wrap/decode 保留冻结候选、RNG 与审计且继续时不重复阶段', () => {
    const state = createInitialState();
    makeSelectionCandidatesEligible(state);
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:refresh',
      180,
      () => 'selection:refresh',
      () => 0.5,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    makePlayerWinner(created.state);
    const beforeRefresh = createTestStore(created.state);
    for (let index = 0; index < 2; index += 1)
      beforeRefresh.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => 0.5,
      });
    const savedSelection = beforeRefresh.getRawState().organization.selections[0];
    if (!savedSelection) throw new Error('Expected saved Selection');
    const restored = decodeCurrentSave(
      JSON.stringify(wrapSaveEnvelope(beforeRefresh.getRawState())),
    );
    expect(restored.success).toBe(true);
    if (!restored.success || !restored.state) return;
    const restoredSelection = restored.state.organization.selections[0];
    expect(restoredSelection?.candidates).toEqual(savedSelection.candidates);
    expect(restoredSelection?.randomDraws).toEqual(savedSelection.randomDraws);
    expect(restoredSelection?.stageResults).toEqual(savedSelection.stageResults);
    const resumed = createTestStore(restored.state);
    for (let index = 0; index < 4; index += 1)
      resumed.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _rng: () => 0.5,
      });
    const terminal = resumed.getRawState();
    const terminalSelection = terminal.organization.selections[0];
    expect(terminalSelection?.stageResults).toHaveLength(6);
    expect(new Set(terminalSelection?.stageResults?.map((stage) => stage.stage)).size).toBe(6);
    expect(decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(terminal))).success).toBe(true);
  });
});
