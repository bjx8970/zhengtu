/**
 * 本地存档启动页交互测试。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { SplashPage } from './splash';
import { createInitialState } from '../../store/game-store';
import { writeLocalSave } from '../../services/save-repo';

describe('SplashPage local archive entry', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
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
    writeLocalSave(
      createInitialState({
        characterName: '林致远',
        currentPositionId: 'admin_l2_0',
        currentLevel: 2,
        time: { year: 2028, month: 6, day: 15, granularity: 'day' },
      }),
    );

    render(() => <SplashPage />);

    expect(screen.getByText('林致远 · L2')).toBeInTheDocument();
    expect(screen.getByText('2028年6月15日')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /继续游戏/ }));

    expect(window.location.hash).toBe('#/dashboard');
  });

  it('损坏存档按无存档处理', () => {
    localStorage.setItem('zhengtu_autosave', '{invalid-json');

    render(() => <SplashPage />);

    expect(screen.getByRole('button', { name: /开始新游戏/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /继续游戏/ })).not.toBeInTheDocument();
  });
});
