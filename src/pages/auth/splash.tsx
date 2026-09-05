/**
 * 启动页
 *
 * 两栏封面式首屏：游戏品牌、仕途寄语、建筑插画与存档档案卡。
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
    <main class="doc-scroll">
      <div class="splash-screen">
        <header class="splash-top">
          <div class="splash-brand">
            <span class="brand-seal">政</span>政途人生
          </div>
          <span>公务员职业生涯模拟</span>
        </header>
        <section class="splash-cover">
          <div class="splash-copy">
            <div class="splash-kicker">YOUR CHOICES. YOUR JOURNEY.</div>
            <h1>
              一纸履历，<span>万里政途。</span>
            </h1>
            <p class="splash-description">
              从基层的第一份工作开始，处理政务、接受考核，在每一次选择中，书写属于你的人生。
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
              <div class="flex-col gap-sm splash-archive">
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
            <div class="splash-details">
              <span>角色自由建档</span>
              <span>真实工作日程</span>
              <span>本地保存进度</span>
            </div>
          </div>
          <div class="splash-illustration" aria-hidden="true">
            <div class="welcome-art">
              <span class="art-orbit" />
              <span class="art-building building-back" />
              <span class="art-building building-front" />
              <span class="art-tree" />
              <span class="art-ground" />
            </div>
            <div class="splash-quote">
              心有所向，行有所至。<small>A JOURNEY OF A THOUSAND MILES</small>
            </div>
          </div>
        </section>
        <footer class="splash-bottom">
          <span>政途人生 · {__APP_VERSION__} · 本地存档</span>
          <span>治大国如烹小鲜</span>
        </footer>
      </div>
    </main>
  );
}
