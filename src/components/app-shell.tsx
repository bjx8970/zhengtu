/** 现代政务工作台外壳：侧栏、移动导航、主题切换和可滚动业务区。 */
import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { formatDate } from '../utils/format';
import { getCurrentTheme, toggleTheme } from '../utils/theme';
import { CIVIL_SERVICE_RANK_LABELS } from '../domain/career/types';
import { UiIcon } from './ui-icon';
import type { UiIconName } from '../types/ui';

const NAV_ITEMS: { path: string; label: string; icon: UiIconName }[] = [
  { path: '/main', label: '工作台', icon: 'home' },
  { path: '/tasks', label: '任务', icon: 'tasks' },
  { path: '/departments', label: '部门治理', icon: 'departments' },
  { path: '/assessment', label: '年度考核', icon: 'assessment' },
  { path: '/career', label: '职务职级', icon: 'career' },
  { path: '/policies', label: '政策', icon: 'policies' },
  { path: '/events', label: '事件', icon: 'events' },
];

/**
 * 渲染全部业务页共享的工作台外壳。
 * @param props 页面内容
 * @returns 响应式工作台布局
 */
export function AppShell(props: { children: JSX.Element }) {
  const { state } = useGameStore();
  const [path, setPath] = createSignal(window.location.hash.replace('#', '') || '/');
  let content: HTMLElement | undefined;
  const onHashChange = () => {
    setPath(window.location.hash.replace('#', '') || '/');
    content?.scrollTo({ top: 0 });
  };
  window.addEventListener('hashchange', onHashChange);
  onCleanup(() => window.removeEventListener('hashchange', onHashChange));
  const [theme, setTheme] = createSignal(getCurrentTheme());
  const badgeFor = (itemPath: string) => {
    if (itemPath === '/events')
      return state.events.pending.filter((event) => event.snapshot.presentation === 'inbox').length;
    if (itemPath === '/career')
      return state.career.opportunities.filter((opportunity) => opportunity.status === 'available')
        .length;
    return 0;
  };

  return (
    <div class="workspace">
      <a
        class="skip-link"
        href="#workspace-content"
        onClick={(event) => {
          event.preventDefault();
          content?.focus();
        }}
      >
        跳转到主要内容
      </a>
      <aside class="workspace-sidebar">
        <a class="workspace-brand" href="#/main" aria-label="政途人生工作台">
          <span class="brand-seal">政</span>
          <span>
            <strong>政途人生</strong>
            <small>ZHENGTU · YOUR JOURNEY</small>
          </span>
        </a>
        <div class="sidebar-label">我的工作空间</div>
        <nav class="workspace-nav" aria-label="工作台导航">
          <For each={NAV_ITEMS}>
            {(item) => (
              <a
                href={`#${item.path}`}
                class={path() === item.path ? 'nav-link active' : 'nav-link'}
                aria-current={path() === item.path ? 'page' : undefined}
              >
                <UiIcon name={item.icon} />
                <span>{item.label}</span>
                <Show when={badgeFor(item.path) > 0}>
                  <span class="nav-badge">{badgeFor(item.path)}</span>
                </Show>
              </a>
            )}
          </For>
        </nav>
        <div class="sidebar-note">
          <span>每一份用心，皆是前行。</span>
          <p>做好眼前事，走好脚下路。</p>
          <div class="sidebar-line" />
        </div>
        <div class="sidebar-profile">
          <span class="profile-avatar">{state.character.characterName.charAt(0) || '政'}</span>
          <div>
            <strong>{state.character.characterName || '尚未建档'}</strong>
            <small>{CIVIL_SERVICE_RANK_LABELS[state.career.civilServiceRank]}</small>
          </div>
          <a href="#/" class="sidebar-exit" aria-label="返回游戏首页" title="返回游戏首页">
            <UiIcon name="logout" />
          </a>
        </div>
      </aside>
      <div class="workspace-body">
        <header class="workspace-topbar">
          <div class="workspace-breadcrumb">
            我的工作空间 <span>/</span>{' '}
            <strong>{NAV_ITEMS.find((item) => item.path === path())?.label ?? '工作台'}</strong>
          </div>
          <div class="topbar-actions">
            <a class="mobile-home-link" href="#/" aria-label="返回游戏首页" title="返回游戏首页">
              <UiIcon name="logout" />
            </a>
            <span class="topbar-date">
              <UiIcon name="clock" />
              {formatDate(state.time.year, state.time.month, state.time.day)}
            </span>
            <span class="tag tag-green">第 {state.time.totalDaysPlayed} 日</span>
            <button
              class="theme-toggle"
              onClick={() => setTheme(toggleTheme())}
              title={theme() === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
              aria-label="切换主题"
            >
              <UiIcon name={theme() === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </header>
        <main
          ref={content}
          id="workspace-content"
          tabIndex={-1}
          class="doc-scroll workspace-content"
        >
          <div class="doc-page doc-shell">
            {props.children}
            <footer class="workspace-footer">
              <span>政途人生 · 公务员职业生涯模拟</span>
              <span>一步一个脚印，书写你的履历。</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
