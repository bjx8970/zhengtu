/**
 * 设置页冒烟测试：版本信息与调试区块渲染、按钮可用。
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { SettingsPage } from '../settings-page';

describe('SettingsPage', () => {
  it('渲染版本信息与调试入口', () => {
    render(() => <SettingsPage />);

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByText('版本信息')).toBeInTheDocument();
    expect(screen.getByText('调试')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 Debug Bundle' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '清除 Debug Trace' })).toBeEnabled();
  });

  it('无活动轨迹时显示未记录说明', () => {
    render(() => <SettingsPage />);

    expect(screen.getByText(/当前未在记录操作轨迹/)).toBeInTheDocument();
  });
});
