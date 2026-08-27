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

function opportunityFor(state: PlayerSave): AppointmentCareerOpportunity {
  const vacancy = state.organization.vacancies.find((item) => item.status === 'open');
  if (!vacancy) throw new Error('Expected an open Vacancy');
  return {
    id: 'selection-transaction-opportunity',
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
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    let randomCalls = 0;
    let idCalls = 0;
    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:test',
      0,
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
    const opportunity = opportunityFor(state);
    opportunity.vacancyId = 'missing-vacancy';
    state.career.opportunities = [opportunity];
    const before = structuredClone(state);
    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:test',
      0,
      () => 'selection:test',
      () => 0.5,
    );
    expect(result.success).toBe(false);
    expect(state).toEqual(before);
  });

  it('无合格候选在接受事务内终止 Selection 但保留 open Vacancy', () => {
    const state = createInitialState();
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    makeAllCandidatesIneligible(state, 0);
    const result = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:no-qualified',
      0,
      () => 'selection:no-qualified',
      () => 0.5,
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
  });

  it('玩家首阶段淘汰后以有界循环完成剩余六阶段且仅保留 NPC winner', () => {
    const state = createInitialState();
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:eliminated',
      0,
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

  it('最终玩家赢家在 blocker 下只完成一次 Selection，解除后复用冻结结果填补 Vacancy', () => {
    const state = createInitialState();
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    let randomCalls = 0;
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:blocker',
      0,
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
    const opportunity = opportunityFor(state);
    state.career.opportunities = [opportunity];
    const created = createRelativeSelectionInTransaction(
      state,
      opportunity,
      'process:refresh',
      0,
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
