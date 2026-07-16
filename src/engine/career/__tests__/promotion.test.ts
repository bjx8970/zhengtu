import { describe, it, expect } from 'vitest';
import { checkPrerequisites, resolveDemocraticVote, resolveOrgInspection } from '../promotion';
import {
  resolveJointReview,
  resolveCommitteeVote,
  resolvePublicNotice,
  resolveProbation,
} from '../promotion-final';
import { calculateFactionPenalty } from '../faction-penalty';
import { getConfigLoader } from '../../../config/loader';
import { OrgInspectResult } from '../../../types/enums';
import type { PromotionContext } from '../../../types/game';
import { createTestStore } from '../../../store/game-store';
import { KPITier } from '../../../types/enums';

const cfg = getConfigLoader().getGameConfig();

function makeCtx(override?: Partial<PromotionContext>): PromotionContext {
  return {
    playerLevel: 3,
    playerScore: 80,
    yearsInPosition: 4,
    politicalCapital: 30,
    corruptionRisk: 10,
    factionReputation: { reform: 20, pragmatic: 30, conservative: 15 },
    relations: { colleagues: {} },
    assessmentHistory: [
      { score: 85, tier: '称职' },
      { score: 90, tier: '优秀' },
      { score: 80, tier: '称职' },
    ],
    hasDisciplinaryRecord: false,
    hasGrassrootsExperience: true,
    hasMultiRegionExperience: false,
    charisma: 60,
    superiorFavor: 40,
    performance: 70,
    competence: 65,
    integrity: 55,
    ...override,
  };
}

describe('calculateFactionPenalty', () => {
  it('单派系有声望 → 0', () => {
    expect(calculateFactionPenalty({ reform: 30, pragmatic: 0, conservative: 0 })).toBe(0);
  });

  it('双派系差距大 → 高分惩罚', () => {
    const result = calculateFactionPenalty({ reform: 80, pragmatic: 20, conservative: 0 });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(15);
  });

  it('三派系均衡 → 低惩罚', () => {
    const result = calculateFactionPenalty({ reform: 30, pragmatic: 30, conservative: 30 });
    expect(result).toBe(0);
  });
});

describe('checkPrerequisites', () => {
  const req = {
    minYearsInService: 3,
    minAssessmentPasses: 2,
    politicalConditions: ['无党纪处分记录'],
  };

  it('全部满足 → eligible', () => {
    const result = checkPrerequisites(makeCtx(), req);
    expect(result.eligible).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('年限不足', () => {
    const result = checkPrerequisites(makeCtx({ yearsInPosition: 1 }), req);
    expect(result.eligible).toBe(false);
    expect(result.missing.some((m) => m.includes('年限'))).toBe(true);
  });

  it('考核称职次数不足', () => {
    const ctx = makeCtx({
      assessmentHistory: [
        { score: 60, tier: '基本称职' },
        { score: 55, tier: '不称职' },
      ],
    });
    const result = checkPrerequisites(ctx, { ...req, minAssessmentPasses: 3 });
    expect(result.eligible).toBe(false);
    expect(result.missing.some((m) => m.includes('考核'))).toBe(true);
  });

  it('党纪处分记录 → 不通过', () => {
    const result = checkPrerequisites(makeCtx({ hasDisciplinaryRecord: true }), req);
    expect(result.eligible).toBe(false);
    expect(result.missing.some((m) => m.includes('处分'))).toBe(true);
  });

  it('缺少基层经历 + specialConditions 要求', () => {
    const result = checkPrerequisites(makeCtx({ hasGrassrootsExperience: false }), {
      ...req,
      specialConditions: ['grassroots'],
    });
    expect(result.eligible).toBe(false);
    expect(result.missing.some((m) => m.includes('基层'))).toBe(true);
  });

  it('缺少跨地区经历', () => {
    const result = checkPrerequisites(makeCtx(), { ...req, specialConditions: ['multi_region'] });
    expect(result.eligible).toBe(false);
    expect(result.missing.some((m) => m.includes('跨地区'))).toBe(true);
  });
});

describe('resolveDemocraticVote', () => {
  it('高属性通过', () => {
    const result = resolveDemocraticVote(makeCtx(), {}, cfg);
    expect(result.passed).toBe(true);
    expect(result.votes).toBeGreaterThanOrEqual(60);
  });

  it('低属性不通过', () => {
    const ctx = makeCtx({
      playerScore: 20,
      charisma: 20,
      superiorFavor: 10,
    });
    const result = resolveDemocraticVote(ctx, {}, cfg);
    expect(result.passed).toBe(false);
    expect(result.votes).toBeLessThan(60);
  });

  it('动用人脉拉票通过', () => {
    const ctx = makeCtx({
      playerScore: 55,
      charisma: 55,
      superiorFavor: 55,
      factionReputation: { reform: 0, pragmatic: 0, conservative: 0 },
    });
    const result = resolveDemocraticVote(ctx, { useConnections: true }, cfg);
    expect(result.passed).toBe(true);
  });

  it('拉票可能触发风险（rng 强制触发）', () => {
    const ctx = makeCtx();
    const result = resolveDemocraticVote(ctx, { useConnections: true }, cfg, () => 0);
    expect(result.flaggedForRisk).toBe(true);
  });

  it('得票刚好60 → 通过', () => {
    const ctx = makeCtx({
      playerScore: 60,
      charisma: 60,
      superiorFavor: 60,
      factionReputation: { reform: 0, pragmatic: 0, conservative: 0 },
    });
    const result = resolveDemocraticVote(ctx, {}, cfg);
    expect(result.passed).toBe(true);
  });
});

describe('resolveOrgInspection', () => {
  it('优秀', () => {
    const ctx = makeCtx({ performance: 95, competence: 90, playerScore: 90, integrity: 90 });
    const result = resolveOrgInspection(ctx, {}, cfg);
    expect(result.result).toBe(OrgInspectResult.Excellent);
    expect(result.passed).toBe(true);
  });

  it('合格', () => {
    const result = resolveOrgInspection(makeCtx(), {}, cfg);
    expect(result.result).toBe(OrgInspectResult.Qualified);
    expect(result.passed).toBe(true);
  });

  it('暂缓使用', () => {
    const ctx = makeCtx({ performance: 45, competence: 45, playerScore: 45, integrity: 45 });
    const result = resolveOrgInspection(ctx, {}, cfg);
    expect(result.result).toBe(OrgInspectResult.Suspended);
    expect(result.passed).toBe(false);
  });

  it('不宜提拔', () => {
    const ctx = makeCtx({ performance: 10, competence: 10, playerScore: 10, integrity: 10 });
    const result = resolveOrgInspection(ctx, {}, cfg);
    expect(result.result).toBe(OrgInspectResult.Rejected);
    expect(result.passed).toBe(false);
  });

  it('引导考察组消耗政治资本', () => {
    const ctx = makeCtx({ politicalCapital: 50 });
    const result = resolveOrgInspection(ctx, { influenceInspectors: true }, cfg);
    expect(result.politicalCost).toBe(cfg.promotion.orgInspection.influencePoliticalCost);
  });

  it('政治资本不足无法引导', () => {
    const ctx = makeCtx({ politicalCapital: 5 });
    const result = resolveOrgInspection(ctx, { influenceInspectors: true }, cfg);
    expect(result.politicalCost).toBe(0);
  });
});

describe('resolveJointReview', () => {
  it('低腐败 + 好运气 → 全过', () => {
    const result = resolveJointReview(makeCtx(), cfg, () => 0.5);
    expect(result.passed).toBe(true);
    expect(result.opinions['纪委']).toBe(true);
  });

  it('高腐败 → 纪委直接否决', () => {
    const result = resolveJointReview(makeCtx({ corruptionRisk: 80 }), cfg, () => 1);
    expect(result.passed).toBe(false);
    expect(result.opinions['纪委']).toBe(false);
    expect(result.detail).toContain('纪委');
  });

  it('信访随机否决（高风险 + rng 使概率归零）', () => {
    const result = resolveJointReview(makeCtx({ corruptionRisk: 250 }), cfg, () => 0);
    expect(result.opinions['信访']).toBe(false);
  });

  it('多部门未通过 → detail 列出', () => {
    const result = resolveJointReview(makeCtx({ corruptionRisk: 80 }), cfg, () => 0.95);
    expect(result.passed).toBe(false);
    const deptNames = ['纪委', '公安', '信访', '审计', '网信'];
    expect(deptNames.some((d) => result.detail.includes(d))).toBe(true);
  });
});

describe('resolveCommitteeVote', () => {
  it('高声望 + 高好感 → 通过', () => {
    const ctx = makeCtx({
      superiorFavor: 80,
      factionReputation: { reform: 70, pragmatic: 60, conservative: 50 },
    });
    const result = resolveCommitteeVote(ctx, cfg, () => 0.4);
    expect(result.passed).toBe(true);
  });

  it('低声望 + 差运气 → 不通过', () => {
    const ctx = makeCtx({
      superiorFavor: 10,
      factionReputation: { reform: 5, pragmatic: 5, conservative: 5 },
    });
    const result = resolveCommitteeVote(ctx, cfg, () => 0.5);
    expect(result.passed).toBe(false);
  });

  it('committee 大小随级别增长', () => {
    const l1 = resolveCommitteeVote(makeCtx({ playerLevel: 1 }), cfg, () => 0.5);
    const l11 = resolveCommitteeVote(makeCtx({ playerLevel: 11 }), cfg, () => 0.5);
    const size1 = l1.forVotes + l1.againstVotes;
    const size11 = l11.forVotes + l11.againstVotes;
    expect(size11).toBeGreaterThanOrEqual(size1);
    expect(size11).toBeLessThanOrEqual(cfg.promotion.committeeVote.maxSize);
  });
});

describe('resolvePublicNotice', () => {
  it('低风险 → 通过', () => {
    const result = resolvePublicNotice(makeCtx({ corruptionRisk: 0 }), cfg, () => 1);
    expect(result.passed).toBe(true);
    expect(result.hasComplaint).toBe(false);
    expect(result.sentimentEscalated).toBe(false);
  });

  it('高腐败 → 可能举报', () => {
    const ctx = makeCtx({ corruptionRisk: 200 });
    const result = resolvePublicNotice(ctx, cfg, () => 0.5);
    expect(result.passed).toBe(false);
  });

  it('rng 0.999 → 低腐败不通过概率极低', () => {
    const result = resolvePublicNotice(makeCtx({ corruptionRisk: 10 }), cfg, () => 0.999);
    expect(result.passed).toBe(true);
  });
});

describe('resolveProbation', () => {
  it('高能力通过', () => {
    const ctx = makeCtx({ competence: 90, playerScore: 85 });
    const result = resolveProbation(ctx, cfg, () => 0.5);
    expect(result.passed).toBe(true);
  });

  it('低能力不通过', () => {
    const ctx = makeCtx({ competence: 20, playerScore: 20 });
    const result = resolveProbation(ctx, cfg, () => 0);
    expect(result.passed).toBe(false);
  });

  it('能力刚好门槛附近 + 运气差 → 不通过', () => {
    const ctx = makeCtx({ competence: 40, playerScore: 40 });
    const result = resolveProbation(ctx, cfg, () => 0);
    expect(result.passed).toBe(false);
  });
});

describe('store integration', () => {
  it('START_PROMOTION 冻结期中拒绝', () => {
    const { dispatch, getRawState } = createTestStore({
      currentLevel: 2,
      yearsInCurrentPosition: 4,
      annualAssessments: [
        { year: 2024, score: 90, tier: KPITier.Excellent },
        { year: 2025, score: 85, tier: KPITier.Competent },
        { year: 2026, score: 90, tier: KPITier.Excellent },
      ],
      frozenPeriods: 2,
    });
    dispatch({ type: 'START_PROMOTION' });
    expect(getRawState().promotionStage).toBe('idle');
  });

  it('START_PROMOTION 满足条件 → 进入民主推荐', () => {
    const { dispatch, getRawState } = createTestStore({
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 4,
      annualAssessments: [
        { year: 2024, score: 90, tier: KPITier.Excellent },
        { year: 2025, score: 85, tier: KPITier.Competent },
        { year: 2026, score: 90, tier: KPITier.Excellent },
      ],
      frozenPeriods: 0,
      superiorFavor: 50,
      charisma: 50,
      comprehensiveScore: 80,
      politicalCapital: 30,
    });
    dispatch({ type: 'START_PROMOTION' });
    const state = getRawState();
    expect(state.promotionStage).toBe('democratic_vote');
    expect(state.promotionState).not.toBeNull();
    expect(state.promotionState!.targetLevel).toBe(3);
    expect(state.promotionState!.currentStage).toBe('democratic_vote');
  });

  it('START_PROMOTION 年限不足 → failed', () => {
    const { dispatch, getRawState } = createTestStore({
      currentLevel: 2,
      yearsInCurrentPosition: 1,
      annualAssessments: [],
      frozenPeriods: 0,
    });
    dispatch({ type: 'START_PROMOTION' });
    expect(getRawState().promotionStage).toBe('failed');
  });

  it('完整流程：idle → democratic_vote → 成功 → completed', () => {
    const { dispatch, getRawState } = createTestStore({
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 4,
      annualAssessments: [
        { year: 2024, score: 90, tier: KPITier.Excellent },
        { year: 2025, score: 85, tier: KPITier.Competent },
        { year: 2026, score: 90, tier: KPITier.Excellent },
      ],
      frozenPeriods: 0,
      comprehensiveScore: 95,
      charisma: 80,
      competence: 80,
      integrity: 80,
      performance: 80,
      superiorFavor: 80,
      corruptionRisk: 0,
      politicalCapital: 50,
    });
    // Deterministic "good luck" RNG
    const goodRng = () => 0.3;
    // 启动
    dispatch({ type: 'START_PROMOTION' });
    expect(getRawState().promotionStage).toBe('democratic_vote');

    // 阶段1
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: goodRng });
    expect(getRawState().promotionStage).toBe('org_inspection');

    // 阶段2
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: goodRng });
    expect(getRawState().promotionStage).toBe('joint_review');

    // 阶段3
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: goodRng });
    expect(getRawState().promotionStage).toBe('committee_vote');

    // 阶段4
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: goodRng });
    expect(getRawState().promotionStage).toBe('public_notice');

    // 阶段5
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: goodRng });
    expect(getRawState().promotionStage).toBe('appointment');

    // 任命
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: goodRng });
    expect(getRawState().promotionStage).toBe('probation');

    // 试用期
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: goodRng });
    const final = getRawState();
    expect(final.promotionStage).toBe('completed');
    expect(final.currentLevel).toBe(3);
    expect(final.yearsInCurrentPosition).toBe(0);
    expect(final.careerHistory.length).toBe(1);
    expect(final.politicalCapital).toBeGreaterThan(30);
  });

  it('晋升中拒绝 ADVANCE_TIME', () => {
    const { dispatch, getRawState } = createTestStore({
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 4,
      annualAssessments: [
        { year: 2024, score: 90, tier: KPITier.Excellent },
        { year: 2025, score: 85, tier: KPITier.Competent },
        { year: 2026, score: 90, tier: KPITier.Excellent },
      ],
      frozenPeriods: 0,
    });
    dispatch({ type: 'START_PROMOTION' });
    const yearBefore = getRawState().time.year;
    dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
    expect(getRawState().time.year).toBe(yearBefore);
  });

  it('晋升中拒绝 EXECUTE_ACTION', () => {
    const { dispatch, getRawState } = createTestStore({
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 4,
      annualAssessments: [
        { year: 2024, score: 90, tier: KPITier.Excellent },
        { year: 2025, score: 85, tier: KPITier.Competent },
      ],
      frozenPeriods: 0,
    });
    dispatch({ type: 'START_PROMOTION' });
    const actionsBefore = getRawState().totalActions;
    dispatch({ type: 'EXECUTE_ACTION', deptId: 'dummy', actionId: 'dummy' });
    expect(getRawState().totalActions).toBe(actionsBefore);
  });
});
