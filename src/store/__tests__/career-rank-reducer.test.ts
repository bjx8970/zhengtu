/** 公务员职级 Store 事务测试。 */
import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';

describe('ADVANCE_CIVIL_SERVICE_RANK', () => {
  it('advances rank without changing appointment and consumes quota', () => {
    const state = createInitialState();
    state.time.totalDaysPlayed = 360;
    state.assessments.annualAssessments.push({ year: 2026, score: 90, tier: '优秀' });
    state.world.metrics['rank_quota.clerk_1'] = 1;
    const appointment = structuredClone(state.career.appointment);
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: () => 'rank-change' });
    expect(store.getState().career.civilServiceRank).toBe('clerk_1');
    expect(store.getState().career.appointment).toEqual(appointment);
    expect(store.getState().world.metrics['rank_quota.clerk_1']).toBe(0);
    expect(store.getState().career.civilServiceRankHistory[0]?.id).toBe('rank-change');
  });
});
