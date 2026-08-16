/**
 * 主题服务
 *
 * 职责：
 * - 亮/暗主题切换（localStorage 持久化 + 系统偏好回退）
 * - 把主题写入 <html data-theme="...">，CSS 变量在 tokens.css 中按主题定义
 * - 提供与主题无关的运行时辅助（进度条配色类名等）
 *
 * 页面不再使用内联十六进制颜色；视觉一律走 CSS 变量与组件类名。
 */

/** 主题偏好 */
export type ThemePreference = 'light' | 'dark';

/** 主题持久化使用的 localStorage 键 */
const STORAGE_KEY = 'zhengtu_theme';

/**
 * 读取系统是否偏好深色模式。
 *
 * @returns 系统偏好深色时返回 true；无 matchMedia（如测试环境）时返回 false
 */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 计算当前生效主题。
 *
 * @returns 当前生效主题（用户显式选择优先，否则跟随系统偏好）
 */
export function getCurrentTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage 不可用（隐私模式等）时跟随系统偏好
  }
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * 将主题应用到 <html> 根节点。
 *
 * @param theme 目标主题
 */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

/**
 * 应用启动时初始化：读取偏好并写入根节点。
 * 在 main.tsx 渲染前调用，避免首帧闪烁。
 */
export function initTheme(): void {
  applyTheme(getCurrentTheme());
}

/**
 * 切换亮/暗主题并持久化。
 *
 * @returns 切换后的主题
 */
export function toggleTheme(): ThemePreference {
  const next: ThemePreference = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 持久化失败时仅本次会话生效
  }
  applyTheme(next);
  return next;
}

/**
 * 进度条填充色类名。
 *
 * @param rate 完成率（0~∞，1 表示达标）
 * @returns meter-fill 的配色变体类名
 */
export function meterFillClass(rate: number): string {
  if (rate >= 1) return 'meter-fill green';
  if (rate >= 0.6) return 'meter-fill primary';
  return 'meter-fill red';
}

/** 属性名到中文显示名的映射 */
export const ATTR_LABELS: Record<string, string> = {
  vigor: '体魄',
  stability: '定力',
  competence: '才干',
  integrity: '品性',
  charisma: '魅力',
  politicalCapital: '政治资本',
  network: '人脉',
  diligence: '勤勉',
  ambition: '怀抱',
  innovation: '开拓创新',
  pragmatic: '实干务实',
  principled: '稳健守正',
};
