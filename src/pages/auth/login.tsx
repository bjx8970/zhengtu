/**
 * 登录页（Phase 5 预留）
 *
 * 当前路由未注册，游戏仅使用本地存档。
 * Phase 5 接入 Supabase Auth 时重新设计并启用。
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
