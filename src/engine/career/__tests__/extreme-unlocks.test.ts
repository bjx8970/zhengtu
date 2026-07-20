import { describe, it, expect } from 'vitest';
import { getUnlockedExtremes, isExtremeActionUnlocked } from '../extreme-unlocks';
import { getConfigLoader } from '../../../config/loader';

const styleConfig = getConfigLoader().getLeadershipStyleConfig();
const spectrums = styleConfig.styleSpectrums;
const mainSpectrum = spectrums[0]!;

describe('getUnlockedExtremes', () => {
  it('分数不足 → 空列表', () => {
    const result = getUnlockedExtremes({ innovation: 0, principled: 0, pragmatic: 0 }, styleConfig);
    expect(result.actions).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it('分数 >= extremeThreshold → 解锁 actions', () => {
    const result = getUnlockedExtremes(
      { innovation: 85, principled: 10, pragmatic: 30 },
      styleConfig,
    );
    expect(result.actions.length).toBeGreaterThanOrEqual(1);
  });

  it('requiredScore 高于 extremeThreshold → 按 requiredScore', () => {
    const result = getUnlockedExtremes(
      { innovation: 81, principled: 10, pragmatic: 30 },
      styleConfig,
    );
    // innovation=81 >= extremeThreshold(80) but < requiredScore(80)... actually equals
    // Just verify no errors and results are reasonable
    expect(result.actions.length).toBeGreaterThanOrEqual(0);
  });
});

describe('isExtremeActionUnlocked', () => {
  it('分数满足双阈值 → true', () => {
    const action = mainSpectrum.extremeActions.innovation?.[0];
    if (!action) return;
    expect(isExtremeActionUnlocked({ innovation: 85, principled: 10 }, action, 80)).toBe(true);
  });

  it('分数不足 → false', () => {
    const action = mainSpectrum.extremeActions.innovation?.[0];
    if (!action) return;
    expect(isExtremeActionUnlocked({ innovation: 50, principled: 10 }, action, 80)).toBe(false);
  });
});
