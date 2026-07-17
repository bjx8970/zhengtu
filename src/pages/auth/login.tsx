/**
 * 登录页（Phase 0 占位）
 *
 * 当前为开发模式跳过登录的占位页面。
 * Phase 1 将接入 Supabase Auth（手机号 + 验证码）。
 * 点击按钮跳转到建档系统。
 */

import { navigate } from '../../router';
import { createSignal } from 'solid-js';
import { colors, radius, pageBase } from '../../utils/theme';

export function LoginPage() {
  const [phone, setPhone] = createSignal('');

  const goToCharacter = () => navigate('/character');

  return (
    <div
      style={{
        ...pageBase,
        'align-items': 'center',
        'justify-content': 'center',
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
          'border-radius': radius.md,
          border: `1px solid ${colors.border}`,
          'background-color': colors.bgCard,
          color: colors.textPrimary,
          width: '260px',
          outline: 'none',
        }}
      />

      <button
        onClick={goToCharacter}
        style={{
          padding: '0.6rem 2rem',
          'font-size': '1rem',
          'background-color': colors.primary,
          color: colors.primaryText,
          border: 'none',
          'border-radius': radius.md,
          cursor: 'pointer',
          width: '260px',
        }}
      >
        获取验证码
      </button>

      <div style={{ 'margin-top': '0.5rem' }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            goToCharacter();
          }}
          style={{ color: colors.textSecondary, 'font-size': '0.9rem' }}
        >
          跳过登录（开发模式）
        </a>
      </div>
    </div>
  );
}
