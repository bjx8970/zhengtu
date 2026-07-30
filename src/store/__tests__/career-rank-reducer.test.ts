/** 公务员职级 Store 事务测试。 */
import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';

describe('ADVANCE_CIVIL_SERVICE_RANK', () => {
  it('advances from a normal new-game quota baseline without changing appointment', () => {
    const state = createInitialState();
    state.time.totalDaysPlayed = 360;
    state.assessments.annualAssessments.push({ year: 2026, score: 90, tier: '优秀' });
    expect(state.world.metrics['rank_quota.clerk_1']).toBe(1);
    const appointment = structuredClone(state.career.appointment);
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: () => 'rank-change' });
    expect(store.getState().career.civilServiceRank).toBe('clerk_1');
    expect(store.getState().career.appointment).toEqual(appointment);
    expect(store.getState().world.metrics['rank_quota.clerk_1']).toBe(0);
    expect(store.getState().career.civilServiceRankHistory[0]?.id).toBe('rank-change');
  });

  it('does not modify state when the current rank has no progression rule', () => {
    const state = createInitialState();
    state.career.civilServiceRank = 'inspector_1';
    const store = createTestStore(state);
    const before = structuredClone(store.getRawState());
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK' });
    expect(store.getRawState()).toEqual(before);
  });

  it('does not modify state when eligibility fails', () => {
    const store = createTestStore();
    const before = structuredClone(store.getRawState());
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK' });
    expect(store.getRawState()).toEqual(before);
  });
});
