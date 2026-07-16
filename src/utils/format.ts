/**
 * 显示格式化工具
 *
 * 游戏中的数值格式化为中文显示字符串。
 * 所有函数接收原始值，返回格式化后的字符串。
 */

/**
 * 金额格式化（万元）。
 *
 * @param value 金额（万元）
 * @param unit  可选单位后缀（默认"万"）
 *
 * 示例：formatCurrency(5000) → "5.0千"
 *       formatCurrency(35000) → "3.5亿"
 */
export function formatCurrency(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : '';
  if (abs >= 10000) {
    return `${prefix}${(abs / 10000).toFixed(1)}亿${unit ?? ''}`;
  }
  if (abs >= 1000) {
    return `${prefix}${(abs / 1000).toFixed(0)}千${unit ?? '万'}`;
  }
  return `${prefix}${abs.toFixed(0)}${unit ?? '万'}`;
}

/** 数字格式化（保留指定小数位数） */
export function formatNumber(value: number, decimals = 0): string {
  return value.toFixed(decimals);
}

/** 百分比格式化 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** 游戏内日期格式化 → "2024年6月15日" */
export function formatDate(year: number, month: number, day: number): string {
  return `${year}年${month}月${day}日`;
}

/** 推进粒度显示名称："按天"/"按周"/"按月" */
export function formatGranularity(granularity: string): string {
  const map: Record<string, string> = {
    day: '按天',
    week: '按周',
    month: '按月',
  };
  return map[granularity] ?? granularity;
}
