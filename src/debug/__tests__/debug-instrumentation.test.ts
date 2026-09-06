/**
 * 动作注入测试：_rng/_idFactory 包装记录、序列化剥离函数字段。
 */

import { describe, expect, it } from 'vitest';
import {
  createDebugCapture,
  instrumentGameAction,
  serializeAction,
} from '../debug-instrumentation';

describe('instrumentGameAction', () => {
  it('包装 _rng 并按消费顺序记录随机数', () => {
    const capture = createDebugCapture();
    const source = () => 0.42;
    const action = instrumentGameAction(
      { type: 'ADVANCE_TIME', granularity: 'month', _rng: source },
      capture,
    );
    if (action.type !== 'ADVANCE_TIME' || !action._rng) throw new Error('expected rng action');
    expect(action._rng()).toBe(0.42);
    expect(action._rng()).toBe(0.42);
    expect(capture.randomDraws).toEqual([0.42, 0.42]);
    expect(capture.generatedIds).toEqual([]);
  });

  it('包装 _idFactory 并按生成顺序记录 ID', () => {
    const capture = createDebugCapture();
    let seq = 0;
    const action = instrumentGameAction(
      {
        type: 'START_ACTION',
        deptId: 'dept',
        actionId: 'act',
        tierKey: 'primary',
        _idFactory: () => `id-${++seq}`,
      },
      capture,
    );
    if (action.type !== 'START_ACTION' || !action._idFactory)
      throw new Error('expected id factory');
    expect(action._idFactory()).toBe('id-1');
    expect(action._idFactory()).toBe('id-2');
    expect(capture.generatedIds).toEqual(['id-1', 'id-2']);
  });

  it('未提供函数字段的动作注入默认实现并记录', () => {
    const capture = createDebugCapture();
    const action = instrumentGameAction({ type: 'ADVANCE_TIME', granularity: 'day' }, capture);
    if (action.type !== 'ADVANCE_TIME' || !action._rng || !action._idFactory) {
      throw new Error('expected injected dependencies');
    }
    // 默认源为 Math.random / runtime 工厂：调用即被记录
    const drawn = action._rng();
    expect(capture.randomDraws).toEqual([drawn]);
    const id = action._idFactory();
    expect(capture.generatedIds).toEqual([id]);
    expect(id).toContain('debug');
  });

  it('不修改原始动作对象', () => {
    const capture = createDebugCapture();
    const original = {
      type: 'ADVANCE_TIME' as const,
      granularity: 'day' as const,
      _rng: () => 0.5,
    };
    const wrapped = instrumentGameAction(original, capture);
    // 原对象的 _rng 仍为直通函数（不被记录）；包装发生在克隆上
    expect(original._rng()).toBe(0.5);
    expect(capture.randomDraws).toEqual([]);
    expect(wrapped).not.toBe(original);
  });
});

describe('serializeAction', () => {
  it('剥离函数字段并保留业务参数', () => {
    const serialized = serializeAction({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0.1,
      _idFactory: () => 'x',
    });
    expect(serialized).toEqual({ type: 'ADVANCE_TIME', granularity: 'week' });
    expect(JSON.stringify(serialized)).not.toContain('_rng');
  });

  it('无函数字段的动作完整保留', () => {
    expect(serializeAction({ type: 'NEW_GAME', data: { saveId: 's1' } })).toEqual({
      type: 'NEW_GAME',
      data: { saveId: 's1' },
    });
  });
});
