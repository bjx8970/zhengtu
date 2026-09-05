/**
 * KPI 考核页
 *
 * 展示完整 KPI 指标构成、分数来源和改进方向。
 * 双列布局：
 * - 左侧：指标得分列表（含进度条与等级徽章）
 * - 右侧：改进建议 + 晋升阈值
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { PageHeader } from '../../components/page-header';
import { calculateKPI } from '../../engine/governance/kpi';
import { getConfigLoader } from '../../config/loader';
import { formatNumber } from '../../utils/format';
import { KPITier } from '../../types/enums';
import { meterFillClass } from '../../utils/theme';

/** 考核等级 → 标签类名 */
function tierTagClass(tier: KPITier): string {
  switch (tier) {
    case KPITier.Excellent:
      return 'tag tag-green';
    case KPITier.Competent:
      return 'tag tag-blue';
    case KPITier.Basic:
      return 'tag tag-warning';
    default:
      return 'tag tag-danger';
  }
}

/**
 * KPI 考核页组件。
 *
 * @returns KPI 考核页 JSX
 */
export function AssessmentPage() {
  const { state } = useGameStore();

  const positionConfig = createMemo(() => {
    const posId = state.career.appointment.positionId;
    if (!posId) return null;
    return getConfigLoader().getPositionById(posId);
  });

  const kpiResult = createMemo(() => {
    const pos = positionConfig();
    if (!pos) return null;
    return calculateKPI(
      getConfigLoader().resolvePositionKpis(pos.id),
      state.actions.departmentStates,
      getConfigLoader().getGameConfig(),
    );
  });

  const kpiScoreDisplay = createMemo(() => {
    const r = kpiResult();
    if (!r) return { text: 'N/A', score: 0 };
    return { text: formatNumber(r.totalScore, 1), score: r.totalScore };
  });
  const posName = createMemo(() => positionConfig()?.name ?? '未分配职位');
  const hasBadIndicators = createMemo(
    () => kpiResult()?.indicators.some((i) => i.completionRate < 0.5) ?? false,
  );

  return (
    <>
      <PageHeader
        eyebrow="考核 · ASSESSMENT"
        title="KPI 考核"
        meta={posName()}
        desc="查看指标完成度、得分与改进建议"
      />
      <Show
        when={positionConfig()}
        fallback={
          <div class="card center secondary-text" style={{ padding: '3rem 0' }}>
            尚未分配职位，无法显示考核指标。
          </div>
        }
      >
        <div
          class="responsive-col"
          style={{
            display: 'grid',
            'grid-template-columns': 'minmax(0, 1fr) minmax(300px, 0.72fr)',
            gap: 'var(--space-lg)',
          }}
        >
          {/* 左侧：指标得分 */}
          <section class="card">
            <div class="card-title">
              <span class="card-title-mark" aria-hidden="true" />
              指标得分
              <span class="flex-1" />
              <Show when={kpiResult()}>
                {(result) => <span class={tierTagClass(result().tier)}>{result().tier}</span>}
              </Show>
            </div>
            <div class="card-pad flex-col gap-md">
              <p class="doc-meta">当前总分 {kpiScoreDisplay().text}</p>
              <Show when={kpiResult()}>
                {(result) => (
                  <div class="flex-col gap-sm">
                    <For each={result().indicators}>
                      {(indicator) => (
                        <div class="flex gap-md center">
                          <b class="text-sm" style={{ width: '96px', 'flex-shrink': 0 }}>
                            {indicator.name}
                          </b>
                          <div class="meter flex-1">
                            <i
                              class={meterFillClass(indicator.completionRate)}
                              style={{ width: `${Math.min(indicator.completionRate * 100, 100)}%` }}
                              aria-hidden="true"
                            />
                          </div>
                          <span class="text-sm" style={{ width: '44px', 'text-align': 'right' }}>
                            {indicator.currentValue}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          </section>

          {/* 右侧：改进建议 + 晋升阈值 */}
          <div class="flex-col gap-lg">
            <section class="card">
              <div class="card-title">
                <span class="card-title-mark" aria-hidden="true" />
                改进建议
              </div>
              <div class="card-pad">
                <Show
                  when={hasBadIndicators()}
                  fallback={<p class="text-sm secondary-text">所有指标表现良好，继续保持。</p>}
                >
                  <p class="banner banner-warning">
                    有指标完成率偏低，建议优先安排对应部门的行动来提升。
                  </p>
                </Show>
              </div>
            </section>

            <Show when={kpiResult()}>
              {(result) => (
                <section class="card">
                  <div class="card-title">
                    <span class="card-title-mark" aria-hidden="true" />
                    晋升阈值
                  </div>
                  <div class="card-pad flex-col gap-sm">
                    <p class="text-sm secondary-text">
                      建议总分达到 82 以上后，再推进组织考察阶段。
                    </p>
                    <div class="flex gap-sm">
                      <span class="tag tag-gray">当前 {formatNumber(result().totalScore, 1)}</span>
                      <span class="tag tag-gold">目标 82</span>
                    </div>
                  </div>
                </section>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
}
