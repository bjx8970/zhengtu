/**
 * formatEffectLabel 单元测试
 *
 * 覆盖 KPI/player/fallback 三分支 × add/multiply/set 三路径，
 * 以及 tpl 为 null、ATTR_LABELS 未收录等边界情况。
 */
import { describe, it, expect } from 'vitest';
import { formatEffectLabel } from '../effect-labels';
import type { ActionEffectDef } from '../../types/config';

function makeEffect(overrides: Partial<ActionEffectDef> = {}): ActionEffectDef {
  return {
    target: 'dept.kpi.office_efficiency',
    operation: 'add',
    value: 5,
    ...overrides,
  };
}

describe('formatEffectLabel', () => {
  describe('dept.kpi.xxx 前缀', () => {
    it('已知 KPI → 中文名 + 数值', () => {
      const eff = makeEffect({ target: 'dept.kpi.office_efficiency', value: 5 });
      expect(formatEffectLabel(eff)).toBe('办公效率+5');
    });

    it('已知 KPI，负值', () => {
      const eff = makeEffect({ target: 'dept.kpi.office_efficiency', value: -3 });
      expect(formatEffectLabel(eff)).toBe('办公效率-3');
    });

    it('已知 KPI，零值', () => {
      const eff = makeEffect({ target: 'dept.kpi.office_efficiency', value: 0 });
      expect(formatEffectLabel(eff)).toBe('办公效率+0');
    });

    it('未知 KPI → 回退到 raw kpiId', () => {
      const eff = makeEffect({ target: 'dept.kpi.unknown_kpi_id', value: 10 });
      expect(formatEffectLabel(eff)).toBe('unknown_kpi_id+10');
    });
  });

  describe('player.xxx 前缀', () => {
    it('已知属性 → 中文名 + 数值', () => {
      const eff = makeEffect({ target: 'player.competence', value: 1 });
      expect(formatEffectLabel(eff)).toBe('才干+1');
    });

    it('已知属性，负值', () => {
      const eff = makeEffect({ target: 'player.stability', value: -2 });
      expect(formatEffectLabel(eff)).toBe('定力-2');
    });

    it('未知属性 → 回退到 raw attrKey', () => {
      const eff = makeEffect({ target: 'player.unknown_attr', value: 3 });
      expect(formatEffectLabel(eff)).toBe('unknown_attr+3');
    });
  });

  describe('无前缀', () => {
    it('无匹配前缀 → 使用 target 原文', () => {
      const eff = makeEffect({ target: 'some.other.key', value: 2 });
      expect(formatEffectLabel(eff)).toBe('some.other.key+2');
    });
  });

  describe('multiply 操作', () => {
    it('KPI 效果 ×N', () => {
      const eff = makeEffect({
        target: 'dept.kpi.project_completion',
        operation: 'multiply',
        value: 2,
      });
      expect(formatEffectLabel(eff)).toBe('项目完成度×2');
    });

    it('player 效果 ×N', () => {
      const eff = makeEffect({
        target: 'player.charisma',
        operation: 'multiply',
        value: 3,
      });
      expect(formatEffectLabel(eff)).toBe('魅力×3');
    });
  });

  describe('set 操作', () => {
    it('KPI 效果 =N', () => {
      const eff = makeEffect({
        target: 'dept.kpi.fiscal_health',
        operation: 'set',
        value: 90,
      });
      expect(formatEffectLabel(eff)).toBe('财政健康度=90');
    });

    it('player 效果 =N', () => {
      const eff = makeEffect({
        target: 'player.politicalCapital',
        operation: 'set',
        value: 0,
      });
      expect(formatEffectLabel(eff)).toBe('政治资本=0');
    });
  });

  describe('边界情况', () => {
    it('add 操作 large number', () => {
      const eff = makeEffect({ target: 'dept.kpi.gdp_growth', value: 999 });
      expect(formatEffectLabel(eff)).toBe('GDP增长率+999');
    });

    it('tpl 为 null 时 label 回退，操作 ≠ add', () => {
      const eff = makeEffect({
        target: 'dept.kpi.nonexistent',
        operation: 'multiply',
        value: 1,
      });
      expect(formatEffectLabel(eff)).toBe('nonexistent×1');
    });
  });
});
