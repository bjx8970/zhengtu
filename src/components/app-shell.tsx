/**
 * 应用外壳布局（机关工作台）
 *
 * 结构：
 * - 红头文件式总栏：机关印章 + 名称 + 游戏内日期 + 亮暗主题切换
 * - 全局导航条：工作台 / 任务 / 部门治理 / 年度考核 / 职务职级 / 政策 / 事件
 * - 可滚动内容区（公文版面）
 *
 * 所有工作台页面（/main、/tasks、/departments、/assessment、/career、/policies、/events）
 * 由此组件包裹；启动页与建档向导使用独立全屏版面。
 */

import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { formatDate } from '../utils/format';
import { getCurrentTheme, toggleTheme } from '../utils/theme';

/** 全局导航项配置 */
const NAV_ITEMS = [
  { path: '/main', label: '工作台' },
  { path: '/tasks', label: '任务' },
  { path: '/departments', label: '部门治理' },
  { path: '/assessment', label: '年度考核' },
  { path: '/career', label: '职务职级' },
  { path: '/policies', label: '政策' },
  { path: '/events', label: '事件' },
] as const;

/**
 * 订阅当前 hash 路径（不含 # 前缀）。
 *
 * @returns 当前路径 signal，如 '/main'
 */
function useHashPath() {
  const [path, setPath] = createSignal(window.location.hash.replace('#', '') || '/');
  const onHashChange = () => setPath(window.location.hash.replace('#', '') || '/');
  window.addEventListener('hashchange', onHashChange);
  onCleanup(() => window.removeEventListener('hashchange', onHashChange));
  return path;
}

/**
 * 应用外壳布局组件。
 *
 * @param props.children 页面内容
 * @returns 带总栏与导航的工作台布局
 */
export function AppShell(props: { children: JSX.Element }) {
  const { state } = useGameStore();
  const path = useHashPath();
  const [theme, setTheme] = createSignal(getCurrentTheme());

  /** 收件箱待处理事件数（与事件页「待处理」页签口径一致，不含阻断弹窗事件） */
  const pendingInboxCount = () =>
    state.events.pending.filter((event) => event.snapshot.presentation === 'inbox').length;
  const opportunityCount = () =>
    state.career.opportunities.filter((opportunity) => opportunity.status === 'available').length;

  function badgeFor(itemPath: string): number | null {
    if (itemPath === '/events') {
      const count = pendingInboxCount();
      return count > 0 ? count : null;
    }
    if (itemPath === '/career') return opportunityCount() > 0 ? opportunityCount() : null;
    return null;
  }

  return (
    <div style={{ height: '100%', display: 'flex', 'flex-direction': 'column' }}>
      <header class="masthead">
        <div class="masthead-inner">
          <div class="masthead-seal" aria-hidden="true">
            政
          </div>
          <div>
            <div class="masthead-title">政途人生</div>
            <div class="masthead-sub">机关工作台 · 公务员职业生涯模拟</div>
          </div>
          <div class="masthead-spacer" />
          <div class="masthead-date">
            <Show when={state.character.characterName} fallback="尚未建档">
              第 {state.time.totalDaysPlayed} 日 ·{' '}
              {formatDate(state.time.year, state.time.month, state.time.day)}
            </Show>
          </div>
          <button
            class="theme-toggle"
            onClick={() => setTheme(toggleTheme())}
            title={theme() === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
            aria-label="切换主题"
          >
            {theme() === 'dark' ? '\u2600' : '\u263E'}
          </button>
        </div>
        <nav class="navbar" aria-label="工作台导航">
          <div class="navbar-inner">
            <For each={NAV_ITEMS}>
              {(item) => (
                <a
                  href={`#${item.path}`}
                  class={path() === item.path ? 'nav-link active' : 'nav-link'}
                  aria-current={path() === item.path ? 'page' : undefined}
                >
                  {item.label}
                  <Show when={badgeFor(item.path) !== null}>
                    <span class="nav-badge">{badgeFor(item.path)}</span>
                  </Show>
                </a>
              )}
            </For>
          </div>
        </nav>
      </header>
      <main class="doc-scroll">
        <div class="doc-page doc-shell">{props.children}</div>
      </main>
    </div>
  );
}
