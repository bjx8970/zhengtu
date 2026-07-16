/**
 * 数学/随机工具函数
 *
 * 提供游戏引擎中通用的数值计算和随机选择函数。
 * 全部为纯函数，无副作用。
 */

/** 将 value 钳位在 [min, max] 范围内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 按属性名查找边界并钳位。
 *
 * @param key    属性名（对应 attributeBounds 的 key）
 * @param value  当前值
 * @param bounds 属性边界表 { attrName: [min, max] }
 */
export function clampAttr(
  key: string,
  value: number,
  bounds: Record<string, [number, number]>,
): number {
  const [min, max] = bounds[key] ?? [0, 9999];
  return clamp(value, min, max);
}

/** [min, max] 范围内均匀随机整数 */
export function weightedRandom(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 0 到 max-1 随机整数 */
export function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

/** 从数组中随机选一个元素 */
export function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[randomInt(arr.length)];
}
