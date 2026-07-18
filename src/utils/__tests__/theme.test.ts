/**
 * 主题令牌一致性测试。
 *
 * 确保供内联样式使用的 TypeScript 镜像不会与全局 CSS 变量产生视觉漂移。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colors, radius, space } from '../theme';

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

const TOKEN_EXPECTATIONS: Readonly<Record<string, string>> = {
  '--bg-main': colors.bgMain,
  '--bg-card': colors.bgCard,
  '--bg-card-light': colors.bgCardLight,
  '--bg-header': colors.bgHeader,
  '--text-primary': colors.textPrimary,
  '--text-secondary': colors.textSecondary,
  '--text-dark': colors.textDark,
  '--text-muted': colors.textMuted,
  '--color-primary': colors.primary,
  '--color-primary-hover': colors.primaryHover,
  '--color-primary-light': colors.primaryLight,
  '--color-primary-text': colors.primaryText,
  '--color-secondary': colors.secondary,
  '--color-secondary-light': colors.secondaryLight,
  '--color-secondary-text': colors.secondaryText,
  '--color-success': colors.success,
  '--color-success-light': colors.successLight,
  '--color-warning': colors.warning,
  '--color-warning-light': colors.warningLight,
  '--color-danger': colors.danger,
  '--bg-input': colors.bgInput,
  '--border-color': colors.border,
  '--border-color-light': colors.borderLight,
  '--radius-sm': radius.sm,
  '--radius-md': radius.md,
  '--radius-lg': radius.lg,
  '--radius-xl': radius.xl,
  '--space-xs': space.xs,
  '--space-sm': space.sm,
  '--space-md': space.md,
  '--space-lg': space.lg,
  '--space-xl': space.xl,
};

describe('theme tokens', () => {
  it.each(Object.entries(TOKEN_EXPECTATIONS))('%s 与 TypeScript 镜像一致', (name, value) => {
    expect(tokensCss).toContain(`${name}: ${value};`);
  });
});
