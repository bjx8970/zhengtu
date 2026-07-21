/**
 * 启动存档状态服务
 *
 * 管理启动时的存档加载结果，解除 SplashPage 对 main.tsx 的循环依赖。
 * 支持在 NEW_GAME 后失效启动快照，使启动页从 Store 状态派生显示。
 */

import type { PlayerSave } from '../types/player';

/** 本地存档加载结果（区分不同错误类别） */
export type LocalSaveLoadResult =
  | { status: 'loaded'; state: PlayerSave }
  | { status: 'empty' }
  | { status: 'legacy'; detail: string; backupKey?: string }
  | { status: 'future'; detail: string; backupKey?: string }
  | { status: 'corrupted'; detail: string; backupKey?: string };

/** 当前启动存档状态 */
let currentResult: LocalSaveLoadResult = { status: 'empty' };

/** 是否已被 NEW_GAME 失效 */
let invalidated = false;

/**
 * 设置启动时的存档加载结果（仅 main.tsx 启动时调用一次）。
 *
 * @param result 加载结果
 */
export function setStartupSaveResult(result: LocalSaveLoadResult): void {
  currentResult = result;
  invalidated = false;
}

/**
 * 获取当前启动存档状态。
 *
 * 若已被 NEW_GAME 失效，返回 'empty'（表示应从 Store 派生状态）。
 *
 * @returns 当前加载结果
 */
export function getStartupSaveResult(): LocalSaveLoadResult {
  if (invalidated) return { status: 'empty' };
  return currentResult;
}

/**
 * 失效启动快照（NEW_GAME 后调用）。
 *
 * 调用后启动页不再显示旧的不兼容提示或过期存档信息。
 */
export function invalidateStartupSave(): void {
  invalidated = true;
}

/** 强制新建游戏标记（用于绕过 CharacterCreation 的已有角色保护） */
let forceNewGameFlag = false;

/**
 * 设置强制新建标记（点击“重新建档”时调用）。
 */
export function setForceNewGame(value: boolean): void {
  forceNewGameFlag = value;
}

/**
 * 检查并消费强制新建标记。
 *
 * @returns 是否处于强制新建模式
 */
export function consumeForceNewGame(): boolean {
  const val = forceNewGameFlag;
  forceNewGameFlag = false;
  return val;
}
