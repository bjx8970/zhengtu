/**
 * 底部 Tab 导航栏
 *
 * 5 个主页面 Tab：主页、部门、行动、KPI、晋升。
 * 固定在可视区域底部，带毛玻璃效果。
 */

import { For } from 'solid-js';
import { navigate } from '../router';
import { colors } from '../utils/theme';
import type { TabDef } from '../types/ui';

const TABS: TabDef[] = [
  { label: '主页', icon: '\u2302', route: '/main' },
  { label: '部门', icon: '\u25A6', route: '/departments' },
  { label: '行动', icon: '\u25F7', route: '/actions' },
  { label: 'KPI', icon: '\u25CE', route: '/assessment' },
  { label: '晋升', icon: '\u25B2', route: '/career' },
];

/**
 * 底部 Tab 导航组件。
 *
 * @param props.activeTab 当前活跃的 Tab 索引（0-4）
 * @returns 固定底部的导航栏 JSX
 */
export function BottomTabBar(props: { activeTab: number }) {
  return (
    <nav
      style={{
        position: 'fixed',
        right: 0,
        bottom: 0,
        left: 0,
        'z-index': 20,
        'border-top': `1px solid ${colors.border}`,
        background: 'rgba(255,253,248,0.96)',
        'box-shadow': '0 -12px 32px rgba(32,42,53,0.12)',
        'backdrop-filter': 'blur(10px)',
      }}
    >
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(5, 1fr)',
          width: 'min(100%, 760px)',
          margin: '0 auto',
          padding: '7px 10px 9px',
          gap: '4px',
        }}
      >
        <For each={TABS}>
          {(tab, i) => {
            const isActive = i() === props.activeTab;
            return (
              <button
                onClick={() => navigate(tab.route)}
                style={{
                  display: 'grid',
                  'place-items': 'center',
                  gap: '4px',
                  'min-height': '56px',
                  border: 0,
                  'border-radius': '8px',
                  color: isActive ? colors.primary : colors.textMuted,
                  background: isActive ? `rgba(179,38,45,0.09)` : 'transparent',
                  cursor: 'pointer',
                  'font-size': '12px',
                  'font-weight': 800,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ 'font-size': '18px', 'line-height': '1' }}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          }}
        </For>
      </div>
    </nav>
  );
}
