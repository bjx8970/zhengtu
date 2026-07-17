/**
 * KPI 考核页面
 *
 * 展示当前职位的 KPI 指标完成情况和考核等次。
 * 数据来源：ConfigLoader 获取职位指标 + calculateKPI() 计算当前状态。
 * 无当前职位时显示提示信息。
 */

import { useGameStore } from '../../store/game-store';
import { calculateKPI } from '../../engine/governance/kpi';
import { getConfigLoader } from '../../config/loader';
import { navigate } from '../../router';
import { formatPercent } from '../../utils/format';
import { createMemo, For, Show } from 'solid-js';
import type { KPIResult } from '../../types/game';
import { KPITier } from '../../types/enums';
import { colors, radius, pageBase, darkCardStyle } from '../../utils/theme';

/** 等次颜色映射 */
function tierStyle(tier: KPITier) {
  switch (tier) {
    case KPITier.Excellent:
      return { bg: colors.successLight, fg: colors.success };
    case KPITier.Competent:
      return { bg: colors.secondaryLight, fg: colors.secondary };
    case KPITier.Basic:
      return { bg: 'rgba(230, 168, 23, 0.15)', fg: colors.warning };
    default:
      return { bg: colors.primaryLight, fg: colors.primary };
  }
}

/** 进度条颜色 */
function barColor(rate: number): string {
  if (rate >= 1) return colors.success;
  if (rate >= 0.6) return colors.primary;
  return colors.danger;
}

export function PositionKPI() {
  const { state } = useGameStore();

  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    return getConfigLoader().getPosition(
      state.currentCareerLine,
      state.currentLevel,
      parseInt(posId.split('_').pop() ?? '0', 10),
    );
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

  return (
    <div style={pageBase}>
      {/* 顶部导航栏 */}
      <header
        style={{
          display: 'flex',
          'align-items': 'center',
          padding: '0.8rem 1rem',
          'border-bottom': `1px solid ${colors.border}`,
          gap: '0.8rem',
        }}
      >
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            background: 'none',
            color: colors.textSecondary,
            border: 'none',
            'font-size': '1.2rem',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ←
        </button>
        <div>
          <div style={{ 'font-size': '0.75rem', color: colors.textSecondary }}>{posName()}</div>
          <div style={{ 'font-size': '1rem', 'font-weight': 'bold' }}>KPI 考核</div>
        </div>
      </header>

      <div style={{ flex: 1, 'overflow-y': 'auto', padding: '1rem' }}>
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
          {/* 综合评分卡片 */}
          <Show when={kpiResult()}>
            {(result) => {
              const tierColors = tierStyle(result().tier);
              return (
                <div
                  style={{
                    ...darkCardStyle('1.2rem'),
                    display: 'flex',
                    'justify-content': 'space-around',
                    'margin-bottom': '1.2rem',
                  }}
                >
                  <div style={{ 'text-align': 'center' }}>
                    <div
                      style={{
                        'font-size': '0.75rem',
                        color: colors.textSecondary,
                        'margin-bottom': '0.4rem',
                      }}
                    >
                      综合得分
                    </div>
                    <div
                      style={{ 'font-size': '2rem', 'font-weight': 'bold', color: colors.primary }}
                    >
                      {result().totalScore.toFixed(0)}
                    </div>
                  </div>
                  <div style={{ 'text-align': 'center' }}>
                    <div
                      style={{
                        'font-size': '0.75rem',
                        color: colors.textSecondary,
                        'margin-bottom': '0.4rem',
                      }}
                    >
                      考核等次
                    </div>
                    <span
                      style={{
                        display: 'inline-block',
                        'font-size': '1rem',
                        'font-weight': 'bold',
                        padding: '0.25rem 0.8rem',
                        'border-radius': radius.md,
                        background: tierColors.bg,
                        color: tierColors.fg,
                      }}
                    >
                      {result().tier}
                    </span>
                  </div>
                </div>
              );
            }}
          </Show>

          {/* 指标列表 */}
          <Show when={kpiResult()}>
            {(result) => (
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
                <For each={result().indicators}>
                  {(indicator: KPIResult) => (
                    <div
                      style={{
                        ...darkCardStyle('0.8rem 1rem'),
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          'justify-content': 'space-between',
                          'align-items': 'center',
                          'margin-bottom': '0.5rem',
                        }}
                      >
                        <span style={{ 'font-size': '0.9rem' }}>{indicator.name}</span>
                        <span style={{ 'font-size': '0.8rem', color: colors.textSecondary }}>
                          {indicator.currentValue}
                          {indicator.weight > 0 ? ` / ${indicator.targetValue}` : ''}
                        </span>
                      </div>
                      {/* 完成率进度条 */}
                      <div
                        style={{
                          height: '5px',
                          'background-color': colors.border,
                          'border-radius': radius.sm,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(indicator.completionRate * 100, 100)}%`,
                            'background-color': barColor(indicator.completionRate),
                            'border-radius': radius.sm,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          'justify-content': 'space-between',
                          'margin-top': '0.4rem',
                          'font-size': '0.75rem',
                          color: colors.textSecondary,
                        }}
                      >
                        <span>完成率 {formatPercent(indicator.completionRate)}</span>
                        <span>得分 {indicator.weightedScore.toFixed(0)}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
