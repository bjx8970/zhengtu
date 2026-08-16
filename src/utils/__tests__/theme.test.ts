/**
 * 主题服务测试。
 *
 * 验证：
 * - 亮/暗主题切换、持久化与根节点应用
 * - tokens.css 中亮暗两套主题均定义了完整的设计令牌
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, getCurrentTheme, initTheme, meterFillClass, toggleTheme } from '../theme';

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** 随亮暗主题切换的设计令牌（两套主题都必须定义） */
const THEME_TOKENS = [
  '--bg-canvas',
  '--bg-page',
  '--bg-card',
  '--bg-card-solid',
  '--bg-soft',
  '--bg-input',
  '--bg-overlay',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-soft',
  '--color-primary-text',
  '--color-secondary',
  '--color-secondary-soft',
  '--color-success',
  '--color-success-soft',
  '--color-warning',
  '--color-warning-soft',
  '--color-danger',
  '--color-danger-soft',
  '--color-gold',
  '--color-gold-soft',
  '--border-color',
  '--border-strong',
  '--shadow-card',
  '--shadow-modal',
] as const;

/** 两套主题共享的设计令牌（只在根块定义，暗色继承） */
const SHARED_TOKENS = [
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--font-title',
  '--font-body',
] as const;

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('tokens.css', () => {
  it('亮色主题定义了全部主题令牌与共享令牌', () => {
    const rootBlock = tokensCss.slice(
      tokensCss.indexOf(':root'),
      tokensCss.indexOf("html[data-theme='dark'] {"),
    );
    for (const token of [...THEME_TOKENS, ...SHARED_TOKENS]) {
      expect(rootBlock).toContain(`${token}:`);
    }
  });

  it('暗色主题定义了全部主题令牌', () => {
    const darkBlock = tokensCss.slice(tokensCss.indexOf("html[data-theme='dark'] {"));
    for (const token of THEME_TOKENS) {
      expect(darkBlock).toContain(`${token}:`);
    }
  });
});

describe('theme service', () => {
  it('默认跟随系统偏好且不写存档', () => {
    const theme = getCurrentTheme();
    expect(['light', 'dark']).toContain(theme);
    expect(localStorage.getItem('zhengtu_theme')).toBeNull();
  });

  it('applyTheme 写入根节点 data-theme', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggleTheme 在两主题间切换并持久化', () => {
    const before = getCurrentTheme();
    const after = toggleTheme();
    expect(after).not.toBe(before);
    expect(localStorage.getItem('zhengtu_theme')).toBe(after);
    expect(document.documentElement.dataset.theme).toBe(after);
  });

  it('initTheme 应用持久化偏好', () => {
    localStorage.setItem('zhengtu_theme', 'dark');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('meterFillClass', () => {
  it('按完成率给出配色类名', () => {
    expect(meterFillClass(1)).toContain('green');
    expect(meterFillClass(0.8)).toContain('primary');
    expect(meterFillClass(0.2)).toContain('red');
  });
});
