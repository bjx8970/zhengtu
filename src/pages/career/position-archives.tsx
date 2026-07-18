/**
 * 档案成就页面 — Phase 3 实现
 *
 * 职责：
 * - 展示已解锁的成就与里程碑
 * - 查看历任职位履历
 * - 展示个人统计与荣誉
 */

import type { JSX } from 'solid-js';
import { pageBase } from '../../utils/theme';
import { navigate } from '../../router';

/**
 * 档案成就页面组件（占位）
 *
 * @returns 占位 UI
 */
export function PositionArchives(): JSX.Element {
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
      <h2 style={{ margin: 0 }}>档案成就</h2>
      <p style={{ color: '#666', 'text-align': 'center', 'line-height': '1.8' }}>
        此功能正在开发中，敬请期待。
        <br />
        完成后将支持：成就展示、职位履历、个人统计、荣誉墙等。
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
