/** 条件解释器复用的序数与数值比较。 */

/**
 * 比较两个序数。
 *
 * @param actualIndex 实际序数
 * @param targetIndex 目标序数
 * @param op 比较操作符
 * @returns 是否满足比较
 */
export function compareOrdinal(actualIndex: number, targetIndex: number, op: string): boolean {
  return compareNumber(actualIndex, targetIndex, op);
}

/**
 * 比较两个数值。
 *
 * @param actual 实际值
 * @param target 目标值
 * @param op 比较操作符
 * @returns 是否满足比较
 */
export function compareNumber(actual: number, target: number, op: string): boolean {
  switch (op) {
    case 'eq':
      return actual === target;
    case 'neq':
      return actual !== target;
    case 'gt':
      return actual > target;
    case 'gte':
      return actual >= target;
    case 'lt':
      return actual < target;
    case 'lte':
      return actual <= target;
    default:
      return false;
  }
}
