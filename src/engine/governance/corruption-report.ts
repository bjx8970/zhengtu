/**
 * 腐败举报指数计算引擎
 *
 * 基于玩家 integrity、corruptionRisk 和 stability 属性
 * 动态计算腐败举报指数 (0-100)，用于驱动举报调查事件链。
 * 纯函数，所有依赖通过参数传入。
 */

/**
 * 计算腐败举报指数。
 *
 * 综合 integrity（廉洁度）、corruptionRisk（腐败风险）和 stability（稳定性）
 * 加权计算举报指数。低 integrity + 高 corruptionRisk + 低 stability 产生高指数。
 * 结果钳位在 [0, 100]，取整数。
 *
 * @param input.integrity      玩家廉洁度 (0-100)
 * @param input.corruptionRisk  玩家腐败风险 (0-100)
 * @param input.stability      玩家稳定性 (0-100)
 * @returns 腐败举报指数 (0-100 整数)
 */
export function computeCorruptionReport(input: {
  integrity: number;
  corruptionRisk: number;
  stability: number;
}): number {
  const raw =
    (100 - input.integrity) * 0.5 + input.corruptionRisk * 0.3 + (100 - input.stability) * 0.2;
  return Math.round(Math.min(100, Math.max(0, raw)));
}
