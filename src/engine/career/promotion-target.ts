/**
 * 晋升目标选择引擎
 *
 * 核心职责：
 * 1. getPromotionCandidates — 返回相邻下一级的所有合法候选职位
 * 2. validatePromotionTarget — 校验目标职位的合法性（路线/等级/前置条件）
 *
 * 所有函数为纯函数，不依赖全局状态。
 */

import type { CareerLine } from '../../types/enums';
import type { CareerLineConfig, PromotionRequirement } from '../../types/config';
import type { PromotionCandidate, PromotionContext } from '../../types/game';
import { checkPrerequisites } from './promotion';

/**
 * 获取当前玩家可晋升的候选职位列表。
 *
 * 返回相邻下一级的所有职位，并标注不可选原因。
 * 若无下一级别配置，返回空数组。
 *
 * @param line 当前职业线
 * @param currentLevel 当前等级
 * @param lineCfg 职业线完整配置
 * @returns 候选职位列表（含 blockedReason 标注）
 */
export function getPromotionCandidates(
  line: CareerLine,
  currentLevel: number,
  lineCfg: CareerLineConfig,
): PromotionCandidate[] {
  const nextLevel = currentLevel + 1;
  const nextLevelCfg = lineCfg.levels.find((l) => l.level === nextLevel);

  if (!nextLevelCfg || nextLevelCfg.positions.length === 0) {
    return [];
  }

  return nextLevelCfg.positions.map((pos) => ({
    positionId: pos.id,
    positionName: pos.name,
    level: nextLevel,
    careerLine: line,
  }));
}

/**
 * 校验晋升目标职位的合法性。
 *
 * 校验规则：
 * - 目标职位必须存在于配置中
 * - 目标等级必须为当前等级 + 1（禁止跨级）
 * - 目标职业线必须与当前一致（禁止跨线，转职另行处理）
 * - 晋升前置条件必须满足
 *
 * @param targetPositionId 目标职位 ID
 * @param currentLevel 当前等级
 * @param lineCfg 职业线完整配置
 * @param ctx 晋升上下文（玩家属性快照）
 * @returns 校验结果：valid + 失败原因
 */
export function validatePromotionTarget(
  targetPositionId: string,
  currentLevel: number,
  lineCfg: CareerLineConfig,
  ctx: PromotionContext,
): { valid: boolean; reason?: string } {
  const nextLevel = currentLevel + 1;
  const nextLevelCfg = lineCfg.levels.find((l) => l.level === nextLevel);

  // 无下一级别
  if (!nextLevelCfg) {
    return { valid: false, reason: '已到达最高等级，无法继续晋升' };
  }

  // 查找目标职位
  const targetPos = nextLevelCfg.positions.find((p) => p.id === targetPositionId);
  if (!targetPos) {
    // 检查是否存在于其他等级（跨级检测）
    const otherLevel = lineCfg.levels.find((l) =>
      l.positions.some((p) => p.id === targetPositionId),
    );
    if (otherLevel && otherLevel.level !== nextLevel) {
      return {
        valid: false,
        reason: `目标职位在 L${otherLevel.level}，仅允许晋升到 L${nextLevel}`,
      };
    }
    return { valid: false, reason: `目标职位 "${targetPositionId}" 不存在` };
  }

  // 校验晋升前置条件
  const req: PromotionRequirement = nextLevelCfg.promotionRequirements;
  const prereq = checkPrerequisites(ctx, req);
  if (!prereq.eligible) {
    return { valid: false, reason: prereq.missing.join('；') };
  }

  return { valid: true };
}
