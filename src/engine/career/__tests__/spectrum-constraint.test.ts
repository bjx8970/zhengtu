import { describe, it, expect } from 'vitest';
import {
  normalizeToSpectrum,
  normalizeAllSpectrums,
  isFuzzyOnSpectrum,
} from '../spectrum-constraint';
import { getConfigLoader } from '../../../config/loader';
import type { StyleSpectrumConfig } from '../../../types/config';

const spectrums = getConfigLoader().getLeadershipStyleConfig().styleSpectrums;
const innovationPrincipled: StyleSpectrumConfig = spectrums[0]!;

describe('normalizeToSpectrum', () => {
  it('sum <= cap → 无变化', () => {
    const scores = { innovation: 30, principled: 20 };
    const result = normalizeToSpectrum(scores, innovationPrincipled);
    expect(result.innovation).toBe(30);
    expect(result.principled).toBe(20);
  });

  it('sum > cap → 等比例缩减', () => {
    const scores = { innovation: 80, principled: 50 };
    const result = normalizeToSpectrum(scores, innovationPrincipled);
    expect(result.innovation! + result.principled!).toBeLessThanOrEqual(
      innovationPrincipled.sumCap,
    );
  });

  it('非成员不受影响', () => {
    const scores = { innovation: 80, principled: 50, pragmatic: 70 };
    const result = normalizeToSpectrum(scores, innovationPrincipled);
    expect(result.pragmatic).toBe(70);
  });
});

describe('normalizeAllSpectrums', () => {
  it('多光谱依次约束', () => {
    const scores = { innovation: 80, principled: 50, pragmatic: 70 };
    const result = normalizeAllSpectrums(scores, spectrums);
    expect(result.innovation! + result.principled!).toBeLessThanOrEqual(
      innovationPrincipled.sumCap,
    );
  });
});

describe('isFuzzyOnSpectrum', () => {
  it('差值 ≤ threshold → true', () => {
    expect(isFuzzyOnSpectrum({ innovation: 45, principled: 50 }, innovationPrincipled)).toBe(true);
  });

  it('差值 > threshold → false', () => {
    expect(isFuzzyOnSpectrum({ innovation: 80, principled: 40 }, innovationPrincipled)).toBe(false);
  });

  it('只有两个成员 → 正确比较', () => {
    expect(isFuzzyOnSpectrum({ innovation: 55, principled: 55 }, innovationPrincipled)).toBe(true);
  });
});
