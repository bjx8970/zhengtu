/**
 * 从政理念风格修正计算（Phase C 重构）
 *
 * @deprecated 直接使用 deviation-penalty.ts 和 spectrum-constraint.ts。
 *             此文件保留仅用于向后兼容。
 */

import { isFuzzyOnSpectrum } from './spectrum-constraint';
import { getConfigLoader } from '../../config/loader';

/**
 * 计算委员会票决的风格模糊修正值。
 * 替代原 calculateImbalancePenalty。检查玩家在光谱上是否处于"模糊"状态。
 *
 * @param styleScores 各风格评分记录
 * @returns 模糊修正因子（0~1），原行为返回绝对分（0~15）
 */
export function calculateStyleFuzzinessPenalty(styleScores: Record<string, number>): number {
  const config = getConfigLoader().getLeadershipStyleConfig();
  for (const spectrum of config.styleSpectrums) {
    if (isFuzzyOnSpectrum(styleScores, spectrum)) {
      return Math.abs(spectrum.fuzzyPenalty);
    }
  }
  return 0;
}

/**
 * @deprecated 使用 calculateStyleFuzzinessPenalty 替代。
 */
export function calculateImbalancePenalty(_styleScores: Record<string, number>): number {
  return 0;
}
