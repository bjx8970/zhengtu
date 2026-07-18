/**
 * Dashboard 晋升状态交互测试。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { Dashboard } from './dashboard';
import { createInitialState, dispatch, getRawState } from '../../store/game-store';
import { CareerLine, PromotionStage } from '../../types/enums';
import type { SlotOccupant } from '../../types/player';

function loadDashboardState(overrides: Parameters<typeof createInitialState>[0]): void {
  dispatch({ type: 'LOAD_SAVE', save: createInitialState(overrides) });
}

function pendingAction(): SlotOccupant {
  return {
    actionId: 'pending',
    deptId: 'admin_l1_0_dept_0',
    actionName: '待完成行动',
    startedAtDay: 0,
    durationDays: 3,
  };
}

describe('Dashboard promotion panel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    dispatch({ type: 'LOAD_SAVE', save: createInitialState() });
    localStorage.clear();
  });

  it('晋升完成后可开始新任期', () => {
    loadDashboardState({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      promotionStage: PromotionStage.Completed,
      promotionState: {
        currentStage: PromotionStage.Completed,
        targetPositionId: 'admin_l2_0',
        targetLevel: 2,
        stageResults: {},
      },
    });
    render(() => <Dashboard />);

    fireEvent.click(screen.getByText(/晋升状态/));
    fireEvent.click(screen.getByRole('button', { name: '开始新任期' }));

    expect(getRawState().promotionStage).toBe(PromotionStage.Idle);
    expect(screen.getByRole('button', { name: '启动晋升' })).toBeInTheDocument();
  });

  it('L3 显示当前版本封顶提示', () => {
    loadDashboardState({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 3,
      currentPositionId: 'admin_l3_0',
      promotionStage: PromotionStage.Idle,
    });
    render(() => <Dashboard />);

    fireEvent.click(screen.getByText(/晋升状态/));

    expect(screen.getByText('已达当前版本最高等级')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '启动晋升' })).not.toBeInTheDocument();
  });

  it('L3 晋升完成后可关闭结果并继续任职', () => {
    loadDashboardState({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 3,
      currentPositionId: 'admin_l3_0',
      promotionStage: PromotionStage.Completed,
      promotionState: {
        currentStage: PromotionStage.Completed,
        targetPositionId: 'admin_l3_0',
        targetLevel: 3,
        stageResults: {},
      },
    });
    render(() => <Dashboard />);

    fireEvent.click(screen.getByText(/晋升状态/));
    fireEvent.click(screen.getByRole('button', { name: '继续任职' }));

    expect(getRawState().promotionStage).toBe(PromotionStage.Idle);
    expect(screen.getByText('已达当前版本最高等级')).toBeInTheDocument();
  });

  it('存在在途行动时禁用晋升并显示提示', () => {
    loadDashboardState({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 1,
      currentPositionId: 'admin_l1_0',
      promotionStage: PromotionStage.Idle,
      slots: {
        primary: { label: '主要', count: 3, occupants: [pendingAction(), null, null] },
        secondary: { label: '次要', count: 2, occupants: [null, null] },
        reserve: { label: '备用', count: 1, occupants: [null] },
      },
    });
    render(() => <Dashboard />);

    fireEvent.click(screen.getByText(/晋升状态/));

    expect(screen.getByRole('button', { name: '启动晋升' })).toBeDisabled();
    expect(screen.getByText('请先完成当前行动，再启动晋升')).toBeInTheDocument();
  });
});
