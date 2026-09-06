/**
 * Debug 状态哈希
 *
 * 为 PlayerSave 计算确定性哈希，用于 Debug Bundle 逐步校验状态一致性：
 * 录制时保存 before/after 哈希，重放时逐步比对即可定位「首个产生状态分歧的操作」。
 *
 * 确定性保证：
 * - 排除 updatedAt 等墙钟字段（reducer 中唯一的墙钟写入是 reduceNewGame 的 updatedAt）；
 * - JSON.stringify 的键序由对象构造/变更历史决定，录制与重放走完全相同的
 *   reducer 序列，键序一致，因此同一份 initialState + 同一动作序列必然得到同哈希。
 * 算法采用 cyrb53（53 位，同步、零依赖）：碰撞概率对诊断用途足够低。
 */

import type { PlayerSave } from '../types/player';

/** 需要从哈希输入中排除的墙钟字段（任意层级生效） */
const WALL_CLOCK_KEYS = new Set(['updatedAt']);

/**
 * JSON.stringify replacer：跳过墙钟字段与函数值，并防御循环引用。
 *
 * @param key 当前键名
 * @param value 当前值
 * @returns 参与序列化的值（undefined 表示跳过）
 */
function hashReplacer(this: unknown, key: string, value: unknown): unknown {
  if (WALL_CLOCK_KEYS.has(key)) return undefined;
  if (typeof value === 'function') return undefined;
  if (typeof value === 'object' && value !== null) {
    if (seenObjects.has(value as object)) return undefined;
    seenObjects.add(value as object);
  }
  return value;
}

/** 每次序列化期间记录已见对象，防御循环引用 */
let seenObjects: WeakSet<object> = new WeakSet();

/**
 * 序列化任意 JSON 数据为确定性字符串（排除墙钟字段与函数值）。
 *
 * @param value 任意可 JSON 序列化数据
 * @returns JSON 字符串（序列化失败时为空串）
 */
function serializeForHash(value: unknown): string {
  seenObjects = new WeakSet();
  return JSON.stringify(value, hashReplacer) ?? '';
}

/**
 * cyrb53 字符串哈希（bryc 实现，公有领域）。
 *
 * @param str 输入字符串
 * @param seed 种子
 * @returns 53 位哈希的十六进制字符串
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * 计算 PlayerSave 的确定性哈希（同步、零依赖）。
 *
 * @param save 游戏状态（须为 unwrap 后的纯数据对象）
 * @returns 哈希十六进制字符串（同内容同哈希；updatedAt 不影响结果）
 */
export function hashSave(save: PlayerSave): string {
  return cyrb53(serializeForHash(save));
}

/**
 * 计算任意 JSON 数据的确定性哈希（供轨迹元数据匹配等场景使用）。
 *
 * @param value 任意可 JSON 序列化数据
 * @returns 哈希十六进制字符串
 */
export function hashJsonValue(value: unknown): string {
  return cyrb53(serializeForHash(value));
}
