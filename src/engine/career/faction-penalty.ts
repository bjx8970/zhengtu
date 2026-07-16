/**
 * 派系惩罚计算 — 共享工具函数
 *
 * 基于各派系声望差异计算民主推荐和常委会票决中的负向影响。
 * 当前为简化实现：使用最高与次高声望差值折算惩罚分。
 * Phase 3 待扩展为完整的派系博弈计算。
 */

/**
 * 从派系声望差异计算惩罚值。
 *
 * 规则：max 与 second 声望差值越大，派系对立越强，惩罚越高。
 *
 * @param factionReputation 各派系声望记录
 * @returns 惩罚分（0~15）
 */
export function calculateFactionPenalty(factionReputation: Record<string, number>): number {
  const reputations = Object.values(factionReputation).filter((v) => v > 0);
  if (reputations.length <= 1) return 0;

  const sorted = [...reputations].sort((a, b) => b - a);
  const max = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;

  return Math.round(((max - second) / 100) * 15);
}
