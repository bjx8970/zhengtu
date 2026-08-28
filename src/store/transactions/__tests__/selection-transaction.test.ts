/** Relative Selection Store 事务的冻结、绑定和随机输入审计测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../../game-store';
import type { AppointmentCareerOpportunity } from '../../../domain/career/state';
import type { PlayerSave } from '../../../types/player';
import { createRelativeSelectionInTransaction } from '../selection-transaction';
import { decodeCurrentSave, wrapSaveEnvelope } from '../../save-codec';

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
  state.career.specialties = { public_management: 80 };
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
  unassigned.specialties = { public_management: 80 };
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

  it('玩家首阶段淘汰后以有界循环完成剩余六阶段且仅保留 NPC winner', () => {
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
    expect(result.career.completedProcesses.at(-1)?.status).toBe('completed');
    expect(
      result.organization.vacancies.find((vacancy) => vacancy.vacancyId === opportunity.vacancyId),
    ).toMatchObject({
      status: 'open',
      selectionId: null,
    });
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
