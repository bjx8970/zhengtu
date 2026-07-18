/**
 * 职位标识解析工具。
 *
 * 配置职位 ID 以数字索引结尾；异常标识不得静默回退到首个职位。
 */

/**
 * 解析职位 ID 末尾的非负整数索引。
 *
 * @param positionId 配置中的职位稳定标识
 * @returns 有效索引；格式不符合 `<prefix>_<index>` 时返回 null
 */
export function parsePositionIndex(positionId: string): number | null {
  const match = /_(\d+)$/.exec(positionId);
  const indexText = match?.[1];
  return indexText === undefined ? null : Number.parseInt(indexText, 10);
}
