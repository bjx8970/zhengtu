/**
 * 效果解析工具
 *
 * 提供行动效果（ActionEffectDef）的通用计算函数。
 * 与 action.ts 的区别：
 * - action.ts 负责执行流程（校验 + 解析 + 结果打包）
 * - effect.ts 负责单效果的纯数学计算（可用于多来源效果统一解析）
 */

import type { ActionEffectDef } from '../../types/config';

/**
 * 计算单个效果的变动量（处理随机范围）。
 * 返回 delta（正数增加，负数减少）。
 */
export function computeEffectDelta(effect: ActionEffectDef): number {
  if (effect.range) {
    return Math.floor(Math.random() * (effect.range.max - effect.range.min + 1)) + effect.range.min;
  }
  return effect.value;
}

/**
 * 将单个效果应用到当前值上。
 *
 * @param effect       效果定义
 * @param currentValue 目标属性的当前值
 * @returns 应用效果后的新值
 */
export function computeEffect(effect: ActionEffectDef, currentValue: number): number {
  const raw = computeEffectDelta(effect);
  switch (effect.operation) {
    case 'add':
      return currentValue + raw;
    case 'multiply':
      return currentValue * raw;
    case 'set':
      return raw;
    default:
      return currentValue;
  }
}

/**
 * 批量应用效果到一组值上。
 *
 * @param currentValues 当前值表（key → 当前值）
 * @param effects       效果列表
 * @returns 应用后的新值表（不修改输入）
 */
export function applyEffectMap(
  currentValues: Record<string, number>,
  effects: ActionEffectDef[],
): Record<string, number> {
  const result = { ...currentValues };
  for (const effect of effects) {
    const targetKey = effect.target;
    result[targetKey] = computeEffect(effect, result[targetKey] ?? 0);
  }
  return result;
}
