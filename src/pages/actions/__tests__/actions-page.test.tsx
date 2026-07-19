/**
 * 行动排程页集成测试。
 *
 * 验证：
 * - 空状态页面渲染
 * - START_ACTION 派发后的槽位占用（通过 createTestStore 隔离）
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { App } from '../../../app';
import { createTestStore } from '../../../store/game-store';
import { CareerLine } from '../../../types/enums';

describe('ActionsPage', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('空状态显示暂无可用行动', () => {
    window.location.hash = '#/actions';
    render(() => <App />);

    expect(screen.getByText('暂无可用行动')).toBeInTheDocument();
  });
});

describe('ActionsPage store logic', () => {
  it('START_ACTION 正确占用主要槽位', () => {
    const store = createTestStore({
      characterName: '测试角色',
      currentPositionId: 'admin_l1_0',
      currentLevel: 1,
      currentCareerLine: CareerLine.Administrative,
      remainingBudget: 50000,
      time: { year: 2028, month: 1, day: 1, granularity: 'day' },
    });

    store.dispatch({
      type: 'NEW_GAME',
      data: {
        characterName: '测试角色',
        currentPositionId: 'admin_l1_0',
        currentLevel: 1,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 50000,
      },
    });

    const before = store.getRawState().slots.primary.occupants.filter((o) => o !== null).length;
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l1_0_dept_0',
      actionId: 'document_processing',
      tierKey: 'primary',
    });
    const after = store.getRawState().slots.primary.occupants.filter((o) => o !== null).length;
    expect(after).toBe(before + 1);
  });
});
