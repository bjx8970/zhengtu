import { describe, it, expect } from 'vitest';
import { deriveStyleDeltas, collectAllStyleIds } from '../style-derivation';
import { getConfigLoader } from '../../../config/loader';

const styleConfig = getConfigLoader().getLeadershipStyleConfig();

describe('deriveStyleDeltas', () => {
  it('无 styled action → 全零', () => {
    const deltas = deriveStyleDeltas(
      [{ actionName: '调研考察' }, { actionName: '预算审批' }],
      ['innovation', 'principled', 'pragmatic'],
    );
    expect(deltas.innovation).toBe(0);
    expect(deltas.principled).toBe(0);
    expect(deltas.pragmatic).toBe(0);
  });

  it('单一风格 → 全增量', () => {
    const deltas = deriveStyleDeltas(
      [
        { actionName: 'A', styleAlignment: 'innovation' },
        { actionName: 'B', styleAlignment: 'innovation' },
      ],
      ['innovation', 'principled', 'pragmatic'],
    );
    expect(deltas.innovation).toBeGreaterThan(0);
    expect(deltas.principled).toBe(0);
  });

  it('两种风格均分 → 各半', () => {
    const deltas = deriveStyleDeltas(
      [
        { actionName: 'A', styleAlignment: 'innovation' },
        { actionName: 'B', styleAlignment: 'principled' },
      ],
      ['innovation', 'principled', 'pragmatic'],
    );
    expect(deltas.innovation).toBeGreaterThan(0);
    expect(deltas.principled).toBeGreaterThan(0);
  });
});

describe('collectAllStyleIds', () => {
  it('正确合并光谱+独立', () => {
    const ids = collectAllStyleIds(styleConfig);
    expect(ids).toContain('innovation');
    expect(ids).toContain('principled');
    expect(ids).toContain('pragmatic');
  });
});
