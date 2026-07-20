/**
 * 领导风格偏离惩罚计算
 *
 * 当玩家执行与主导风格差异过大的行动时，效果打折扣。
 * 若差距足够大且两风格在同一光谱中对立，触发额外冲突事件。
 */

import type {
  DeviationPenaltyConfig,
  StyleSpectrumConfig,
  DeviationResult,
} from '../../types/config';

/**
 * 计算执行某个风格行动时的偏离惩罚。
 *
 * 规则：
 * 1. 找到玩家最高分风格（dominant style）
 * 2. 若 action.styleAlignment 与 dominant style 分差 ≥ minStyleDiffForOpposition → 触发偏离
 * 3. 偏离时行动效果 × effectivenessMultiplier
 * 4. 若 dominant ≥ styleConflictThreshold 且两个风格在同一光谱中 → 触发冲突事件
 *
 * @param scores 当前所有风格评分
 * @param actionStyle 行动的 styleAlignment（可 undefined）
 * @param allSpectrums 所有光谱配置
 * @param penaltyCfg 偏离惩罚配置
 * @returns 偏离惩罚计算结果
 */
export function calculateDeviationPenalty(
  scores: Record<string, number>,
  actionStyle: string | undefined,
  allSpectrums: StyleSpectrumConfig[],
  penaltyCfg: DeviationPenaltyConfig,
): DeviationResult {
  if (!actionStyle) {
    return { triggered: false, effectivenessMultiplier: 1, styleConflictTriggered: false };
  }

  const dominant = findDominantStyle(scores);
  if (!dominant || dominant === actionStyle) {
    return { triggered: false, effectivenessMultiplier: 1, styleConflictTriggered: false };
  }

  const dominantScore = scores[dominant] ?? 0;
  const actionScore = scores[actionStyle] ?? 0;
  const diff = dominantScore - actionScore;
  const triggered = diff >= penaltyCfg.minStyleDiffForOpposition;

  const styleConflictTriggered =
    triggered &&
    dominantScore >= penaltyCfg.styleConflictThreshold &&
    areOpposingStyles(dominant, actionStyle, allSpectrums);

  return {
    triggered,
    effectivenessMultiplier: triggered ? penaltyCfg.effectivenessMultiplier : 1,
    styleConflictTriggered,
  };
}

/**
 * 找到评分最高的风格 ID。
 *
 * @param scores 风格评分记录
 * @returns 最高分风格 ID，若所有评分均 <= 0 则返回 null
 */
function findDominantStyle(scores: Record<string, number>): string | null {
  let maxScore = -1;
  let dominant: string | null = null;
  for (const [id, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      dominant = id;
    }
  }
  return dominant;
}

/**
 * 判定两个风格是否在同一光谱中（即存在对立关系）。
 *
 * @param styleA 风格 A 的 ID
 * @param styleB 风格 B 的 ID
 * @param spectrums 所有光谱配置
 * @returns 是否存在同一光谱中
 */
function areOpposingStyles(
  styleA: string,
  styleB: string,
  spectrums: StyleSpectrumConfig[],
): boolean {
  return spectrums.some((s) => s.members.includes(styleA) && s.members.includes(styleB));
}
