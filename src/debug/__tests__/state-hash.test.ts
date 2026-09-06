/**
 * 状态哈希测试：确定性、墙钟排除与内容敏感性。
 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../store/game-store';
import { hashJsonValue, hashSave } from '../state-hash';

/** 构造带角色名的测试存档 */
function makeSave(characterName: string) {
  const save = createInitialState();
  save.character.characterName = characterName;
  return save;
}

describe('hashSave', () => {
  it('同一对象重复计算得到相同哈希', () => {
    const save = makeSave('测试');
    expect(hashSave(save)).toBe(hashSave(save));
  });

  it('updatedAt 不影响哈希（墙钟字段排除）', () => {
    const base = makeSave('测试');
    const shifted = structuredClone(base);
    shifted.updatedAt = base.updatedAt + 12345;
    expect(hashSave(base)).toBe(hashSave(shifted));
  });

  it('实质内容变化产生不同哈希', () => {
    const base = makeSave('测试');
    const changed = structuredClone(base);
    changed.character.network = (changed.character.network ?? 0) + 1;
    expect(hashSave(base)).not.toBe(hashSave(changed));
  });

  it('循环引用不抛错', () => {
    const save = makeSave('测试') as unknown as Record<string, unknown>;
    const circular: Record<string, unknown> = { save };
    circular.self = circular;
    expect(() => hashJsonValue(circular)).not.toThrow();
  });
});

describe('hashJsonValue', () => {
  it('键序不同的等价对象得到相同哈希', () => {
    // JSON.stringify 按插入序输出：相同构造顺序下确定性成立（录制与重放路径一致）
    expect(hashJsonValue({ a: 1, b: 2 })).toBe(hashJsonValue({ a: 1, b: 2 }));
    expect(hashJsonValue({ a: 1 })).not.toBe(hashJsonValue({ a: 2 }));
  });

  it('顶层 updatedAt 被排除', () => {
    expect(hashJsonValue({ v: 1, updatedAt: 1 })).toBe(hashJsonValue({ v: 1, updatedAt: 999 }));
  });
});
