/**
 * 启动页
 *
 * 游戏首次加载时的欢迎页面。
 * 显示 Logo 和"进入游戏"按钮，点击后跳转到登录页。
 */

import { navigate } from '../../router';

export function SplashPage() {
  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        height: '100%',
        'background-color': '#1a1a2e',
        color: '#e0e0e0',
      }}
    >
      <div style={{ 'font-size': '2.5rem', 'font-weight': 'bold', 'margin-bottom': '0.5rem' }}>
        政途人生
      </div>
      <div style={{ 'font-size': '1rem', color: '#888', 'margin-bottom': '3rem' }}>
        v3.0 — 仕途模拟游戏
      </div>
      <button
        onClick={() => navigate('/login')}
        style={{
          padding: '0.8rem 3rem',
          'font-size': '1.1rem',
          'background-color': '#4A6FA5',
          color: '#fff',
          border: 'none',
          'border-radius': '8px',
          cursor: 'pointer',
        }}
      >
        进入游戏
      </button>
    </div>
  );
}
