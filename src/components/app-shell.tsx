/**
 * 应用外壳布局
 *
 * 提供 Tab 页面的标准三栏布局：
 * - 顶部：TopBar（品牌 + 日期）
 * - 中间：可滚动内容区
 * - 底部：BottomTabBar（固定 5-Tab 导航）
 *
 * 子页面渲染时用此组件包裹：
 *   <AppShell activeTab={0}><HomePageContent /></AppShell>
 */

import type { JSX } from 'solid-js';
import { TopBar } from './top-bar';
import { BottomTabBar } from './bottom-tab-bar';
import { colors } from '../utils/theme';

/**
 * 应用外壳布局组件。
 *
 * @param props.activeTab 当前 Tab 索引
 * @param props.children  页面内容
 * @returns 完整页面布局
 */
export function AppShell(props: { activeTab: number; children: JSX.Element }) {
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
      <TopBar />
      <main
        style={{
          flex: 1,
          'overflow-y': 'auto',
          '-webkit-overflow-scrolling': 'touch',
        }}
      >
        <div class="app-container">{props.children}</div>
      </main>
      <BottomTabBar activeTab={props.activeTab} />
    </div>
  );
}
