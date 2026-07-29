/** 公务员职级资格、服务天数与限制测试。 */
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../store/game-store';
import { getConfigLoader } from '../../../config/loader';
import { CivilServiceRankConfigSchema } from '../../../config/schemas';
import {
  calculateCareerServiceDays,
  evaluateCivilServiceRankEligibility,
  getActiveCareerRestrictions,
} from '../civil-service-rank-eligibility';

describe('civil-service rank eligibility', () => {
  it('uses [startedAtDay, endsAtDay) for active restrictions', () => {
    const restrictions = [
      {
        id: 'freeze',
        type: 'rank_advancement_freeze' as const,
        startedAtDay: 5,
        endsAtDay: 10,
        reason: '',
        sourceType: 'system' as const,
        sourceId: null,
      },
    ];
    expect(getActiveCareerRestrictions(restrictions, 4)).toHaveLength(0);
    expect(getActiveCareerRestrictions(restrictions, 5)).toHaveLength(1);
    expect(getActiveCareerRestrictions(restrictions, 10)).toHaveLength(0);
  });

  it('merges overlapping career intervals', () => {
    const state = createInitialState();
    state.career.appointment.startedAtDay = 10;
    state.career.experiences = [
      {
        id: 'past',
        positionId: 'p',
        positionNameSnapshot: 'p',
        institutionId: 'i',
        institutionNameSnapshot: 'i',
        institutionLevel: 'township',
        regionId: 'r',
        positionDomain: 'local_governance',
        leadershipRank: 'none',
        startedAtDay: 0,
        endedAtDay: 20,
        appointmentReason: 'initial_assignment',
        assessmentResults: [],
      },
    ];
    expect(calculateCareerServiceDays(state.career.appointment, state.career.experiences, 30)).toBe(
      30,
    );
  });

  it('requires days, assessment, quota and no restrictions', () => {
    const state = createInitialState();
    state.career.civilServiceRankStartedAtDay = 0;
    state.assessments.annualAssessments.push({ year: 2026, score: 90, tier: '优秀' });
    state.world.metrics['rank_quota.clerk_1'] = 1;
    const rule = getConfigLoader().getCivilServiceRankProgressionRule('clerk_2');
    const result = evaluateCivilServiceRankEligibility(state, 360, 360, rule);
    expect(result.eligible).toBe(true);
    state.career.restrictions.push({
      id: 'discipline',
      type: 'disciplinary_action',
      startedAtDay: 0,
      endsAtDay: null,
      reason: '',
      sourceType: 'system',
      sourceId: null,
    });
    expect(evaluateCivilServiceRankEligibility(state, 360, 360, rule).failures[0]?.reason).toBe(
      'disciplinary_restriction',
    );
  });

  it('rejects transient signal-field conditions in rank rules', () => {
    const config = {
      definitions: getConfigLoader().getAllCivilServiceRankDefinitions(),
      progressionRules: [
        {
          id: 'invalid',
          fromRank: 'clerk_2',
          toRank: 'clerk_1',
          minDaysInRank: 0,
          minServiceDays: 0,
          minAssessmentCount: 0,
          minQualifiedAssessmentCount: 0,
          minExcellentAssessmentCount: 0,
          quotaRequirement: null,
          additionalConditions: [{ signalField: 'tier', op: 'eq', value: '优秀' }],
        },
      ],
    };
    expect(CivilServiceRankConfigSchema.safeParse(config).success).toBe(false);
  });
});
