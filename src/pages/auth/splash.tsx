/**
 * 启动页
 *
 * 「红头文件」式首屏：机关抬头 + 大标题 + 存档档案卡。
 * 可继续 / 开始新游戏 / 重新建档三个入口，兼容存档提示分级展示。
 */

import { Show } from 'solid-js';
import { navigate } from '../../router';
import { getStartupSaveResult, setForceNewGame } from '../../services/startup-save-state';
import { useGameStore } from '../../store/game-store';
import { formatDate } from '../../utils/format';

/**
 * 渲染游戏启动页。
 *
 * @returns 启动页内容。
 */
export function SplashPage() {
  const { state } = useGameStore();
  const saveResult = getStartupSaveResult();
  // 可继续状态从 Store 派生：有角色名和职位即可继续
  const hasSave = Boolean(state.character.characterName && state.career.appointment.positionId);
  const hasError =
    !hasSave &&
    (saveResult.status === 'legacy' ||
      saveResult.status === 'future' ||
      saveResult.status === 'corrupted');

  return (
    <div class="doc-scroll">
      <div class="doc-page" style={{ display: 'grid', 'place-items': 'center' }}>
        <section class="card" style={{ width: 'min(100%, 720px)' }}>
          <div class="card-pad" style={{ 'border-bottom': '2px solid var(--color-primary)' }}>
            <div class="doc-eyebrow">中共政途县委员会 · 政途县人民政府</div>
          </div>
          <div
            class="card-pad flex-col gap-lg center"
            style={{ padding: 'clamp(2rem, 6vw, 4rem)' }}
          >
            <h1
              class="serif"
              style={{
                'font-size': 'clamp(3rem, 9vw, 5.5rem)',
                'line-height': '1.1',
                'letter-spacing': '0.12em',
                color: 'var(--color-primary)',
                'text-align': 'center',
              }}
            >
              政途人生
            </h1>
            <p
              class="serif secondary-text"
              style={{ 'text-align': 'center', 'line-height': '1.9' }}
            >
              从一纸履历开始，处理政务、接受考核，在选择中书写自己的仕途。
            </p>

            <Show
              when={hasSave}
              fallback={
                <>
                  <Show when={hasError}>
                    <div
                      class={
                        saveResult.status === 'corrupted'
                          ? 'banner banner-danger'
                          : 'banner banner-warning'
                      }
                    >
                      <span class="flex-1">
                        <Show
                          when={saveResult.status === 'future'}
                          fallback={
                            <Show
                              when={saveResult.status === 'legacy'}
                              fallback={'存档数据损坏，无法加载。原始数据已保留为备份。'}
                            >
                              检测到旧版本存档。本次大型改版不支持继续使用该存档，请重新开始。
                              原始存档已保留为只读备份。
                            </Show>
                          }
                        >
                          检测到更新版本的存档。请更新客户端后再试。原始存档已保留，不会被覆盖。
                        </Show>
                      </span>
                    </div>
                  </Show>
                  <button
                    class="btn btn-primary btn-lg serif"
                    onClick={() => navigate('/character')}
                  >
                    开始新游戏 {'\u2192'}
                  </button>
                </>
              }
            >
              <div class="flex-col gap-sm" style={{ width: 'min(100%, 420px)' }}>
                <div class="doc-eyebrow">本地档案</div>
                <div class="card card-pad flex-col gap-sm">
                  <strong class="serif" style={{ 'font-size': '1.15rem' }}>
                    {state.character.characterName || '未命名角色'}
                  </strong>
                  <div class="flex gap-sm text-sm secondary-text">
                    <span>在任第 {state.time.totalDaysPlayed} 日</span>
                    <span>{formatDate(state.time.year, state.time.month, state.time.day)}</span>
                  </div>
                  <div class="flex gap-sm">
                    <button class="btn btn-primary" onClick={() => navigate('/main')}>
                      继续游戏 {'\u2192'}
                    </button>
                    <button
                      class="btn"
                      onClick={() => {
                        setForceNewGame(true);
                        navigate('/character');
                      }}
                    >
                      重新建档
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          </div>
          <footer
            class="card-pad flex between text-xs muted"
            style={{ 'border-top': '1px solid var(--border-color)' }}
          >
            <span>政途人生 · {__APP_VERSION__} · 本地存档</span>
            <span>治大国如烹小鲜</span>
          </footer>
        </section>
      </div>
    </div>
  );
}
