/** 职业机会接受、选拔和原子任职事务集成测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';
import type { AppointmentCareerOpportunity } from '../../domain/career/state';

describe('career opportunity reducer', () => {
  it('settles a leadership appointment without changing civil-service rank', () => {
    const initial = createInitialState();
    const opportunity: AppointmentCareerOpportunity = {
      id: 'opportunity-1',
      definitionId: 'township_deputy_leadership_vacancy',
      type: 'leadership_vacancy',
      status: 'available',
      source: {
        sourceType: 'assessment',
        sourceId: 'assessment-1',
        signalId: 'assessment-1',
        description: 'assessment.completed',
      },
      target: {
        positionId: 'admin_l2_0',
        positionName: '副镇长',
        institutionId: 'township_govt_01',
        institutionName: '青云镇人民政府',
        regionId: 'region_qingyun_town',
        institutionLevel: 'township',
        positionDomain: 'local_governance',
        leadershipRank: 'township_deputy',
      },
      appointmentType: 'substantive',
      appointmentReason: 'promotion',
      appearedAtDay: 0,
      expiresAtDay: 30,
      acceptedAtDay: null,
      rejectedAtDay: null,
      resolvedAtDay: null,
      cancelledAtDay: null,
      requiresSelection: true,
      eligibilityConditions: [],
      finalOutcome: null,
      reason: 'test',
    };
    initial.career.opportunities = [opportunity];
    const store = createTestStore({ career: initial.career });
    let sequence = 0;
    const ids = () => `id-${++sequence}`;
    const rank = store.getRawState().career.civilServiceRank;
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _idFactory: ids,
    });
    for (let step = 0; step < 6; step++)
      store.dispatch({
        type: 'ADVANCE_CAREER_PROCESS',
        opportunityId: opportunity.id,
        _idFactory: ids,
        _rng: () => 0,
      });
    const state = store.getRawState();
    expect(state.career.appointment.positionId).toBe('admin_l2_0');
    expect(state.career.civilServiceRank).toBe(rank);
    expect(state.career.experiences.filter((item) => item.endedAtDay === null)).toHaveLength(1);
    expect(state.career.experiences[0]?.endedAtDay).toBe(0);
    expect(state.career.opportunities[0]?.finalOutcome).toBe('appointed');
  });
});
