/**
 * 本地存档启动页交互测试。
 *
 * 通过 mock startupSaveResult 模拟不同启动状态。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createInitialState, dispatch } from '../../store/game-store';

// mock main 模块的 startupSaveResult
let mockSaveResult: { status: string; state?: unknown; detail?: string } = { status: 'empty' };
vi.mock('../../main', () => ({
  get startupSaveResult() {
    return mockSaveResult;
  },
}));

import { SplashPage } from './splash';

describe('SplashPage local archive entry', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
    mockSaveResult = { status: 'empty' };
  });

  afterEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  it('无存档时直接进入建档', () => {
    mockSaveResult = { status: 'empty' };
    render(() => <SplashPage />);

    expect(screen.queryByRole('button', { name: /继续游戏/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /开始新游戏/ }));

    expect(window.location.hash).toBe('#/character');
  });

  it('有效存档展示摘要并可继续游戏', () => {
    const state = createInitialState({
      characterName: '林致远',
      currentPositionId: 'admin_l2_0',
      currentLevel: 2,
      time: { year: 2028, month: 6, day: 15, granularity: 'day' },
    });
    // 模拟启动时已加载存档到 store
    dispatch({ type: 'LOAD_SAVE', save: state });
    mockSaveResult = { status: 'loaded', state };

    render(() => <SplashPage />);

    expect(screen.getByText('林致远 · L2')).toBeInTheDocument();
    expect(screen.getByText('2028年6月15日')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /继续游戏/ }));

    expect(window.location.hash).toBe('#/main');
  });

  it('不兼容旧档显示提示并可开始新游戏', () => {
    mockSaveResult = {
      status: 'incompatible',
      detail: '本次大型版本不兼容旧存档，需要重新开始',
    };

    render(() => <SplashPage />);

    expect(screen.getByText(/检测到旧版本存档/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开始新游戏/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /继续游戏/ })).not.toBeInTheDocument();
  });
});
