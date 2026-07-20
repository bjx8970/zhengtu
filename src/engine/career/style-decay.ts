/**
 * 领导风格月度衰减
 *
 * 每个推进周期对风格评分应用衰减，模拟领导风格在缺乏持续投入时逐渐回归中性的趋势。
 * 光谱成员、独立风格、未注册风格分别采用不同衰减因子。
 */

import type { LeadershipStyleConfig } from '../../types/config';

/**
 * 对风格评分应用月度衰减。
 * 光谱成员使用全局 styleDecayFactor，独立风格使用各自的 defaultDecayRate，
 * 未注册风格使用 defaultStyleDecayRate。
 *
 * @param scores 当前各风格/属性得分
 * @param config 领导风格系统配置
 * @returns 衰减后的 scores 副本（向下取整）
 */
export function decayStyleScores(
  scores: Record<string, number>,
  config: LeadershipStyleConfig,
): Record<string, number> {
  const result = { ...scores };

  const spectrumMembers = new Set<string>();
  for (const s of config.styleSpectrums) {
    for (const m of s.members) spectrumMembers.add(m);
  }

  for (const member of spectrumMembers) {
    const value = result[member];
    if (value !== undefined) {
      result[member] = Math.floor(value * config.styleDecayFactor);
    }
  }

  for (const ind of config.independentStyles) {
    const value = result[ind.id];
    if (value !== undefined) {
      result[ind.id] = Math.floor(value * ind.defaultDecayRate);
    }
  }

  const allKnown = new Set([...spectrumMembers, ...config.independentStyles.map((i) => i.id)]);
  for (const key of Object.keys(result)) {
    if (!allKnown.has(key)) {
      const value = result[key];
      if (value !== undefined) {
        result[key] = Math.floor(value * config.defaultStyleDecayRate);
      }
    }
  }

  return result;
}
