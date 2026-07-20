import { describe, it, expect } from 'vitest';
import { decayStyleScores } from '../style-decay';
import { getConfigLoader } from '../../../config/loader';

const styleConfig = getConfigLoader().getLeadershipStyleConfig();

describe('decayStyleScores', () => {
  it('光谱成员按全局 factor 衰减', () => {
    const scores = { innovation: 100, principled: 50, pragmatic: 50 };
    const result = decayStyleScores(scores, styleConfig);
    expect(result.innovation).toBeLessThan(100);
    expect(result.principled).toBeLessThan(50);
  });

  it('独立风格按各自 rate 衰减', () => {
    const scores = { pragmatic: 100 };
    const result = decayStyleScores(scores, styleConfig);
    expect(result.pragmatic).toBeLessThan(100);
  });

  it('未注册用 default', () => {
    const scores: Record<string, number> = { unknown_style: 80 };
    const result = decayStyleScores(scores, styleConfig);
    // 即使未注册也会被衰减，验证无报错
    expect(result.unknown_style).toBeLessThan(80);
  });
});
