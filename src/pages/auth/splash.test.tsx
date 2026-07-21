/**
 * 本地存档启动页交互测试。
 *
 * 通过 setStartupSaveResult 模拟不同启动状态。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createInitialState, dispatch } from '../../store/game-store';
import { setStartupSaveResult } from '../../services/startup-save-state';
import { SplashPage } from './splash';

describe('SplashPage local archive entry', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
    setStartupSaveResult({ status: 'empty' });
    // 重置 Store 为空状态，避免测试间泄漏
    dispatch({ type: 'LOAD_SAVE', save: createInitialState() });
  });

  afterEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  it('无存档时直接进入建档', () => {
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
    dispatch({ type: 'LOAD_SAVE', save: state });
    setStartupSaveResult({ status: 'loaded', state });

    render(() => <SplashPage />);

    expect(screen.getByText('林致远 · L2')).toBeInTheDocument();
    expect(screen.getByText('2028年6月15日')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /继续游戏/ }));

    expect(window.location.hash).toBe('#/main');
  });

  it('不兼容旧档显示提示并可开始新游戏', () => {
    setStartupSaveResult({
      status: 'legacy',
      detail: '本次大型版本不兼容旧存档，需要重新开始',
    });

    render(() => <SplashPage />);

    expect(screen.getByText(/检测到旧版本存档/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开始新游戏/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /继续游戏/ })).not.toBeInTheDocument();
  });

  it('未来版本存档显示更新提示', () => {
    setStartupSaveResult({
      status: 'future',
      detail: '存档版本高于当前支持',
    });

    render(() => <SplashPage />);

    expect(screen.getByText(/检测到更新版本的存档/)).toBeInTheDocument();
    expect(screen.queryByText(/检测到旧版本存档/)).not.toBeInTheDocument();
  });

  it('NEW_GAME 后返回启动页显示新角色摘要', () => {
    setStartupSaveResult({
      status: 'legacy',
      detail: '不兼容旧存档',
    });

    // 模拟 NEW_GAME 已写入角色到 Store
    const state = createInitialState({
      characterName: '新角色',
      currentPositionId: 'admin_l1_0',
      currentLevel: 1,
      time: { year: 2012, month: 1, day: 1, granularity: 'day' },
    });
    dispatch({ type: 'LOAD_SAVE', save: state });

    render(() => <SplashPage />);

    // 不应继续显示旧档警告
    expect(screen.queryByText(/检测到旧版本存档/)).not.toBeInTheDocument();
    // 应显示新角色摘要和继续游戏
    expect(screen.getByText('新角色 · L1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /继续游戏/ })).toBeInTheDocument();
  });
});
