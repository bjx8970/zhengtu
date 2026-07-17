/**
 * 启动页
 *
 * 游戏首次加载时的欢迎页面。
 * 显示竖排标题和"进入游戏"按钮，点击后跳转到登录页。
 */

import { navigate } from '../../router';
import { colors, radius, font, pageBase } from '../../utils/theme';

export function SplashPage() {
  return (
    <div
      style={{
        ...pageBase,
        'align-items': 'center',
        'justify-content': 'center',
      }}
    >
      {/* 竖排标题 */}
      <div
        style={{
          display: 'flex',
          'writing-mode': 'vertical-rl',
          'font-size': '3rem',
          'font-weight': 'bold',
          'font-family': font.title,
          color: colors.primary,
          'letter-spacing': '0.5rem',
          'margin-bottom': '2rem',
        }}
      >
        政途人生
      </div>

      <div
        style={{
          'font-size': '0.95rem',
          color: colors.textSecondary,
          'margin-bottom': '3rem',
          'font-family': font.title,
        }}
      >
        仕途模拟 · v3.0
      </div>

      {/* 装饰语 */}
      <div
        style={{
          'font-size': '0.85rem',
          color: colors.primary,
          opacity: 0.6,
          'margin-bottom': '2rem',
          'font-family': font.title,
        }}
      >
        —— 治大国如烹小鲜 ——
      </div>

      <button
        onClick={() => navigate('/login')}
        style={{
          padding: '0.8rem 3.5rem',
          'font-size': '1.1rem',
          'font-family': font.title,
          'background-color': colors.primary,
          color: colors.primaryText,
          border: 'none',
          'border-radius': radius.md,
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
      >
        进入游戏
      </button>
    </div>
  );
}
