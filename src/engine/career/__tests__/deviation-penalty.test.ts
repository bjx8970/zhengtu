import { describe, it, expect } from 'vitest';
import { calculateDeviationPenalty } from '../deviation-penalty';
import { getConfigLoader } from '../../../config/loader';

const styleConfig = getConfigLoader().getLeadershipStyleConfig();
const spectrums = styleConfig.styleSpectrums;
const penaltyCfg = styleConfig.deviationPenalty;

describe('calculateDeviationPenalty', () => {
  it('actionStyle undefined → 无偏离', () => {
    const result = calculateDeviationPenalty(
      { innovation: 80, principled: 20, pragmatic: 30 },
      undefined,
      spectrums,
      penaltyCfg,
    );
    expect(result.triggered).toBe(false);
    expect(result.effectivenessMultiplier).toBe(1);
  });

  it('actionStyle === dominant → 无偏离', () => {
    const result = calculateDeviationPenalty(
      { innovation: 80, principled: 20, pragmatic: 30 },
      'innovation',
      spectrums,
      penaltyCfg,
    );
    expect(result.triggered).toBe(false);
    expect(result.effectivenessMultiplier).toBe(1);
  });

  it('diff >= threshold → 触发偏离', () => {
    const result = calculateDeviationPenalty(
      { innovation: 80, principled: 30, pragmatic: 30 },
      'principled',
      spectrums,
      penaltyCfg,
    );
    expect(result.triggered).toBe(true);
    expect(result.effectivenessMultiplier).toBe(penaltyCfg.effectivenessMultiplier);
  });

  it('dominant >= conflictThreshold + 同光谱 → 触发冲突', () => {
    const result = calculateDeviationPenalty(
      { innovation: 85, principled: 10, pragmatic: 30 },
      'principled',
      spectrums,
      penaltyCfg,
    );
    expect(result.triggered).toBe(true);
    expect(result.styleConflictTriggered).toBe(true);
  });

  it('不在同光谱 → 不触发冲突', () => {
    const result = calculateDeviationPenalty(
      { innovation: 85, pragmatic: 30, principled: 10 },
      'pragmatic',
      spectrums,
      penaltyCfg,
    );
    expect(result.triggered).toBe(true);
    expect(result.styleConflictTriggered).toBe(false);
  });
});
