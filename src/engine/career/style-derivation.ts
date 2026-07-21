/**
 * 领导风格派生引擎 — 从年度行动记录计算风格评分增量
 *
 * 核心职责：
 * 1. deriveStyleDeltas — 统计全年行动的风格倾向，按比例分配年度增益
 * 2. collectAllStyleIds — 从 LeadershipStyleConfig 收集所有已注册的风格 ID
 *
 * 所有函数为纯函数，不依赖任何外部状态。
 */

import type { AnnualActionRecord } from '../../types/game';

/**
 * 根据全年行动记录计算风格评分年度增量。
 *
 * 统计全年各风格倾向的行动数 → 按比例分配 baseGain × 总行动数 给各风格。
 *
 * @param annualActions 全年行动记录（含风格倾向标注）
 * @param knownStyleIds 所有已知风格 ID 列表
 * @param baseGain 每个有风格倾向行动的基础增益点数（默认 2）
 * @returns 各风格 ID → 年度增量的映射
 */
export function deriveStyleDeltas(
  annualActions: AnnualActionRecord[],
  knownStyleIds: string[],
  baseGain = 2,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const id of knownStyleIds) {
    deltas[id] = 0;
  }

  const styledActions = annualActions.filter((a) => a.styleAlignment);
  if (styledActions.length === 0) return deltas;

  const styleCounts: Record<string, number> = {};
  for (const action of styledActions) {
    const style = action.styleAlignment!;
    styleCounts[style] = (styleCounts[style] ?? 0) + 1;
  }

  const totalBase = baseGain * styledActions.length;
  for (const [style, count] of Object.entries(styleCounts)) {
    deltas[style] = Math.round((count / styledActions.length) * totalBase);
  }

  return deltas;
}

/**
 * 收集所有已注册风格 ID（从 LeadershipStyleConfig 派生）。
 *
 * @param config 领导风格配置，含 styleSpectrums 和 independentStyles
 * @returns 去重后的所有风格 ID 列表
 */
export function collectAllStyleIds(config: {
  styleSpectrums: { members: string[] }[];
  independentStyles: { id: string }[];
}): string[] {
  const ids = new Set<string>();
  for (const s of config.styleSpectrums) {
    for (const m of s.members) ids.add(m);
  }
  for (const s of config.independentStyles) {
    ids.add(s.id);
  }
  return Array.from(ids);
}
