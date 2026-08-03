/**
 * 月度防汛风险指标计算引擎
 *
 * 根据当前月份是否属于雨季，每月累加或衰减防汛风险指标。
 * 纯函数，所有依赖通过参数传入。
 */

/**
 * 计算月度防汛风险变化。
 *
 * 雨季月份（rainyMonths）内 metric 累加 monthlyRise，
 * 非雨季月份内 metric 衰减 monthlyFall。
 * 结果始终钳位在 [0, 100] 范围内。
 *
 * @param current      当前 flood_risk 值
 * @param endedMonth   刚结束的月份 (1-12)
 * @param rainyMonths  雨季月份列表
 * @param monthlyRise  雨季每月上升幅度
 * @param monthlyFall  非雨季每月衰减幅度
 * @returns 包含 metricId、previous 和 next 的结算结果
 */
export function computeFloodRiskMonthDelta(
  current: number,
  endedMonth: number,
  rainyMonths: readonly number[],
  monthlyRise: number,
  monthlyFall: number,
): { metricId: 'flood_risk'; previous: number; next: number } {
  const isRainy = rainyMonths.includes(endedMonth);
  const rawNext = isRainy ? current + monthlyRise : current - monthlyFall;
  const next = Math.min(100, Math.max(0, rawNext));
  return { metricId: 'flood_risk', previous: current, next };
}
