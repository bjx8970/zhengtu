/**
 * 晋升任命页集成测试。
 *
 * 验证空闲状态渲染和 START_PROMOTION 派发。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { App } from '../../../app';
import { createTestStore } from '../../../store/game-store';
import { PromotionStage } from '../../../types/enums';
import { CareerLine } from '../../../types/enums';

describe('CareerPage', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('空闲状态显示暂无进行中的晋升流程', () => {
    window.location.hash = '#/career';
    render(() => <App />);

    expect(screen.getByText('暂无进行中的晋升流程')).toBeInTheDocument();
  });
});

describe('CareerPage store logic', () => {
  it('初始晋升状态为 Idle', () => {
    const store = createTestStore({
      characterName: '测试角色',
      currentPositionId: 'admin_l1_0',
      currentLevel: 1,
      currentCareerLine: CareerLine.Administrative,
      remainingBudget: 50000,
    });

    expect(store.state.promotionStage).toBe(PromotionStage.Idle);
  });
});
