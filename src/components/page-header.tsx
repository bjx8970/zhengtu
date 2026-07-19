/**
 * 子页面顶部导航栏
 *
 * 提供返回工作台的 sticky 顶部栏，含返回按钮和页面标题。
 * 所有子页面（部门治理、行动排程、KPI 考核、晋升任命）共享此组件。
 */

import { navigate } from '../router';
import { colors, font } from '../utils/theme';

/**
 * 子页面顶部导航栏组件。
 *
 * @param props.title 页面标题
 * @param props.desc  可选的页面描述
 * @returns 顶部导航栏 JSX
 */
export function PageHeader(props: { title: string; desc?: string }) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        'z-index': 10,
        display: 'flex',
        'align-items': 'center',
        gap: '14px',
        padding: '14px 20px',
        background: colors.bgHeader,
        color: '#fff',
        'border-radius': '0 0 8px 8px',
        'box-shadow': '0 4px 16px rgba(23,43,69,0.18)',
      }}
    >
      <button
        onClick={() => navigate('/main')}
        title="返回工作台"
        style={{
          display: 'grid',
          'place-items': 'center',
          width: '32px',
          height: '32px',
          border: '1px solid rgba(255,255,255,0.25)',
          'border-radius': '50%',
          background: 'transparent',
          color: '#fff',
          'font-size': '16px',
          cursor: 'pointer',
        }}
      >
        {'\u2190'}
      </button>
      <div>
        <div style={{ 'font-size': '18px', 'font-weight': 700, 'font-family': font.title }}>
          {props.title}
        </div>
        {props.desc && (
          <div style={{ 'font-size': '12px', color: 'rgba(255,255,255,0.6)', 'margin-top': '2px' }}>
            {props.desc}
          </div>
        )}
      </div>
    </header>
  );
}
