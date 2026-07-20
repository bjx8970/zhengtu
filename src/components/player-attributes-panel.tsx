/**
 * 玩家属性面板——仪表盘组件
 *
 * 展示九大基础属性（值+进度条）和三项资源指标。
 * 遵循军政公文 UI 风格：土黄暖灰底色 + 藏蓝/暗红强调色。
 */

import { For } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { ATTR_LABELS } from '../utils/theme';
import { colors, font } from '../utils/theme';

const ATTR_KEYS = [
  'vigor',
  'integrity',
  'stability',
  'competence',
  'charisma',
  'network',
  'diligence',
  'ambition',
  'performance',
] as const;

const ATTR_COLORS: Record<string, string> = {
  vigor: '#4caf50',
  integrity: '#284b70',
  stability: '#284b70',
  competence: '#3b7f8f',
  charisma: '#b78324',
  network: '#b78324',
  diligence: '#3b7f8f',
  ambition: '#b3262d',
  performance: '#7b68ee',
};

const ATTR_MAX: Record<string, number> = {
  performance: 9999,
};

/**
 * 玩家属性面板组件。
 *
 * @returns 属性面板 JSX
 */
export function PlayerAttributesPanel() {
  const { state } = useGameStore();

  return (
    <section
      style={{
        background: colors.bgCard,
        border: `1px solid ${colors.border}`,
        'border-radius': '8px',
        padding: '18px 20px',
        'margin-top': '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          'margin-bottom': '14px',
        }}
      >
        <div>
          <h2 style={{ 'font-size': '16px', 'font-weight': 700, 'font-family': font.title }}>
            个人属性
          </h2>
          <p style={{ 'font-size': '12px', color: colors.textMuted, 'margin-top': '2px' }}>
            属性影响行动成效、考核评价与晋升表决
          </p>
        </div>
        <div style={{ 'font-size': '12px', color: colors.textMuted, 'text-align': 'right' }}>
          政治资本 {state.politicalCapital ?? 0} · 预算余量{' '}
          {(state.remainingBudget ?? 0).toLocaleString()} 万
        </div>
      </div>

      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(3, 1fr)', gap: '10px' }}>
        <For each={ATTR_KEYS}>
          {(key) => {
            const max = ATTR_MAX[key] ?? 100;
            const raw = (state as unknown as Record<string, number>)[key] ?? 0;
            const pct = Math.min((raw / max) * 100, 100);
            const barColor = pct >= 80 ? '#4caf50' : pct >= 40 ? '#3b7f8f' : '#c44d4d';
            const label = ATTR_LABELS[key] ?? key;
            return (
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  'border-radius': '4px',
                  background: '#f9f7f2',
                  border: '1px solid #ece8de',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    'border-radius': '6px',
                    display: 'grid',
                    'place-items': 'center',
                    'font-family': font.title,
                    'font-size': '16px',
                    'font-weight': 700,
                    color: '#fff',
                    'flex-shrink': 0,
                    background: ATTR_COLORS[key] ?? colors.secondary,
                  }}
                >
                  {label.charAt(0)}
                </div>
                <div style={{ flex: 1, 'min-width': 0 }}>
                  <div
                    style={{
                      'font-size': '12px',
                      color: colors.textSecondary,
                      'margin-bottom': '3px',
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
                    <div
                      style={{
                        flex: 1,
                        height: '6px',
                        'border-radius': '3px',
                        background: '#e8e4dc',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          'border-radius': '3px',
                          width: `${pct}%`,
                          background: barColor,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        'font-size': '13px',
                        'font-weight': 600,
                        'min-width': '28px',
                        'text-align': 'right',
                      }}
                    >
                      {raw}
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          'margin-top': '12px',
          'padding-top': '12px',
          'border-top': `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '8px 12px',
            'border-radius': '4px',
            background: '#f9f7f2',
          }}
        >
          <span style={{ 'font-size': '12px', color: colors.textSecondary }}>政治资本</span>
          <span
            style={{
              'font-size': '16px',
              'font-weight': 700,
              'font-family': font.title,
              color: colors.warning,
            }}
          >
            {state.politicalCapital ?? 0}
          </span>
          <span style={{ 'font-size': '11px', color: colors.textMuted }}>/500</span>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '8px 12px',
            'border-radius': '4px',
            background: '#f9f7f2',
          }}
        >
          <span style={{ 'font-size': '12px', color: colors.textSecondary }}>剩余预算</span>
          <span
            style={{
              'font-size': '16px',
              'font-weight': 700,
              'font-family': font.title,
              color: colors.secondary,
            }}
          >
            {(state.remainingBudget ?? 0).toLocaleString()}
          </span>
          <span style={{ 'font-size': '11px', color: colors.textMuted }}>万</span>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '8px 12px',
            'border-radius': '4px',
            background: '#f9f7f2',
          }}
        >
          <span style={{ 'font-size': '12px', color: colors.textSecondary }}>冻结周期</span>
          <span
            style={{
              'font-size': '16px',
              'font-weight': 700,
              'font-family': font.title,
              color: colors.danger,
            }}
          >
            {state.frozenPeriods ?? 0}
          </span>
          <span style={{ 'font-size': '11px', color: colors.textMuted }}>届</span>
        </div>
      </div>
    </section>
  );
}
