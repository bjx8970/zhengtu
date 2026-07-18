/**
 * 人脉网络页面 — Phase 3 实现
 *
 * 职责：
 * - 展示玩家社交关系图谱
 * - 管理各派系/同事关系
 * - 提供人脉拓展与维护行为
 */

import type { JSX } from 'solid-js';
import { pageBase } from '../../utils/theme';
import { navigate } from '../../router';

/**
 * 人脉网络页面组件（占位）
 *
 * @returns 占位 UI
 */
export function PositionRelations(): JSX.Element {
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
      <h2 style={{ margin: 0 }}>人脉网络</h2>
      <p style={{ color: '#666', 'text-align': 'center', 'line-height': '1.8' }}>
        此功能正在开发中，敬请期待。
        <br />
        完成后将支持：派系关系查看、同事网络、人脉拓展等。
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
