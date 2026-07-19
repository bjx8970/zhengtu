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
  bgMain: '#eeece6',
  bgPaper: '#f1eee8',
  bgCard: '#fffdf8',
  bgCardLight: '#ffffff',
  bgSoft: '#f8f4ec',
  bgHeader: '#172b45',

  textPrimary: '#202a35',
  textSecondary: '#657080',
  textDark: '#1a1a1a',
  textMuted: '#8d939b',

  primary: '#b3262d',
  primaryHover: '#8f1f25',
  primaryLight: 'rgba(190, 45, 45, 0.15)',
  primaryText: '#ffffff',

  secondary: '#284b70',
  secondaryLight: 'rgba(40, 75, 112, 0.15)',
  secondaryText: '#e8e6e3',

  success: '#4caf50',
  successLight: 'rgba(76, 175, 80, 0.15)',
  warning: '#e6a817',
  warningLight: 'rgba(230, 168, 23, 0.15)',
  danger: '#c44d4d',

  gold: '#b78324',
  cyan: '#3b7f8f',

  border: '#d8d4cc',
  borderLight: '#e8e4dc',

  /** 亮色输入框底色 */
  bgInput: '#f8f7f5',

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

/**
 * 进度条颜色计算函数。
 *
 * @param rate 完成率（0~∞）
 * @returns 对应的进度条颜色
 */
export function progressBarColor(rate: number): string {
  if (rate >= 1) return colors.success;
  if (rate >= 0.6) return colors.primary;
  return colors.danger;
}

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

/**
 * Pill 标签样式（圆角药丸形状）。
 *
 * @param bgColor 背景色
 * @param textColor 文字色
 * @returns SolidJS style 对象
 */
export function pillStyle(bgColor: string, textColor: string) {
  return {
    display: 'inline-flex',
    'align-items': 'center',
    'min-height': '28px',
    padding: '4px 9px',
    'border-radius': '999px',
    background: bgColor,
    color: textColor,
    'font-size': '12px',
    'font-weight': 800,
  } as const;
}

/**
 * 带阴影的悬浮卡片样式。
 *
 * @param pad 可选内边距覆盖
 * @returns SolidJS style 对象
 */
export function cardElevated(pad?: string) {
  return {
    background: colors.bgCard,
    'border-radius': radius.lg,
    padding: pad ?? space.md,
    border: `1px solid ${colors.border}`,
    'box-shadow': '0 16px 36px rgba(32, 42, 53, 0.1)',
  } as const;
}

/**
 * Meter 进度条容器样式。
 *
 * @returns SolidJS style 对象
 */
export function meterContainer() {
  return {
    height: '7px',
    overflow: 'hidden' as const,
    'border-radius': '999px',
    background: '#e7e1d6',
  } as const;
}

/**
 * 品牌方块样式（红底楷体白字）。
 *
 * @returns SolidJS style 对象
 */
export function sealStyle() {
  return {
    display: 'grid',
    'place-items': 'center',
    width: '44px',
    height: '44px',
    'border-radius': '8px',
    color: '#fff',
    background: colors.primary,
    'font-family': font.title,
    'font-size': '25px',
    'font-weight': 700,
  } as const;
}

/** 属性名到中文显示名的映射 */
export const ATTR_LABELS: Record<string, string> = {
  stability: '稳定',
  competence: '能力',
  integrity: '廉洁',
  charisma: '魅力',
  politicalCapital: '政治资本',
  superiorFavor: '上司好感',
  reform: '改革派声望',
  pragmatic: '务实派声望',
  conservative: '保守派声望',
};
