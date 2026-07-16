/**
 * 登录页（Phase 0 占位）
 *
 * 当前为开发模式跳过登录的占位页面。
 * Phase 1 将接入 Supabase Auth（手机号 + 验证码）。
 * 点击"跳过登录"直接进入仪表盘。
 */

import { navigate } from '../../router';
import { createSignal } from 'solid-js';

export function LoginPage() {
  const [phone, setPhone] = createSignal('');

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
        gap: '1rem',
      }}
    >
      <div style={{ 'font-size': '1.5rem', 'margin-bottom': '2rem' }}>登录</div>
      <input
        type="tel"
        placeholder="手机号"
        value={phone()}
        onInput={(e) => setPhone(e.currentTarget.value)}
        style={{
          padding: '0.6rem 1rem',
          'font-size': '1rem',
          'border-radius': '6px',
          border: '1px solid #555',
          'background-color': '#16213e',
          color: '#e0e0e0',
          width: '260px',
        }}
      />
      <button
        onClick={() => navigate('/dashboard')}
        style={{
          padding: '0.6rem 2rem',
          'font-size': '1rem',
          'background-color': '#4A6FA5',
          color: '#fff',
          border: 'none',
          'border-radius': '6px',
          cursor: 'pointer',
          width: '260px',
        }}
      >
        获取验证码
      </button>
      <div style={{ 'margin-top': '1rem' }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('/dashboard');
          }}
          style={{ color: '#888', 'font-size': '0.9rem' }}
        >
          跳过登录（开发模式）
        </a>
      </div>
    </div>
  );
}
