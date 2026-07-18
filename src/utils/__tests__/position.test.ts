/**
 * 职位标识解析测试。
 */

import { describe, expect, it } from 'vitest';
import { parsePositionIndex } from '../position';

describe('parsePositionIndex', () => {
  it('解析配置职位 ID 的尾部索引', () => {
    expect(parsePositionIndex('admin_l3_0')).toBe(0);
    expect(parsePositionIndex('admin_l3_12')).toBe(12);
  });

  it.each(['', 'admin_l3', 'admin_l3_invalid', 'admin_l3_-1'])('拒绝异常标识 %s', (id) => {
    expect(parsePositionIndex(id)).toBeNull();
  });
});
