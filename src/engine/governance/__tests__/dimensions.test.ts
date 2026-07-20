import { describe, it, expect } from 'vitest';
import { computeFiveDimensions, computeComprehensiveScore } from '../dimensions';
import { getConfigLoader } from '../../../config/loader';
import type { FiveDimensionScore } from '../../../types/game';

const cfg = getConfigLoader().getGameConfig();

describe('computeFiveDimensions', () => {
  const maxPlayer = {
    integrity: 100,
    stability: 100,
    ambition: 100,
    competence: 100,
    charisma: 100,
    network: 100,
    diligence: 100,
    vigor: 100,
  };

  it('全满属性 + KPI 满分 → 五维全 100', () => {
    const result = computeFiveDimensions(maxPlayer, 100, cfg);
    expect(result.virtue).toBeCloseTo(100);
    expect(result.capacity).toBeCloseTo(100);
    expect(result.diligenceScore).toBeCloseTo(100);
    expect(result.achievement).toBe(100);
    expect(result.honesty).toBeCloseTo(100);
  });

  it('KPI 超过 100 时 achievement 被 clamp', () => {
    const result = computeFiveDimensions(maxPlayer, 150, cfg);
    expect(result.achievement).toBe(100);
  });

  it('全部属性为 0 → 全 0', () => {
    const zero = {
      integrity: 0,
      stability: 0,
      ambition: 0,
      competence: 0,
      charisma: 0,
      network: 0,
      diligence: 0,
      vigor: 0,
    };
    const result = computeFiveDimensions(zero, 0, cfg);
    expect(result.virtue).toBe(0);
    expect(result.capacity).toBe(0);
    expect(result.diligenceScore).toBe(0);
    expect(result.achievement).toBe(0);
    expect(result.honesty).toBe(0);
  });

  it('德维度加权计算', () => {
    const player = { ...maxPlayer, integrity: 80, stability: 60, ambition: 50 };
    const result = computeFiveDimensions(player, 100, cfg);
    expect(result.virtue).toBeCloseTo(80 * 0.4 + 60 * 0.3 + 50 * 0.3);
  });

  it('能维度加权计算', () => {
    const player = { ...maxPlayer, competence: 80, charisma: 70, network: 60, stability: 50 };
    const result = computeFiveDimensions(player, 100, cfg);
    expect(result.capacity).toBeCloseTo(80 * 0.5 + 70 * 0.2 + 60 * 0.2 + 50 * 0.1);
  });

  it('勤维度加权计算', () => {
    const player = { ...maxPlayer, diligence: 90, vigor: 80, ambition: 70 };
    const result = computeFiveDimensions(player, 100, cfg);
    expect(result.diligenceScore).toBeCloseTo(90 * 0.5 + 80 * 0.3 + 70 * 0.2);
  });

  it('廉维度加权计算', () => {
    const player = { ...maxPlayer, integrity: 90, stability: 80 };
    const result = computeFiveDimensions(player, 100, cfg);
    expect(result.honesty).toBeCloseTo(90 * 0.6 + 80 * 0.4);
  });

  it('KPI=50 → achievement=50', () => {
    const result = computeFiveDimensions(maxPlayer, 50, cfg);
    expect(result.achievement).toBe(50);
  });
});

describe('computeComprehensiveScore', () => {
  it('全 100 → 综合分 100', () => {
    const dims: FiveDimensionScore = {
      virtue: 100,
      capacity: 100,
      diligenceScore: 100,
      achievement: 100,
      honesty: 100,
    };
    expect(computeComprehensiveScore(dims, cfg)).toBeCloseTo(100);
  });

  it('全 0 → 0', () => {
    const dims: FiveDimensionScore = {
      virtue: 0,
      capacity: 0,
      diligenceScore: 0,
      achievement: 0,
      honesty: 0,
    };
    expect(computeComprehensiveScore(dims, cfg)).toBe(0);
  });

  it('混合值验证加权', () => {
    const dims: FiveDimensionScore = {
      virtue: 80,
      capacity: 70,
      diligenceScore: 90,
      achievement: 60,
      honesty: 85,
    };
    const expected = 80 * 0.15 + 70 * 0.2 + 90 * 0.15 + 60 * 0.3 + 85 * 0.2;
    expect(computeComprehensiveScore(dims, cfg)).toBeCloseTo(expected);
  });
});
