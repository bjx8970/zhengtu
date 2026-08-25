/**
 * Phase 4 初始干部配置加载与防御性复制测试。
 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../loader';

describe('ConfigLoader organization config', () => {
  const loader = getConfigLoader();

  it('加载有限、引用完整且身份唯一的 NPC 模板', () => {
    const cadres = loader.getCadreTemplates();
    const positions = new Set(loader.getAllPositions().map((position) => position.id));

    expect(cadres).toHaveLength(9);
    expect(new Set(cadres.map((cadre) => cadre.cadreId)).size).toBe(cadres.length);
    expect(cadres.every((cadre) => positions.has(cadre.positionId))).toBe(true);
  });

  it('返回值不会污染单例配置', () => {
    const cadres = loader.getCadreTemplates();
    const first = cadres[0];
    if (!first) throw new Error('Expected initial cadre template');
    first.name = '被修改';
    first.specialties['injected'] = 100;

    expect(loader.getCadreTemplates()[0]).not.toMatchObject({
      name: '被修改',
      specialties: { injected: 100 },
    });
  });
});
