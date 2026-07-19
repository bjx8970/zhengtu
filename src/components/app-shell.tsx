/**
 * 应用外壳布局
 *
 * 提供页面的标准布局容器：
 * - 全屏弹性列布局
 * - 可滚动内容区
 *
 * 工作台设计下不再包含底部导航栏，各页面自行管理顶部信息栏。
 * 子页面渲染时用此组件包裹：
 *   <AppShell><PageContent /></AppShell>
 */

import type { JSX } from 'solid-js';
import { colors } from '../utils/theme';

/**
 * 应用外壳布局组件。
 *
 * @param props.children 页面内容
 * @returns 完整页面布局
 */
export function AppShell(props: { children: JSX.Element }) {
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        'background-color': colors.bgMain,
        color: colors.textPrimary,
      }}
    >
      <main
        style={{
          flex: 1,
          'overflow-y': 'auto',
          '-webkit-overflow-scrolling': 'touch',
        }}
      >
        <div class="app-container">{props.children}</div>
      </main>
    </div>
  );
}
