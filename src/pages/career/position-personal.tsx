/**
 * 个人生活页面 — Phase 3 实现
 *
 * 职责：
 * - 展示住房、子女教育等生活状态
 * - 管理健康值与生活质量
 * - 提供生活相关的行为选项
 */

import type { JSX } from 'solid-js';
import { pageBase } from '../../utils/theme';
import { navigate } from '../../router';

/**
 * 个人生活页面组件（占位）
 *
 * @returns 占位 UI
 */
export function PositionPersonal(): JSX.Element {
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
      <h2 style={{ margin: 0 }}>个人生活</h2>
      <p style={{ color: '#666', 'text-align': 'center', 'line-height': '1.8' }}>
        此功能正在开发中，敬请期待。
        <br />
        完成后将支持：住房管理、子女教育、健康状况、生活质量等。
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
