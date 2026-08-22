/** 公务员职级 Store 事务测试。 */
import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';

describe('ADVANCE_CIVIL_SERVICE_RANK', () => {
  it('atomically consumes earned quota without changing the appointment channel', () => {
    const state = createInitialState();
    state.time.totalDaysPlayed = 360;
    const probation = state.career.appointment.probation;
    expect(probation).not.toBeNull();
    if (!probation) return;
    probation.status = 'passed';
    state.assessments.annualAssessments.push({ year: 2026, score: 90, tier: '优秀' });
    state.world.metrics['rank_quota.clerk_1'] = 1;
    expect(state.world.metrics['rank_quota.clerk_1']).toBe(1);
    const appointment = structuredClone(state.career.appointment);
    const openExperience = structuredClone(state.career.experiences[0]);
    const opportunities = structuredClone(state.career.opportunities);
    const store = createTestStore(state);
    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: () => 'rank-change' });
    expect(store.getState().career.civilServiceRank).toBe('clerk_1');
    expect(store.getState().career.appointment).toEqual(appointment);
    expect(store.getState().career.experiences[0]).toEqual(openExperience);
    expect(store.getState().career.opportunities).toEqual(opportunities);
    expect(store.getState().world.metrics['rank_quota.clerk_1']).toBe(0);
    expect(store.getState().career.civilServiceRankHistory[0]?.id).toBe('rank-change');

    store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: () => 'duplicate' });
    expect(store.getState().career.civilServiceRank).toBe('clerk_1');
    expect(store.getState().career.civilServiceRankHistory).toHaveLength(1);
    expect(store.getState().world.metrics['rank_quota.section_member_4']).toBe(0);
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
