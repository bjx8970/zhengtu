/** 公务员职级资格、服务天数与限制测试。 */
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../store/game-store';
import { getConfigLoader } from '../../../config/loader';
import { CivilServiceRankConfigSchema } from '../../../config/schemas';
import { KPITier } from '../../../types/enums';
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
        appointmentId: 'past-appointment',
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
        appointmentType: 'substantive',
        sourceOpportunityId: null,
        endReason: 'promotion',
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
    const probation = state.career.appointment.probation;
    expect(probation).not.toBeNull();
    if (!probation) return;
    probation.status = 'passed';
    state.assessments.annualAssessments.push({ year: 2026, score: 90, tier: '优秀' });
    state.world.metrics['rank_quota.clerk_1'] = 1;
    const rule = getConfigLoader().getCivilServiceRankProgressionRule('clerk_2');
    const result = evaluateCivilServiceRankEligibility(state, 360, 360, rule);
    expect(result.eligible).toBe(true);
    const restriction = {
      id: 'discipline',
      type: 'rank_advancement_freeze' as const,
      startedAtDay: 0,
      endsAtDay: null,
      reason: '',
      sourceType: 'system' as const,
      sourceId: null,
    };
    state.career.restrictions.push(restriction);
    expect(evaluateCivilServiceRankEligibility(state, 360, 360, rule).failures[0]?.reason).toBe(
      'rank_advancement_frozen',
    );
    state.career.restrictions[0] = { ...restriction, type: 'disciplinary_action' };
    expect(evaluateCivilServiceRankEligibility(state, 360, 360, rule).failures[0]?.reason).toBe(
      'disciplinary_restriction',
    );
  });

  it('returns every concrete missing prerequisite for a new clerk', () => {
    const state = createInitialState();
    const rule = getConfigLoader().getCivilServiceRankProgressionRule('clerk_2');
    const reasons = evaluateCivilServiceRankEligibility(state, 0, 360, rule).failures.map(
      (failure) => failure.reason,
    );
    expect(reasons).toEqual(
      expect.arrayContaining([
        'probation_active',
        'insufficient_days_in_rank',
        'insufficient_service_days',
        'insufficient_assessments',
        'insufficient_qualified_assessments',
        'quota_unavailable',
      ]),
    );
  });

  it('blocks active or failed probation but allows passed and later no-probation appointments', () => {
    const state = createInitialState();
    state.assessments.annualAssessments.push({ year: 2026, score: 90, tier: '优秀' });
    state.world.metrics['rank_quota.clerk_1'] = 1;
    const rule = getConfigLoader().getCivilServiceRankProgressionRule('clerk_2');

    expect(evaluateCivilServiceRankEligibility(state, 360, 360, rule).failures[0]?.reason).toBe(
      'probation_active',
    );
    const probation = state.career.appointment.probation;
    expect(probation).not.toBeNull();
    if (!probation) return;
    probation.status = 'failed';
    expect(evaluateCivilServiceRankEligibility(state, 360, 360, rule).failures[0]?.reason).toBe(
      'probation_failed',
    );
    probation.status = 'passed';
    expect(evaluateCivilServiceRankEligibility(state, 360, 360, rule).eligible).toBe(true);
    state.career.appointment.probation = null;
    expect(evaluateCivilServiceRankEligibility(state, 360, 360, rule).eligible).toBe(true);
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

  it('rejects signal-sourced policy conditions in rank rules', () => {
    const config = {
      definitions: getConfigLoader().getAllCivilServiceRankDefinitions(),
      progressionRules: [
        {
          id: 'invalid-policy-signal',
          fromRank: 'clerk_2',
          toRank: 'clerk_1',
          minDaysInRank: 0,
          minServiceDays: 0,
          minAssessmentCount: 0,
          minQualifiedAssessmentCount: 0,
          minExcellentAssessmentCount: 0,
          quotaRequirement: null,
          additionalConditions: [
            {
              policyRef: { source: 'signal' },
              check: 'status_is',
              value: 'implementing',
            },
          ],
        },
      ],
    };
    expect(CivilServiceRankConfigSchema.safeParse(config).success).toBe(false);
  });

  it('allows a rule ID equal to a distinct source rank', () => {
    const progressionRules = getConfigLoader().getAllCivilServiceRankProgressionRules();
    const firstRule = progressionRules[0];
    const secondRule = progressionRules[1];
    expect(firstRule).toBeDefined();
    expect(secondRule).toBeDefined();
    if (!firstRule || !secondRule) return;
    secondRule.id = firstRule.fromRank;
    const config = {
      definitions: getConfigLoader().getAllCivilServiceRankDefinitions(),
      progressionRules,
    };
    expect(CivilServiceRankConfigSchema.safeParse(config).success).toBe(true);
  });

  it('requires a progression rule for every non-highest rank', () => {
    const config = {
      definitions: getConfigLoader().getAllCivilServiceRankDefinitions(),
      progressionRules: getConfigLoader().getAllCivilServiceRankProgressionRules().slice(0, -1),
    };
    expect(CivilServiceRankConfigSchema.safeParse(config).success).toBe(false);
  });

  it('requires each rank definition to use its canonical order', () => {
    const definitions = getConfigLoader().getAllCivilServiceRankDefinitions();
    const lowest = definitions.find((item) => item.id === 'clerk_2');
    const highest = definitions.find((item) => item.id === 'inspector_1');
    expect(lowest).toBeDefined();
    expect(highest).toBeDefined();
    if (!lowest || !highest) return;
    [lowest.order, highest.order] = [highest.order, lowest.order];
    const config = {
      definitions,
      progressionRules: getConfigLoader().getAllCivilServiceRankProgressionRules(),
    };
    expect(CivilServiceRankConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects quota requirements that exceed their inventory ceiling', () => {
    const progressionRules = getConfigLoader().getAllCivilServiceRankProgressionRules();
    const firstRule = progressionRules[0];
    expect(firstRule?.quotaRequirement).not.toBeNull();
    if (!firstRule?.quotaRequirement) return;
    firstRule.quotaRequirement.requiredValue = firstRule.quotaRequirement.maxValue + 1;
    const config = {
      definitions: getConfigLoader().getAllCivilServiceRankDefinitions(),
      progressionRules,
    };
    expect(CivilServiceRankConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects duplicate annual-assessment tiers in a quota producer', () => {
    const progressionRules = getConfigLoader().getAllCivilServiceRankProgressionRules();
    const firstRule = progressionRules[0];
    expect(firstRule?.quotaRequirement).not.toBeNull();
    if (!firstRule?.quotaRequirement) return;
    firstRule.quotaRequirement.grantAssessmentTiers = [KPITier.Excellent, KPITier.Excellent];
    const config = {
      definitions: getConfigLoader().getAllCivilServiceRankDefinitions(),
      progressionRules,
    };
    expect(CivilServiceRankConfigSchema.safeParse(config).success).toBe(false);
  });

  it('distinguishes the highest rank from a missing progression rule', () => {
    const state = createInitialState();
    state.career.civilServiceRank = 'inspector_1';
    const result = evaluateCivilServiceRankEligibility(state, 0, 360, null);
    expect(result.failures[0]?.reason).toBe('already_highest_rank');
  });
});
