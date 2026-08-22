/**
 * 应用路由可达性测试。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { App } from './app';

describe('App routes', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('暂时停用登录路由', () => {
    window.location.hash = '#/login';

    render(() => <App />);

    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
  });

  it('注册职务与职级页面路由', () => {
    window.location.hash = '#/career';

    render(() => <App />);

    expect(screen.getByText('职务与职级')).toBeInTheDocument();
    expect(screen.getByText('公务员职级')).toBeInTheDocument();
    expect(screen.getByTestId('township-deputy-readiness')).toHaveTextContent('乡科级副职准备度');
    expect(screen.getByTestId('township-deputy-readiness')).toHaveTextContent('累计服务满 720 天');
  });

  it('exposes the policy and event interaction routes', () => {
    window.location.hash = '#/policies';
    const policies = render(() => <App />);
    expect(screen.getByText('政策治理')).toBeInTheDocument();
    policies.unmount();

    window.location.hash = '#/events';
    render(() => <App />);
    expect(screen.getByText('事件中心')).toBeInTheDocument();
  });
});
