/**
 * 顶栏组件
 *
 * 固定在页面顶部，左侧品牌标识（红方块"征"+ 标题），右侧当前日期。
 * 所有 Tab 页面共享此组件。
 */

import { createMemo } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { formatDate } from '../utils/format';
import { colors, font, sealStyle } from '../utils/theme';

/**
 * 品牌 + 日期的顶部导航栏。
 *
 * @returns 顶栏 JSX
 */
export function TopBar() {
  const { state } = useGameStore();

  const dateStr = createMemo(() => formatDate(state.time.year, state.time.month, state.time.day));

  return (
    <header
      style={{
        display: 'flex',
        'justify-content': 'space-between',
        gap: '16px',
        'align-items': 'center',
        padding: '0.8rem 1rem',
        'flex-shrink': 0,
        'background-color': colors.bgCard,
        'border-bottom': `2px solid ${colors.primary}`,
      }}
    >
      <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
        <div style={sealStyle()}>征</div>
        <div>
          <div style={{ 'font-family': font.title, 'font-size': '20px', 'font-weight': 700 }}>
            征途
          </div>
          <div style={{ color: colors.textMuted, 'font-size': '12px', 'line-height': '1.4' }}>
            政途人生 v3
          </div>
        </div>
      </div>
      <div
        style={{
          padding: '9px 14px',
          border: `1px solid ${colors.border}`,
          'border-radius': '999px',
          color: colors.secondary,
          background: 'rgba(255,253,248,0.88)',
          'font-size': '13px',
          'font-weight': 800,
          'white-space': 'nowrap',
        }}
      >
        {dateStr()}
      </div>
    </header>
  );
}
