/**
 * 晋升目标选择引擎测试
 *
 * 覆盖场景：
 * - getPromotionCandidates: 正常返回/无下一级别/空职位
 * - validatePromotionTarget: 合法目标/非法ID/跨级/前置条件不满足
 */
import { describe, it, expect } from 'vitest';
import { getPromotionCandidates, validatePromotionTarget } from '../promotion-target';
import { getConfigLoader } from '../../../config/loader';
import { CareerLine } from '../../../types/enums';
import type { PromotionContext } from '../../../types/game';

const loader = getConfigLoader();
const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;

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

describe('getPromotionCandidates', () => {
  it('L1 → L2 返回所有候选职位', () => {
    const candidates = getPromotionCandidates(CareerLine.Administrative, 1, adminCfg);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    for (const c of candidates) {
      expect(c.level).toBe(2);
      expect(c.careerLine).toBe(CareerLine.Administrative);
      expect(c.positionId).toBeTruthy();
      expect(c.positionName).toBeTruthy();
      expect(c.blockedReason).toBeUndefined();
    }
  });

  it('L2 → L3 返回所有候选职位', () => {
    const candidates = getPromotionCandidates(CareerLine.Administrative, 2, adminCfg);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    for (const c of candidates) {
      expect(c.level).toBe(3);
    }
  });

  it('最高等级无下一级 → 空数组', () => {
    // 当前行政线只有 L1-L3，L3 无下一级
    const candidates = getPromotionCandidates(CareerLine.Administrative, 3, adminCfg);
    expect(candidates).toHaveLength(0);
  });

  it('不存在的等级 → 空数组', () => {
    const candidates = getPromotionCandidates(CareerLine.Administrative, 99, adminCfg);
    expect(candidates).toHaveLength(0);
  });
});

describe('validatePromotionTarget', () => {
  it('合法目标 → valid', () => {
    const candidates = getPromotionCandidates(CareerLine.Administrative, 1, adminCfg);
    expect(candidates.length).toBeGreaterThan(0);
    const target = candidates[0]!;
    const result = validatePromotionTarget(
      target.positionId,
      1,
      adminCfg,
      makeCtx({ playerLevel: 1, yearsInPosition: 4 }),
    );
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('不存在的职位 ID → invalid', () => {
    const result = validatePromotionTarget(
      'nonexistent_pos',
      1,
      adminCfg,
      makeCtx({ playerLevel: 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('不存在');
  });

  it('跨级选择 → invalid', () => {
    // L1 尝试选择 L3 的职位
    const l3Positions = adminCfg.levels.find((l) => l.level === 3)?.positions ?? [];
    if (l3Positions.length > 0) {
      const result = validatePromotionTarget(
        l3Positions[0]!.id,
        1,
        adminCfg,
        makeCtx({ playerLevel: 1 }),
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('仅允许晋升到');
    }
  });

  it('前置条件不满足（年限不足）→ invalid', () => {
    const candidates = getPromotionCandidates(CareerLine.Administrative, 1, adminCfg);
    const target = candidates[0]!;
    const result = validatePromotionTarget(
      target.positionId,
      1,
      adminCfg,
      makeCtx({ playerLevel: 1, yearsInPosition: 0 }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('年限');
  });

  it('前置条件不满足（考核次数不足）→ invalid', () => {
    const candidates = getPromotionCandidates(CareerLine.Administrative, 1, adminCfg);
    const target = candidates[0]!;
    const result = validatePromotionTarget(
      target.positionId,
      1,
      adminCfg,
      makeCtx({ playerLevel: 1, yearsInPosition: 5, assessmentHistory: [] }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('考核');
  });

  it('已到达最高等级 → invalid', () => {
    const result = validatePromotionTarget('any_pos', 3, adminCfg, makeCtx({ playerLevel: 3 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('最高等级');
  });

  it('多候选职位不会静默固定选择第一个', () => {
    const candidates = getPromotionCandidates(CareerLine.Administrative, 1, adminCfg);
    expect(candidates.length).toBeGreaterThan(1);
    // 验证每个候选都可以被独立选择
    for (const c of candidates) {
      const result = validatePromotionTarget(
        c.positionId,
        1,
        adminCfg,
        makeCtx({ playerLevel: 1, yearsInPosition: 5 }),
      );
      expect(result.valid).toBe(true);
    }
  });
});
