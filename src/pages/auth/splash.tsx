/**
 * 启动页。
 *
 * 用档案封面式首屏建立新版政务工作台的视觉基调。
 */

import { Show } from 'solid-js';
import { navigate } from '../../router';
import { startupSaveResult } from '../../main';
import { useGameStore } from '../../store/game-store';
import { formatDate } from '../../utils/format';
import { font } from '../../utils/theme';

/**
 * 渲染游戏启动页。
 *
 * @returns 启动页内容。
 */
export function SplashPage() {
  const { state } = useGameStore();
  const hasSave = startupSaveResult.status === 'loaded';
  const isIncompatible =
    startupSaveResult.status === 'incompatible' || startupSaveResult.status === 'corrupted';

  return (
    <main class="document-page" style={{ display: 'grid', 'place-items': 'center' }}>
      <section class="document-shell document-card" style={{ padding: 'clamp(2rem, 8vw, 6rem)' }}>
        <div class="eyebrow">ZHENGTU · CAREER SIMULATION</div>
        <div
          style={{
            display: 'flex',
            gap: 'clamp(1.5rem, 6vw, 5rem)',
            'align-items': 'center',
            'margin-top': '2rem',
          }}
        >
          <h1
            style={{
              'font-family': font.title,
              'font-size': 'clamp(3.4rem, 10vw, 7rem)',
              'line-height': '0.95',
              color: 'var(--color-primary)',
              'letter-spacing': '0.08em',
            }}
          >
            政途
            <br />
            人生
          </h1>
          <div
            style={{
              'max-width': '28rem',
              'border-left': '1px solid var(--border-color)',
              'padding-left': 'clamp(1.2rem, 4vw, 3rem)',
            }}
          >
            <p
              style={{
                'font-family': font.title,
                'font-size': 'clamp(1.15rem, 3vw, 1.6rem)',
                'line-height': '1.8',
              }}
            >
              从一纸履历开始，处理政务、接受考核，在选择中书写自己的仕途。
            </p>
            <p
              style={{
                color: 'var(--text-secondary)',
                'font-size': '0.85rem',
                'line-height': '1.8',
                'margin-top': '1rem',
              }}
            >
              基于全新行动槽与阶段结算系统重写。旧版深度系统将随开发进度逐步接入。
            </p>
            <Show
              when={hasSave}
              fallback={
                <>
                  <Show when={isIncompatible}>
                    <div
                      style={{
                        padding: '0.9rem 1rem',
                        border: '1px solid #e5a00d',
                        'border-left': '3px solid #e5a00d',
                        background: 'rgba(229, 160, 13, 0.08)',
                        'margin-top': '1rem',
                        'font-size': '0.85rem',
                        'line-height': '1.6',
                      }}
                    >
                      检测到旧版本存档。本次大型改版不支持继续使用该存档，请重新开始。
                      原始存档已保留为只读备份。
                    </div>
                  </Show>
                  <button
                    class="primary-action"
                    onClick={() => navigate('/character')}
                    style={{ padding: '0.85rem 2.2rem', 'margin-top': '2rem' }}
                  >
                    开始新游戏 →
                  </button>
                </>
              }
            >
              <div style={{ 'margin-top': '1.5rem' }}>
                <div
                  style={{
                    padding: '0.9rem 1rem',
                    border: '1px solid var(--border-color)',
                    'border-left': '3px solid var(--color-secondary)',
                    background: 'rgba(255, 255, 255, 0.55)',
                  }}
                >
                  <div class="eyebrow">LOCAL ARCHIVE</div>
                  <strong style={{ display: 'block', 'margin-top': '0.35rem' }}>
                    {state.characterName || '未命名角色'} · L{state.currentLevel}
                  </strong>
                  <span style={{ color: 'var(--text-secondary)', 'font-size': '0.76rem' }}>
                    {formatDate(state.time.year, state.time.month, state.time.day)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.65rem', 'margin-top': '0.8rem' }}>
                  <button
                    class="primary-action"
                    onClick={() => navigate('/main')}
                    style={{ padding: '0.8rem 1.5rem' }}
                  >
                    继续游戏 →
                  </button>
                  <button
                    onClick={() => navigate('/character')}
                    style={{
                      padding: '0.8rem 1.2rem',
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    重新建档
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
        <footer
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            color: 'var(--text-muted)',
            'font-size': '0.72rem',
            'margin-top': '4rem',
            'padding-top': '1rem',
            'border-top': '1px solid var(--border-color-light)',
          }}
        >
          <span>重写版 · v3 · 本地存档</span>
          <span>治大国如烹小鲜</span>
        </footer>
      </section>
    </main>
  );
}
