/**
 * 领导风格光谱约束计算
 *
 * 对风格光谱成员得分应用总和上限约束，确保各光谱内部得分之和不超过配置上限。
 * 同时提供模糊状态检测，用于触发玩家提示或事件。
 */

import type { StyleSpectrumConfig } from '../../types/config';

/**
 * 对输入 scores 应用单条光谱约束。
 * 若光谱成员值之和超过 sumCap，按比例缩减各成员值（向下取整）。
 *
 * @param scores 当前各风格/属性得分
 * @param spectrum 光谱约束配置
 * @returns 归一化后的得分副本（不修改入参）
 */
export function normalizeToSpectrum(
  scores: Record<string, number>,
  spectrum: StyleSpectrumConfig,
): Record<string, number> {
  const result = { ...scores };
  const sum = spectrum.members.reduce((acc, m) => acc + (result[m] ?? 0), 0);
  if (sum <= spectrum.sumCap) return result;
  const ratio = spectrum.sumCap / sum;
  for (const member of spectrum.members) {
    result[member] = Math.floor((result[member] ?? 0) * ratio);
  }
  return result;
}

/**
 * 对所有已注册的光谱依次应用约束。
 *
 * @param scores 当前各风格/属性得分
 * @param spectrums 光谱约束配置列表
 * @returns 逐条归一化后的得分副本（不修改入参）
 */
export function normalizeAllSpectrums(
  scores: Record<string, number>,
  spectrums: StyleSpectrumConfig[],
): Record<string, number> {
  let result = { ...scores };
  for (const spectrum of spectrums) {
    result = normalizeToSpectrum(result, spectrum);
  }
  return result;
}

/**
 * 检查光谱中是否存在"风格模糊"状态。
 * 任意两个成员差值绝对值 ≤ fuzzyThreshold 视为模糊。
 *
 * @param scores 当前各风格/属性得分
 * @param spectrum 光谱约束配置
 * @returns 是否存在至少一对模糊成员
 */
export function isFuzzyOnSpectrum(
  scores: Record<string, number>,
  spectrum: StyleSpectrumConfig,
): boolean {
  const values = spectrum.members.map((m) => scores[m] ?? 0);
  for (let i = 0; i < values.length; i++) {
    const vi = values[i] ?? 0;
    for (let j = i + 1; j < values.length; j++) {
      const vj = values[j] ?? 0;
      if (Math.abs(vi - vj) <= spectrum.fuzzyThreshold) {
        return true;
      }
    }
  }
  return false;
}
