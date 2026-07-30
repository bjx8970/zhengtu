/** 公务员职级晋升引擎不变量测试。 */
import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import { createInitialState } from '../../../store/game-store';
import { advanceCivilServiceRank } from '../civil-service-rank-progression';

describe('advanceCivilServiceRank', () => {
  it('provisions every configured rank quota in a normal new game', () => {
    const state = createInitialState();
    for (const rule of getConfigLoader().getAllCivilServiceRankProgressionRules()) {
      const quota = rule.quotaRequirement;
      if (!quota) continue;
      expect(state.world.metrics[quota.metricId]).toBeGreaterThanOrEqual(quota.requiredValue);
    }
  });

  it('rejects a rule whose source rank does not match the current rank', () => {
    const state = createInitialState();
    const rule = getConfigLoader().getCivilServiceRankProgressionRule('clerk_1');
    expect(rule).not.toBeNull();
    if (!rule) return;

    const result = advanceCivilServiceRank({
      state,
      currentDay: 1080,
      daysPerYear: 360,
      rule,
      idFactory: () => 'unexpected-rank-change',
      sourceType: 'system',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('rule_source_mismatch');
    expect(result.eligibility.toRank).toBeNull();
  });
});
