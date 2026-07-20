/**
 * 从政理念面板——仪表盘组件
 *
 * 展示三种从政理念风格评分：开拓创新、实干务实、稳健守正。
 * 分数映射为五级标签（薄弱/一般/均衡/突出/卓越）。
 */

import { For } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { colors, font } from '../utils/theme';

const STYLE_CONFIG: { key: string; name: string; color: string }[] = [
  { key: 'innovation', name: '开拓创新', color: '#3b7f8f' },
  { key: 'pragmatic', name: '实干务实', color: '#b78324' },
  { key: 'principled', name: '稳健守正', color: '#284b70' },
];

/**
 * 根据分数返回对应的五级标签。
 *
 * @param score 风格评分（0~100）
 * @returns 中文等级标签
 */
function scoreLabel(score: number): string {
  if (score <= 20) return '薄弱';
  if (score <= 40) return '一般';
  if (score <= 60) return '均衡';
  if (score <= 80) return '突出';
  return '卓越';
}

/**
 * 根据分数返回对应的标签颜色。
 *
 * @param score 风格评分（0~100）
 * @returns 颜色 hex 值
 */
function labelColor(score: number): string {
  if (score <= 20) return '#8d939b';
  if (score <= 40) return '#657080';
  if (score <= 60) return '#284b70';
  if (score <= 80) return '#b78324';
  return '#4caf50';
}

/**
 * 从政理念面板组件。
 *
 * @returns 风格评分卡片 JSX
 */
export function PhilosophyPanel() {
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
      <h2 style={{ 'font-size': '16px', 'font-weight': 700, 'font-family': font.title }}>
        从政理念
      </h2>
      <p style={{ 'font-size': '12px', color: colors.textMuted, 'margin-top': '4px' }}>
        风格标签反映施政倾向，非派系归属。行动选择与年度考核会影响风格评分。
      </p>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(3, 1fr)',
          gap: '12px',
          'margin-top': '12px',
        }}
      >
        <For each={STYLE_CONFIG}>
          {(style) => {
            const score = Math.round((state.philosophy.scores[style.key] as number) ?? 0);
            const tier = scoreLabel(score);
            const tierColor = labelColor(score);
            return (
              <div
                style={{
                  'text-align': 'center',
                  padding: '12px 8px',
                  border: `1px solid ${colors.border}`,
                  'border-radius': '8px',
                  background: '#fff',
                }}
              >
                <div
                  style={{ 'font-size': '12px', color: colors.textMuted, 'margin-bottom': '6px' }}
                >
                  {style.name}
                </div>
                <div
                  style={{
                    'font-size': '22px',
                    'font-weight': 700,
                    'font-family': font.title,
                    color: style.color,
                  }}
                >
                  {score}
                </div>
                <span
                  style={{
                    display: 'inline-block',
                    'margin-top': '4px',
                    padding: '2px 8px',
                    'border-radius': '12px',
                    'font-size': '11px',
                    'font-weight': 600,
                    color: tierColor,
                    background: `${tierColor}15`,
                  }}
                >
                  {tier}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
}
