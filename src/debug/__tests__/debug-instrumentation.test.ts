/**
 * 动作注入测试：_rng/_idFactory 包装记录、序列化剥离函数字段、
 * 默认工厂与 reducer 领域前缀一致（traced/untraced 语义相同）。
 */

import { describe, expect, it } from 'vitest';
import type { GameAction } from '../../types/game';
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
    if (action.type !== 'START_ACTION' || !action._idFactory) {
      throw new Error('expected id factory');
    }
    expect(action._idFactory()).toBe('id-1');
    expect(action._idFactory()).toBe('id-2');
    expect(capture.generatedIds).toEqual(['id-1', 'id-2']);
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

  it('未提供函数字段的动作注入与 reducer 一致的默认实现', () => {
    const capture = createDebugCapture();
    const action = instrumentGameAction({ type: 'ADVANCE_TIME', granularity: 'day' }, capture);
    if (action.type !== 'ADVANCE_TIME' || !action._rng || !action._idFactory) {
      throw new Error('expected injected dependencies');
    }
    const drawn = action._rng();
    expect(capture.randomDraws).toEqual([drawn]);
    const id = action._idFactory();
    expect(capture.generatedIds).toEqual([id]);
    // 领域前缀与 time-reducer 回退语义一致（timeline），而非调试专用前缀
    expect(id.startsWith('timeline_')).toBe(true);
  });

  it.each([
    [{ type: 'ADVANCE_TIME', granularity: 'day' }, 'timeline_'],
    [{ type: 'CHOOSE_EVENT_OPTION', eventInstanceId: 'e', optionId: 'o' }, 'event_'],
    [{ type: 'PROPOSE_POLICY', policyId: 'p' }, 'policy_'],
    [{ type: 'APPROVE_POLICY', policyInstanceId: 'p' }, 'policy_'],
    [{ type: 'ACTIVATE_POLICY', policyInstanceId: 'p' }, 'policy_'],
    [{ type: 'SUSPEND_POLICY', policyInstanceId: 'p' }, 'policy_'],
    [{ type: 'RESUME_POLICY', policyInstanceId: 'p' }, 'policy_'],
    [{ type: 'FAIL_POLICY', policyInstanceId: 'p' }, 'policy_'],
    [{ type: 'REPEAL_POLICY', policyInstanceId: 'p' }, 'policy_'],
    [{ type: 'ADVANCE_CIVIL_SERVICE_RANK' }, 'rank_'],
    [{ type: 'START_ACTION', deptId: 'd', actionId: 'a', tierKey: 'primary' }, 'action_'],
    [{ type: 'START_PERSONAL_TASK', taskId: 't', tierKey: 'primary' }, 'task_'],
    [{ type: 'ACCEPT_CAREER_OPPORTUNITY', opportunityId: 'o' }, 'career_'],
    [{ type: 'ADVANCE_CAREER_PROCESS', opportunityId: 'o' }, 'career_'],
  ] as [GameAction, string][])('默认 ID 工厂领域前缀与 reducer 一致：%s → %s', (action, prefix) => {
    const capture = createDebugCapture();
    const wrapped = instrumentGameAction(action, capture);
    const factory = (wrapped as { _idFactory?: () => string })._idFactory;
    if (!factory) throw new Error('expected injected id factory');
    expect(factory().startsWith(prefix)).toBe(true);
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
