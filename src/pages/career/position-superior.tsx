/**
 * 上级关系页面 — Phase 3 实现
 *
 * 职责：
 * - 展示当前上级信息与好感度
 * - 提供与上级互动的行为选项
 * - 管理上下级关系状态
 */

import type { JSX } from 'solid-js';
import { pageBase } from '../../utils/theme';
import { navigate } from '../../router';

/**
 * 上级关系页面组件（占位）
 *
 * @returns 占位 UI
 */
export function PositionSuperior(): JSX.Element {
  return (
    <div
      style={{
        ...pageBase,
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '1rem',
      }}
    >
      <h2 style={{ margin: 0 }}>上级关系</h2>
      <p style={{ color: '#666', 'text-align': 'center', 'line-height': '1.8' }}>
        此功能正在开发中，敬请期待。
        <br />
        完成后将支持：查看上级信息、好感度管理、互动行为等。
      </p>
      <a
        href="#/dashboard"
        onClick={(e) => {
          e.preventDefault();
          navigate('/dashboard');
        }}
        style={{
          color: '#4A6FA5',
          'text-decoration': 'none',
          'font-size': '0.9rem',
        }}
      >
        ← 返回仪表盘
      </a>
    </div>
  );
}
