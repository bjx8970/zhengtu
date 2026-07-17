/**
 * 主题工具函数
 *
 * 从 CSS 变量提取为 TypeScript 常量，供 inline style 中使用。
 * CSS 变量定义见 src/styles/tokens.css，此文件为同源的 TS 版本。
 *
 * 用法：
 *   style={{ background: colors.primary, borderRadius: radius.md }}
 */

export const colors = {
  bgMain: '#1a1a2e',
  bgCard: '#0f0f23',
  bgCardLight: '#ffffff',
  bgHeader: '#141428',

  textPrimary: '#e8e6e3',
  textSecondary: '#8b8680',
  textDark: '#1a1a1a',
  textMuted: '#6b6560',

  primary: '#be2d2d',
  primaryHover: '#a02020',
  primaryLight: 'rgba(190, 45, 45, 0.15)',
  primaryText: '#ffffff',

  secondary: '#2b4e6e',
  secondaryLight: 'rgba(43, 78, 110, 0.15)',
  secondaryText: '#e8e6e3',

  success: '#4caf50',
  successLight: 'rgba(76, 175, 80, 0.15)',
  warning: '#e6a817',
  danger: '#c44d4d',

  border: '#3a3540',
  borderLight: '#d4c5b9',

  white: '#ffffff',
  black: '#000000',
} as const;

export const radius = {
  sm: '2px',
  md: '4px',
  lg: '8px',
  xl: '12px',
} as const;

export const space = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
} as const;

export const font = {
  title: '"STKaiti", "KaiTi", "楷体", serif',
  body: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
} as const;

/** 页面容器基础样式 */
export const pageBase = {
  display: 'flex',
  'flex-direction': 'column' as const,
  height: '100%',
  'background-color': colors.bgMain,
  color: colors.textPrimary,
} as const;

/** 页面头部基础样式 */
export const headerBase = {
  display: 'flex',
  'justify-content': 'space-between',
  'align-items': 'center',
  'padding-bottom': space.md,
  'border-bottom': `1px solid ${colors.bgCard}`,
  'background-color': colors.bgMain,
  padding: space.md,
} as const;

/**
 * 亮色卡片样式，悬浮于深色背景上。
 * @param pad 可选内边距覆盖
 */
export function cardStyle(pad?: string) {
  return {
    background: colors.bgCardLight,
    'border-radius': radius.md,
    padding: pad ?? space.md,
    color: colors.textDark,
    border: `1px solid ${colors.borderLight}`,
  };
}

/**
 * 暗色卡片样式，与背景同色系。
 * @param pad 可选内边距覆盖
 */
export function darkCardStyle(pad?: string) {
  return {
    background: colors.bgCard,
    'border-radius': radius.md,
    padding: pad ?? space.md,
    border: `1px solid ${colors.border}`,
  };
}
