/**
 * Step 3 — 高考成绩（随机生成 + 重掷）
 */
import { Show } from 'solid-js';
import { colors, radius, font, cardStyle } from '../../utils/theme';
import type { CharacterData } from '../../types/character';
import type { ProvinceConfig } from '../../types/config';

interface StepGaokaoProps {
  data: CharacterData;
  province: ProvinceConfig;
  gaokaoYear: number;
  rollGaokao: (province: ProvinceConfig) => void;
}

export function StepGaokao(props: StepGaokaoProps) {
  const prov = props.province;

  return (
    <div
      style={{ ...cardStyle('2rem'), width: '100%', 'max-width': '340px', 'text-align': 'center' }}
    >
      <div
        style={{ 'font-size': '0.85rem', color: colors.textSecondary, 'margin-bottom': '0.5rem' }}
      >
        {prov.name} · {props.gaokaoYear}年
      </div>
      <Show
        when={props.data.gaokaoScore > 0}
        fallback={
          <button
            onClick={() => props.rollGaokao(prov)}
            style={{
              padding: '1rem 2rem',
              'font-size': '1.1rem',
              'background-color': colors.primary,
              color: colors.primaryText,
              border: 'none',
              'border-radius': radius.md,
              cursor: 'pointer',
              'font-family': font.title,
            }}
          >
            🎲 生成高考成绩
          </button>
        }
      >
        <div
          style={{
            'font-size': '3rem',
            'font-weight': 'bold',
            color: colors.primary,
            'font-family': font.title,
            'margin-bottom': '0.5rem',
          }}
        >
          {props.data.gaokaoScore}
        </div>
        <div
          style={{
            display: 'inline-block',
            padding: '0.3rem 1.2rem',
            'border-radius': radius.md,
            'background-color': colors.primaryLight,
            color: colors.primary,
            'font-weight': 'bold',
            'font-size': '1.1rem',
            'margin-bottom': '0.8rem',
          }}
        >
          {props.data.gaokaoTier} 档
        </div>
        {prov.ethnicBonus > 0 && (
          <div style={{ 'font-size': '0.8rem', color: colors.primary, 'margin-bottom': '0.5rem' }}>
            含民族加分 +{prov.ethnicBonus} 分
          </div>
        )}
        <div
          style={{ 'font-size': '0.78rem', color: colors.textSecondary, 'margin-bottom': '0.5rem' }}
        >
          分数线：985={prov.gaokaoThresholds['985']} 211={prov.gaokaoThresholds['211']} 本科=
          {prov.gaokaoThresholds['本科']}
        </div>
        <button
          onClick={() => props.rollGaokao(prov)}
          style={{
            padding: '0.5rem 1.5rem',
            'font-size': '0.9rem',
            'background-color': 'transparent',
            color: colors.textSecondary,
            border: `1px solid ${colors.border}`,
            'border-radius': radius.md,
            cursor: 'pointer',
          }}
        >
          ♻ 重掷骰子
        </button>
      </Show>
    </div>
  );
}
