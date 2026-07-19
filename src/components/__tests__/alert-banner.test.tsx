/**
 * AlertBanner 组件冒烟测试。
 *
 * 验证：
 * - 空列表时不渲染任何内容
 * - 非空列表时正确渲染提醒消息
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { AlertBanner } from '../alert-banner';
import type { AlertItem } from '../../types/ui';

describe('AlertBanner', () => {
  it('空列表时不渲染', () => {
    const { container } = render(() => <AlertBanner alerts={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('非空列表时渲染提醒消息', () => {
    const alerts: AlertItem[] = [{ id: 'test-1', level: 'warning', message: '测试警告信息' }];
    render(() => <AlertBanner alerts={alerts} />);
    expect(screen.getByText('测试警告信息')).toBeInTheDocument();
  });

  it('带 action 时渲染跳转按钮', () => {
    const alerts: AlertItem[] = [
      {
        id: 'test-2',
        level: 'danger',
        message: '紧急提醒',
        action: { label: '查看', route: '/assessment' },
      },
    ];
    render(() => <AlertBanner alerts={alerts} />);
    expect(screen.getByText('紧急提醒')).toBeInTheDocument();
    expect(screen.getByText('查看')).toBeInTheDocument();
  });
});
