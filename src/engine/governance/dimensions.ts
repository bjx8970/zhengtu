/**
 * 五维考核引擎
 *
 * 核心职责：
 * 1. 根据玩家属性快照映射德能勤绩廉五维分项得分
 * 2. 按配置权重合成综合评分
 *
 * 德（virtue）：integrity + stability + ambition
 * 能（capacity）：competence + charisma + network + stability
 * 勤（diligence）：diligence + vigor + ambition
 * 绩（achievement）：取 KPI totalScore，上限 100
 * 廉（honesty）：integrity + stability
 *
 * 纯函数，所有依赖通过参数传入。
 */

import type { FiveDimensionScore } from '../../types/game';
import type { GameConfig } from '../../types/config';

/** 玩家属性快照（计算五维所需的最小属性集合） */
interface PlayerAttrSnapshot {
  integrity: number;
  stability: number;
  ambition: number;
  competence: number;
  charisma: number;
  network: number;
  diligence: number;
  vigor: number;
}

/**
 * 计算五维分项得分。
 *
 * @param player          玩家属性快照
 * @param achievementScore KPI 综合得分（作为绩维度）
 * @param cfg             游戏配置（含五维映射权重）
 * @returns 五维分项得分
 */
export function computeFiveDimensions(
  player: PlayerAttrSnapshot,
  achievementScore: number,
  cfg: GameConfig,
): FiveDimensionScore {
  const m = cfg.fiveDimMapping;
  const virtue =
    player.integrity * (m.virtue.integrity ?? 0) +
    player.stability * (m.virtue.stability ?? 0) +
    player.ambition * (m.virtue.ambition ?? 0);
  const capacity =
    player.competence * (m.capacity.competence ?? 0) +
    player.charisma * (m.capacity.charisma ?? 0) +
    player.network * (m.capacity.network ?? 0) +
    player.stability * (m.capacity.stability ?? 0);
  const diligenceScore =
    player.diligence * (m.diligenceScore.diligence ?? 0) +
    player.vigor * (m.diligenceScore.vigor ?? 0) +
    player.ambition * (m.diligenceScore.ambition ?? 0);
  const achievement = Math.min(achievementScore, 100);
  const honesty =
    player.integrity * (m.honesty.integrity ?? 0) + player.stability * (m.honesty.stability ?? 0);
  return { virtue, capacity, diligenceScore, achievement, honesty };
}

/**
 * 将五维分项得分加权合成综合评分。
 *
 * @param dimensions 五维分项得分
 * @param cfg        游戏配置（含综合权重）
 * @returns 综合评分（0~100）
 */
export function computeComprehensiveScore(dimensions: FiveDimensionScore, cfg: GameConfig): number {
  const w = cfg.comprehensiveScoreWeights;
  return (
    dimensions.virtue * w.virtue +
    dimensions.capacity * w.capacity +
    dimensions.diligenceScore * w.diligenceScore +
    dimensions.achievement * w.achievement +
    dimensions.honesty * w.honesty
  );
}
