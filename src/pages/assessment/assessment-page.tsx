/**
 * KPI 考核页
 *
 * 展示完整 KPI 指标构成、分数来源和改进方向。
 * 双列布局：
 * - 左侧：指标得分列表（含进度条）
 * - 右侧：改进建议 + 晋升阈值
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { AppShell } from '../../components/app-shell';
import { calculateKPI } from '../../engine/governance/kpi';
import { getConfigLoader } from '../../config/loader';
import { parsePositionIndex } from '../../utils/position';
import { formatNumber } from '../../utils/format';
import { KPITier } from '../../types/enums';
import type { KPIResult } from '../../types/game';
import {
  colors,
  font,
  meterContainer,
  pillStyle,
  darkCardStyle,
  progressBarColor,
} from '../../utils/theme';

function tierStyle(tier: KPITier) {
  switch (tier) {
    case KPITier.Excellent:
      return { bg: colors.successLight, fg: colors.success };
    case KPITier.Competent:
      return { bg: colors.secondaryLight, fg: colors.secondary };
    case KPITier.Basic:
      return { bg: colors.warningLight, fg: colors.warning };
    default:
      return { bg: colors.primaryLight, fg: colors.primary };
  }
}

export function AssessmentPage() {
  const { state } = useGameStore();

  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    const idx = parsePositionIndex(posId);
    if (idx === null) return null;
    return getConfigLoader().getPosition(state.currentCareerLine, state.currentLevel, idx);
  });

  const kpiResult = createMemo(() => {
    const pos = positionConfig();
    if (!pos) return null;
    return calculateKPI(
      pos.kpiIndicators,
      state.departmentStates,
      getConfigLoader().getGameConfig(),
    );
  });

  const posName = createMemo(() => positionConfig()?.name ?? '未分配职位');
  const hasBadIndicators = createMemo(
    () => kpiResult()?.indicators.some((i) => i.completionRate < 0.5) ?? false,
  );

  return (
    <AppShell activeTab={3}>
      <Show
        when={positionConfig()}
        fallback={
          <div
            style={{ 'text-align': 'center', color: colors.textSecondary, 'margin-top': '3rem' }}
          >
            尚未分配职位，无法显示考核指标。
          </div>
        }
      >
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'minmax(0, 1fr) minmax(300px, 0.72fr)',
            gap: '16px',
          }}
        >
          {/* 左侧：指标得分 */}
          <article style={{ ...darkCardStyle('16px') }}>
            <div
              style={{
                display: 'flex',
                'justify-content': 'space-between',
                gap: '12px',
                'align-items': 'flex-start',
                'margin-bottom': '14px',
              }}
            >
              <div>
                <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>指标得分</h3>
                <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
                  {posName()} · 当前总分{' '}
                  {kpiResult() ? formatNumber(kpiResult()!.totalScore, 1) : 'N/A'}
                </p>
              </div>
              <Show when={kpiResult()}>
                {(result) => {
                  const ts = tierStyle(result().tier);
                  return <span style={pillStyle(ts.bg, ts.fg)}>{result().tier}</span>;
                }}
              </Show>
            </div>
            <div style={{ display: 'grid', gap: '12px' }}>
              <Show when={kpiResult()}>
                {(result) => (
                  <For each={result().indicators}>
                    {(indicator: KPIResult) => (
                      <div
                        style={{
                          display: 'grid',
                          'grid-template-columns': '112px minmax(0, 1fr) 44px',
                          gap: '10px',
                          'align-items': 'center',
                        }}
                      >
                        <b style={{ 'font-size': '13px' }}>{indicator.name}</b>
                        <div style={meterContainer()}>
                          <div
                            style={{
                              height: '100%',
                              'border-radius': 'inherit',
                              background: progressBarColor(indicator.completionRate),
                              width: `${Math.min(indicator.completionRate * 100, 100)}%`,
                            }}
                          />
                        </div>
                        <span style={{ 'font-size': '13px', 'text-align': 'right' }}>
                          {indicator.currentValue}
                        </span>
                      </div>
                    )}
                  </For>
                )}
              </Show>
            </div>
          </article>

          {/* 右侧：改进建议 */}
          <article style={{ ...darkCardStyle('16px') }}>
            <div style={{ 'margin-bottom': '14px' }}>
              <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>改进建议</h3>
              <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
                把建议留在 KPI 页，主页只给提醒。
              </p>
            </div>
            <Show
              when={hasBadIndicators()}
              fallback={
                <div style={{ color: colors.textMuted, 'font-size': '13px' }}>
                  所有指标表现良好，继续保持。
                </div>
              }
            >
              <div
                style={{
                  padding: '12px 14px',
                  'border-left': `3px solid ${colors.gold}`,
                  background: `rgba(183,131,36,0.1)`,
                  color: '#5e4825',
                  'font-size': '13px',
                  'line-height': '1.65',
                }}
              >
                有指标完成率偏低，建议优先安排对应部门的行动来提升。
              </div>
            </Show>

            <Show when={kpiResult()}>
              {(result) => (
                <div
                  style={{
                    padding: '15px',
                    border: `1px solid ${colors.border}`,
                    'border-radius': '8px',
                    background: '#fff',
                    'margin-top': '12px',
                  }}
                >
                  <h3 style={{ 'font-size': '16px' }}>晋升阈值</h3>
                  <p
                    style={{
                      'margin-top': '8px',
                      color: colors.textMuted,
                      'font-size': '13px',
                      'line-height': '1.6',
                    }}
                  >
                    建议总分达到 82 以上后，再推进组织考察阶段。
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      'flex-wrap': 'wrap',
                      gap: '7px',
                      'margin-top': '12px',
                    }}
                  >
                    <span
                      style={{
                        padding: '4px 7px',
                        'border-radius': '999px',
                        background: colors.bgSoft,
                        color: colors.textMuted,
                        'font-size': '12px',
                        'font-weight': 800,
                      }}
                    >
                      当前 {formatNumber(result().totalScore, 1)}
                    </span>
                    <span
                      style={{
                        padding: '4px 7px',
                        'border-radius': '999px',
                        background: colors.bgSoft,
                        color: colors.textMuted,
                        'font-size': '12px',
                        'font-weight': 800,
                      }}
                    >
                      目标 82
                    </span>
                  </div>
                </div>
              )}
            </Show>
          </article>
        </div>
      </Show>

      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
