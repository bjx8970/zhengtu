/**
 * 从政理念风格失衡修正计算
 *
 * 基于三种风格评分差异计算民主推荐和常委会票决中的负向影响。
 * 风格差距越大，说明干部发展不均衡，组织内接受度越低。
 * Phase 3 待扩展为完整的风格联动计算。
 */

/**
 * 从风格评分差异计算失衡修正值。
 *
 * 规则：最高分与次高分差距越大，风格越单一，修正越高。
 *
 * @param styleScores 各风格评分记录
 * @returns 修正分（0~15）
 */
export function calculateImbalancePenalty(styleScores: Record<string, number>): number {
  const scores = Object.values(styleScores).filter((v) => v > 0);
  if (scores.length <= 1) return 0;

  const sorted = [...scores].sort((a, b) => b - a);
  const max = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;

  return Math.round(((max - second) / 100) * 15);
}
