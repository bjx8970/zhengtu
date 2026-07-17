/**
 * Step 5 — 家庭背景 × 晋升通道（双列选择 + 加成预览）
 */
import { For, createMemo } from 'solid-js';
import { colors, radius, font, cardStyle } from '../../utils/theme';
import type { CharacterData } from '../../types/character';
import type { FamilyBackgroundItem, PromotionPathItem } from '../../types/config';

interface StepBackgroundProps {
  data: CharacterData;
  backgrounds: FamilyBackgroundItem[];
  paths: PromotionPathItem[];
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

export function StepBackground(props: StepBackgroundProps) {
  const totalBonuses = createMemo(() => {
    const b: Record<string, number> = {};
    const bg = props.backgrounds.find((bg) => bg.id === props.data.familyBackground);
    const path = props.paths.find((p) => p.id === props.data.promotionPath);
    if (bg) Object.assign(b, bg.bonuses);
    if (path) Object.assign(b, path.bonuses);
    return b;
  });

  return (
    <div
      style={{
        ...cardStyle('1.5rem'),
        width: '100%',
        'max-width': '500px',
        'text-align': 'center',
      }}
    >
      <h2 style={{ 'font-size': '1.2rem', 'font-weight': 'normal', 'margin-bottom': '1rem' }}>
        家庭背景 × 晋升通道
      </h2>
      <div style={{ display: 'flex', gap: '1rem', 'margin-bottom': '1rem' }}>
        {/* 家庭背景 */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              'font-size': '0.85rem',
              color: colors.textSecondary,
              'margin-bottom': '0.5rem',
            }}
          >
            家庭背景
          </div>
          <For each={props.backgrounds}>
            {(bg) => (
              <div
                onClick={() => props.updateField('familyBackground', bg.id)}
                style={{
                  padding: '0.6rem',
                  'font-size': '0.9rem',
                  'margin-bottom': '0.3rem',
                  cursor: 'pointer',
                  'background-color':
                    props.data.familyBackground === bg.id ? colors.primaryLight : colors.bgInput,
                  color: props.data.familyBackground === bg.id ? colors.primary : colors.textDark,
                  border:
                    props.data.familyBackground === bg.id
                      ? `1px solid ${colors.primary}`
                      : `1px solid ${colors.borderLight}`,
                  'border-radius': radius.md,
                }}
              >
                {bg.name}
              </div>
            )}
          </For>
        </div>
        {/* 晋升通道 */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              'font-size': '0.85rem',
              color: colors.textSecondary,
              'margin-bottom': '0.5rem',
            }}
          >
            晋升通道
          </div>
          <For each={props.paths}>
            {(p) => (
              <div
                onClick={() => props.updateField('promotionPath', p.id)}
                style={{
                  padding: '0.6rem',
                  'font-size': '0.9rem',
                  'margin-bottom': '0.3rem',
                  cursor: 'pointer',
                  'background-color':
                    props.data.promotionPath === p.id ? colors.primaryLight : colors.bgInput,
                  color: props.data.promotionPath === p.id ? colors.primary : colors.textDark,
                  border:
                    props.data.promotionPath === p.id
                      ? `1px solid ${colors.primary}`
                      : `1px solid ${colors.borderLight}`,
                  'border-radius': radius.md,
                }}
              >
                {p.name}
              </div>
            )}
          </For>
        </div>
      </div>
      {/* 加成预览 */}
      <div
        style={{
          'font-size': '0.85rem',
          'border-top': `1px solid ${colors.borderLight}`,
          'padding-top': '0.8rem',
        }}
      >
        <div style={{ color: colors.textSecondary, 'margin-bottom': '0.5rem' }}>加成预览</div>
        <div
          style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '0.5rem',
            'justify-content': 'center',
          }}
        >
          <For each={Object.entries(totalBonuses())}>
            {([key, val]) => (
              <span
                style={{
                  padding: '0.2rem 0.6rem',
                  'background-color': colors.primaryLight,
                  color: colors.primary,
                  'border-radius': radius.md,
                  'font-size': '0.8rem',
                }}
              >
                {key} +{val}
              </span>
            )}
          </For>
        </div>
      </div>
      <div
        style={{
          'font-family': font.title,
          color: colors.primary,
          opacity: 0.7,
          'margin-top': '0.8rem',
          'font-size': '0.85rem',
        }}
      >
        —— 朝中有人好做官 ——
      </div>
    </div>
  );
}
