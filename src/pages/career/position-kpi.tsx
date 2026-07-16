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

/** 等次颜色映射（使用 KPITier 枚举确保类型安全） */
function tierColor(tier: KPITier): string {
  const map: Record<KPITier, string> = {
    [KPITier.Excellent]: '#4CAF50',
    [KPITier.Competent]: '#4A6FA5',
    [KPITier.Basic]: '#FF9800',
    [KPITier.Incompetent]: '#C44D4D',
  };
  return map[tier];
}

export function PositionKPI() {
  const { state } = useGameStore();

  /** 获取当前职位配置，缺失时返回 null */
  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    return getConfigLoader().getPosition(
      state.currentCareerLine,
      state.currentLevel,
      parseInt(posId.split('_').pop() ?? '0', 10),
    );
  });

  /** 计算 KPI 考核结果 */
  const kpiResult = createMemo(() => {
    const pos = positionConfig();
    if (!pos) return null;
    return calculateKPI(pos.kpiIndicators, state.departmentStates);
  });

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        'background-color': '#1a1a2e',
        color: '#e0e0e0',
      }}
    >
      {/* 顶部导航栏 */}
      <header
        style={{
          display: 'flex',
          'align-items': 'center',
          padding: '0.8rem 1rem',
          'border-bottom': '1px solid #333',
          gap: '0.8rem',
        }}
      >
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            'background-color': 'transparent',
            color: '#888',
            border: 'none',
            'font-size': '1.2rem',
            cursor: 'pointer',
          }}
        >
          ←
        </button>
        <div>
          <div style={{ 'font-size': '0.75rem', color: '#888' }}>
            {positionConfig()?.name ?? '未分配职位'}
          </div>
          <div style={{ 'font-size': '1rem', 'font-weight': 'bold' }}>考核指标</div>
        </div>
      </header>

      <div style={{ flex: 1, 'overflow-y': 'auto', padding: '1rem' }}>
        <Show
          when={positionConfig()}
          fallback={
            <div style={{ 'text-align': 'center', color: '#888', 'margin-top': '3rem' }}>
              尚未分配职位，无法显示考核指标。
            </div>
          }
        >
          {/* 综合评分 */}
          <Show when={kpiResult()}>
            {(result) => (
              <div
                style={{
                  display: 'flex',
                  'justify-content': 'space-around',
                  'margin-bottom': '1.5rem',
                  padding: '1rem',
                  'background-color': '#16213e',
                  'border-radius': '10px',
                }}
              >
                <div style={{ 'text-align': 'center' }}>
                  <div style={{ 'font-size': '0.75rem', color: '#888', 'margin-bottom': '0.3rem' }}>
                    综合得分
                  </div>
                  <div style={{ 'font-size': '2rem', 'font-weight': 'bold', color: '#4A6FA5' }}>
                    {result().totalScore.toFixed(0)}
                  </div>
                </div>
                <div style={{ 'text-align': 'center' }}>
                  <div style={{ 'font-size': '0.75rem', color: '#888', 'margin-bottom': '0.3rem' }}>
                    考核等次
                  </div>
                  <div
                    style={{
                      'font-size': '1.5rem',
                      'font-weight': 'bold',
                      color: tierColor(result().tier),
                    }}
                  >
                    {result().tier}
                  </div>
                </div>
              </div>
            )}
          </Show>

          {/* 指标列表 */}
          <Show when={kpiResult()}>
            {(result) => (
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.6rem' }}>
                <For each={result().indicators}>
                  {(indicator: KPIResult) => (
                    <div
                      style={{
                        padding: '0.8rem 1rem',
                        'background-color': '#16213e',
                        'border-radius': '8px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          'justify-content': 'space-between',
                          'align-items': 'center',
                          'margin-bottom': '0.4rem',
                        }}
                      >
                        <span style={{ 'font-size': '0.9rem' }}>{indicator.name}</span>
                        <span style={{ 'font-size': '0.85rem', color: '#888' }}>
                          {indicator.currentValue}
                          {indicator.weight > 0 ? ' / ' : ''}
                          {indicator.weight > 0 ? indicator.targetValue : ''}
                        </span>
                      </div>
                      {/* 完成率进度条 */}
                      <div
                        style={{
                          height: '6px',
                          'background-color': '#2a2a4a',
                          'border-radius': '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(indicator.completionRate * 100, 100)}%`,
                            'background-color':
                              indicator.completionRate >= 1
                                ? '#4CAF50'
                                : indicator.completionRate >= 0.6
                                  ? '#4A6FA5'
                                  : '#C44D4D',
                            'border-radius': '3px',
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          'justify-content': 'space-between',
                          'margin-top': '0.3rem',
                          'font-size': '0.75rem',
                          color: '#888',
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
