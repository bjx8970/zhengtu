/**
 * 行动排程页集成测试。
 *
 * 验证推荐行动列表渲染、空闲槽位分配和 START_ACTION 派发。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { App } from '../../../app';
import { createInitialState, dispatch, getRawState } from '../../../store/game-store';
import { writeLocalSave } from '../../../services/save-repo';
import { CareerLine } from '../../../types/enums';

const save = createInitialState({
  characterName: '测试角色',
  currentPositionId: 'admin_l1_0',
  currentLevel: 1,
  currentCareerLine: CareerLine.Administrative,
  remainingBudget: 50000,
  time: { year: 2028, month: 1, day: 1, granularity: 'day' },
});

describe('ActionsPage integration', () => {
  beforeEach(() => {
    writeLocalSave(save);
    dispatch({ type: 'LOAD_SAVE', save });
    window.location.hash = '#/actions';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('渲染推荐行动与开始执行按钮', () => {
    render(() => <App />);

    expect(screen.getByText('推荐行动')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '开始执行' });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('点击开始执行后槽位被占用', async () => {
    render(() => <App />);

    const buttons = await screen.findAllByRole('button', { name: '开始执行' });
    expect(buttons.length).toBeGreaterThan(0);

    const firstButton = buttons[0];
    if (firstButton) firstButton.click();

    const after = getRawState();
    const occupied = after.slots.primary.occupants.filter((o) => o !== null);
    expect(occupied.length).toBe(1);
  });
});
