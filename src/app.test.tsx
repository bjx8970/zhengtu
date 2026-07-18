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
});
