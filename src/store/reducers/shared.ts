/**
 * Reducer 共享工具函数
 *
 * 提供各 reducer 模块共用的辅助函数，包括：
 * - 属性边界钳位
 * - 风格评分修改
 * - 职位索引提取
 */

import type { PlayerSave } from '../../types/player';
import type { GameConfig } from '../../types/config';
import { getConfigLoader } from '../../config/loader';
import { normalizeAllSpectrums } from '../../engine/career/spectrum-constraint';
import { clamp, clampAttr } from '../../utils/math';

/** 可被行动修改的玩家数值属性集合（运行时从配置派生） */
let playerNumericAttrs: Set<string> | null = null;

/**
 * 获取可修改的玩家数值属性集合。
 *
 * @returns 属性名集合
 */
export function getPlayerNumericAttrs(): Set<string> {
  if (!playerNumericAttrs) {
    const cfg = getConfigLoader().getGameConfig();
    playerNumericAttrs = new Set(Object.keys(cfg.attributeBounds));
  }
  return playerNumericAttrs;
}

/**
 * 将行动效果的属性变更应用到 draft 上，含边界钳位。
 *
 * @param draft 当前状态 draft
 * @param attr 属性名（"player." 前缀已剥离）
 * @param delta 变化量
 * @param bounds 属性边界表
 */
export function applyPlayerAttr(
  draft: PlayerSave,
  attr: string,
  delta: number,
  bounds: Record<string, [number, number]>,
): void {
  if (!getPlayerNumericAttrs().has(attr)) return;
  const cur = (draft as unknown as Record<string, number>)[attr] ?? 0;
  setPlayerAttrDirect(draft, attr, cur + delta, bounds);
}

/**
 * 直接设置玩家数值属性（含边界钳位）。
 *
 * @param draft 当前状态 draft
 * @param attr 属性名
 * @param value 目标值
 * @param bounds 属性边界表
 */
export function setPlayerAttrDirect(
  draft: PlayerSave,
  attr: string,
  value: number,
  bounds: Record<string, [number, number]>,
): void {
  if (!getPlayerNumericAttrs().has(attr)) return;
  (draft as unknown as Record<string, number>)[attr] = clampAttr(attr, value, bounds);
}

/**
 * 读取玩家数值属性当前值。
 *
 * @param draft 当前状态
 * @param attr 属性名
 * @returns 属性值
 */
export function getPlayerAttr(draft: PlayerSave, attr: string): number {
  if (!getPlayerNumericAttrs().has(attr)) return 0;
  return (draft as unknown as Record<string, number>)[attr] ?? 0;
}

/**
 * 修改风格评分并自动归一化光谱约束。
 *
 * @param draft 当前状态 draft
 * @param styleId 风格 ID
 * @param delta 变化量
 */
export function applyStyleDelta(draft: PlayerSave, styleId: string, delta: number): void {
  const styleCfg = getConfigLoader().getLeadershipStyleConfig();
  const current = draft.philosophy.scores[styleId] ?? 0;
  draft.philosophy.scores[styleId] = clamp(current + delta, 0, 100);
  const normalized = normalizeAllSpectrums(draft.philosophy.scores, styleCfg.styleSpectrums);
  draft.philosophy.scores = normalized;
}

/**
 * 从 positionId（如 "admin_l3_0"）提取职位索引。
 *
 * @param positionId 职位 ID
 * @returns 职位索引
 */
export function extractPositionIndex(positionId: string): number {
  const idx = parseInt(positionId.split('_').pop() ?? '0', 10);
  return Number.isNaN(idx) ? 0 : idx;
}

/**
 * 初始化当前职位的所有部门运行时状态。
 *
 * @param draft 当前游戏状态（mutable produce draft）
 */
export function initializeDepartmentStates(draft: PlayerSave): void {
  const idx = extractPositionIndex(draft.currentPositionId);
  const pos = getConfigLoader().getPosition(draft.currentCareerLine, draft.currentLevel, idx);
  if (!pos) return;
  draft.departmentStates = {};
  for (const dept of pos.departments) {
    draft.departmentStates[dept.id] = {
      id: dept.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };
  }
}

/**
 * 获取游戏配置（缓存）。
 *
 * @returns 游戏配置
 */
export function getGameConfig(): GameConfig {
  return getConfigLoader().getGameConfig();
}
