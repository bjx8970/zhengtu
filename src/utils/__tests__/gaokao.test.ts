import { describe, it, expect } from 'vitest';
import { generateGaokaoScore, determineTier, getAvailableTiers } from '../gaokao';
import type { ProvinceConfig } from '../../types/config';

function makeProvince(overrides?: Partial<ProvinceConfig>): ProvinceConfig {
  return {
    name: '测试省',
    type: 'province',
    scoreDistribution: { mean: 450, stddev: 80, minScore: 200, maxScore: 750 },
    gaokaoThresholds: { 985: 620, 211: 550, 本科: 430, 专科: 200 },
    ethnicBonus: 0,
    hasPreparatoryProgram: false,
    cities: ['城市A'],
    ...overrides,
  };
}

describe('generateGaokaoScore', () => {
  it('生成分数在 min~max 范围内', () => {
    const p = makeProvince();
    for (let i = 0; i < 20; i++) {
      const r = generateGaokaoScore(p);
      expect(r.rawScore).toBeGreaterThanOrEqual(p.scoreDistribution.minScore);
      expect(r.rawScore).toBeLessThanOrEqual(p.scoreDistribution.maxScore);
    }
  });

  it('高分参数 → 985档', () => {
    const p = makeProvince({
      scoreDistribution: { mean: 700, stddev: 10, minScore: 200, maxScore: 750 },
    });
    const r = generateGaokaoScore(p);
    expect(r.tier).toBe('985');
  });

  it('低分参数 → 专科档', () => {
    const p = makeProvince({
      scoreDistribution: { mean: 220, stddev: 10, minScore: 200, maxScore: 750 },
    });
    const r = generateGaokaoScore(p);
    expect(r.tier).toBe('专科');
  });

  it('含民族加分时 effectiveScore > rawScore', () => {
    const p = makeProvince({ ethnicBonus: 20 });
    const r = generateGaokaoScore(p);
    expect(r.effectiveScore).toBe(r.rawScore + 20);
    expect(r.ethnicBonus).toBe(20);
  });

  it('预科班省份标记 canPreparatory', () => {
    const p = makeProvince({ hasPreparatoryProgram: true });
    const r = generateGaokaoScore(p);
    expect(r.canPreparatory).toBe(true);
  });

  it('非预科班省份 canPreparatory 为 false', () => {
    const r = generateGaokaoScore(makeProvince());
    expect(r.canPreparatory).toBe(false);
  });
});

describe('determineTier', () => {
  it('高分判定为 985', () => {
    const p = makeProvince();
    const r = determineTier(650, 650, 0, p);
    expect(r.tier).toBe('985');
    expect(r.tierThreshold).toBe(620);
  });

  it('边界分刚好等于线', () => {
    const p = makeProvince();
    const r = determineTier(620, 620, 0, p);
    expect(r.tier).toBe('985');
  });

  it('中等分判定为 211', () => {
    const p = makeProvince();
    const r = determineTier(580, 580, 0, p);
    expect(r.tier).toBe('211');
  });

  it('本科线边缘', () => {
    const p = makeProvince();
    const r = determineTier(430, 430, 0, p);
    expect(r.tier).toBe('本科');
  });

  it('低分判定为专科', () => {
    const p = makeProvince();
    const r = determineTier(210, 210, 0, p);
    expect(r.tier).toBe('专科');
  });

  it('民族加分可提升档次', () => {
    const p = makeProvince();
    const r = determineTier(540, 570, 30, p);
    expect(r.tier).toBe('211');
    expect(r.rawScore).toBe(540);
    expect(r.effectiveScore).toBe(570);
  });

  it('返回完整分数线表', () => {
    const p = makeProvince();
    const r = determineTier(600, 600, 0, p);
    expect(r.thresholds['985']).toBe(620);
    expect(r.thresholds['211']).toBe(550);
    expect(r.thresholds['本科']).toBe(430);
    expect(r.thresholds['专科']).toBe(200);
  });
});

describe('getAvailableTiers', () => {
  it('985分可选所有档次', () => {
    const tiers = getAvailableTiers('985');
    expect(tiers).toEqual(['985', '211', '本科', '专科', '预科']);
  });

  it('本科分不可向上选', () => {
    const tiers = getAvailableTiers('本科');
    expect(tiers).toEqual(['本科', '专科', '预科']);
    expect(tiers).not.toContain('985');
    expect(tiers).not.toContain('211');
  });

  it('专科分仅可选专科和预科', () => {
    const tiers = getAvailableTiers('专科');
    expect(tiers).toEqual(['专科', '预科']);
  });

  it('未知档次返回空数组', () => {
    const tiers = getAvailableTiers('unknown');
    expect(tiers).toEqual([]);
  });
});
