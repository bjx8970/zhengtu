/**
 * Reducer 共享工具函数（Schema 2）
 *
 * 提供各 reducer 模块共用的辅助函数。
 */

import type { PlayerSave } from '../../types/player';
import type { GameConfig } from '../../types/config';
import { clampAttr } from '../../utils/math';

/**
 * 将属性变更应用到角色状态。
 *
 * @param draft 游戏状态
 * @param attr 属性名
 * @param delta 变化量
 * @param bounds 属性边界配置
 */
export function applyPlayerAttr(
  draft: PlayerSave,
  attr: string,
  delta: number,
  bounds: GameConfig['attributeBounds'],
): void {
  const char = draft.character as unknown as Record<string, unknown>;
  const current = typeof char[attr] === 'number' ? (char[attr] as number) : 0;
  char[attr] = clampAttr(attr, current + delta, bounds);
}

/**
 * 直接设置角色属性值。
 *
 * @param draft 游戏状态
 * @param attr 属性名
 * @param value 目标值
 * @param bounds 属性边界配置
 */
export function setPlayerAttrDirect(
  draft: PlayerSave,
  attr: string,
  value: number,
  bounds: GameConfig['attributeBounds'],
): void {
  const char = draft.character as unknown as Record<string, unknown>;
  char[attr] = clampAttr(attr, value, bounds);
}

/**
 * 获取角色属性当前值。
 *
 * @param draft 游戏状态
 * @param attr 属性名
 * @returns 当前值
 */
export function getPlayerAttr(draft: PlayerSave, attr: string): number {
  const char = draft.character as unknown as Record<string, unknown>;
  return typeof char[attr] === 'number' ? (char[attr] as number) : 0;
}

/**
 * 应用理念分数变化。
 *
 * @param draft 游戏状态
 * @param key 理念键
 * @param delta 变化量
 */
export function applyStyleDelta(draft: PlayerSave, key: string, delta: number): void {
  const scores = draft.character.philosophy.scores;
  const current = scores[key] ?? 50;
  scores[key] = Math.max(0, Math.min(100, current + delta));
}
