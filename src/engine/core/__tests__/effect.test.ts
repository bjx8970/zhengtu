/**
 * 效果引擎单元测试
 *
 * 覆盖 computeEffectDelta / computeEffect / applyEffectMap 三个导出函数，
 * 包含固定值、随机范围、operation 类型、批量应用、边角情况等场景。
 */

import { describe, it, expect } from 'vitest';
import { computeEffectDelta, computeEffect, applyEffectMap } from '../effect';
import type { ActionEffectDef } from '../../../types/config';

describe('computeEffectDelta', () => {
  describe('normal path', () => {
    it('返回固定值', () => {
      const effect: ActionEffectDef = { target: 'player.competence', operation: 'add', value: 5 };
      expect(computeEffectDelta(effect)).toBe(5);
    });

    it('随机范围值在区间内', () => {
      const effect: ActionEffectDef = {
        target: 'player.competence',
        operation: 'add',
        value: 0,
        range: { min: 1, max: 3 },
      };
      const result = computeEffectDelta(effect);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(3);
    });
  });

  describe('edge cases', () => {
    it('负值范围也在区间内', () => {
      const effect: ActionEffectDef = {
        target: 'player.integrity',
        operation: 'add',
        value: 0,
        range: { min: -10, max: -1 },
      };
      const result = computeEffectDelta(effect);
      expect(result).toBeGreaterThanOrEqual(-10);
      expect(result).toBeLessThanOrEqual(-1);
    });
  });
});

describe('computeEffect', () => {
  describe('normal path', () => {
    it('add 操作累加数值', () => {
      const effect: ActionEffectDef = { target: 'player.competence', operation: 'add', value: 5 };
      expect(computeEffect(effect, 10)).toBe(15);
    });

    it('multiply 操作翻倍数值', () => {
      const effect: ActionEffectDef = {
        target: 'player.performance',
        operation: 'multiply',
        value: 2,
      };
      expect(computeEffect(effect, 10)).toBe(20);
    });

    it('set 操作直接赋值', () => {
      const effect: ActionEffectDef = { target: 'player.integrity', operation: 'set', value: 7 };
      expect(computeEffect(effect, 10)).toBe(7);
    });
  });

  describe('edge cases', () => {
    it('未知 operation 返回原值', () => {
      const effect = {
        target: 'player.stability',
        operation: 'unknown' as ActionEffectDef['operation'],
        value: 5,
      };
      expect(computeEffect(effect, 10)).toBe(10);
    });

    it('负值 add 正确减少', () => {
      const effect: ActionEffectDef = { target: 'player.integrity', operation: 'add', value: -3 };
      expect(computeEffect(effect, 10)).toBe(7);
    });
  });
});

describe('applyEffectMap', () => {
  describe('normal path', () => {
    it('批量应用多个效果到不同目标', () => {
      const effects: ActionEffectDef[] = [
        { target: 'a', operation: 'add', value: 5 },
        { target: 'b', operation: 'multiply', value: 2 },
      ];
      const result = applyEffectMap({ a: 10, b: 3 }, effects);
      expect(result).toEqual({ a: 15, b: 6 });
    });
  });

  describe('edge cases', () => {
    it('空效果列表返回输入副本', () => {
      const values = { a: 10, b: 20 };
      const result = applyEffectMap(values, []);
      expect(result).toEqual(values);
    });

    it('空初始值表时创建新 key', () => {
      const effects: ActionEffectDef[] = [{ target: 'a', operation: 'add', value: 5 }];
      const result = applyEffectMap({}, effects);
      expect(result).toEqual({ a: 5 });
    });

    it('target 在 currentValues 中不存在时从 0 开始', () => {
      const effects: ActionEffectDef[] = [{ target: 'x', operation: 'add', value: 3 }];
      const result = applyEffectMap({ a: 10 }, effects);
      expect(result).toEqual({ a: 10, x: 3 });
    });

    it('不修改输入对象', () => {
      const values = { a: 10 };
      const effects: ActionEffectDef[] = [{ target: 'a', operation: 'add', value: 5 }];
      applyEffectMap(values, effects);
      expect(values).toEqual({ a: 10 });
    });
  });
});
