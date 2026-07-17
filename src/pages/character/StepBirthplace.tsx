/**
 * Step 2 — 出生地选择（省份 → 城市级联）
 */
import { Show, For, createMemo } from 'solid-js';
import { colors, radius, cardStyle } from '../../utils/theme';
import type { CharacterData } from '../../types/character';
import type { ProvinceConfig } from '../../types/config';

interface StepBirthplaceProps {
  data: CharacterData;
  provinces: () => ProvinceConfig[];
  selectedProvince: () => ProvinceConfig | undefined;
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

export function StepBirthplace(props: StepBirthplaceProps) {
  const selectedCity = createMemo(() => props.data.city);

  return (
    <div
      style={{
        ...cardStyle('1.5rem'),
        width: '100%',
        'max-width': '600px',
        display: 'flex',
        gap: '1rem',
        'max-height': '60vh',
      }}
    >
      <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
        <div
          style={{
            'font-size': '0.85rem',
            color: colors.textSecondary,
            'margin-bottom': '0.5rem',
            'text-align': 'center',
          }}
        >
          选择省份
        </div>
        <div
          style={{
            flex: 1,
            'overflow-y': 'auto',
            'border-radius': radius.md,
            border: `1px solid ${colors.borderLight}`,
          }}
        >
          <For each={props.provinces()}>
            {(p) => (
              <div
                onClick={() => {
                  props.updateField('province', p.name);
                  props.updateField('city', '');
                }}
                style={{
                  padding: '0.6rem 1rem',
                  'font-size': '0.9rem',
                  cursor: 'pointer',
                  'background-color':
                    props.data.province === p.name ? colors.primaryLight : 'transparent',
                  color: props.data.province === p.name ? colors.primary : colors.textDark,
                  'border-left':
                    props.data.province === p.name
                      ? `3px solid ${colors.primary}`
                      : '3px solid transparent',
                }}
              >
                {p.name}
                {p.ethnicBonus > 0 && (
                  <span style={{ 'font-size': '0.8rem', color: colors.primary }}> 🏔</span>
                )}
              </div>
            )}
          </For>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
        <div
          style={{
            'font-size': '0.85rem',
            color: colors.textSecondary,
            'margin-bottom': '0.5rem',
            'text-align': 'center',
          }}
        >
          选择城市
        </div>
        <Show
          when={props.selectedProvince()}
          fallback={
            <div
              style={{
                flex: 1,
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                color: colors.textMuted,
                'font-size': '0.85rem',
                border: `1px solid ${colors.borderLight}`,
                'border-radius': radius.md,
              }}
            >
              请先选择省份
            </div>
          }
        >
          {(prov) => (
            <div
              style={{
                flex: 1,
                'overflow-y': 'auto',
                'border-radius': radius.md,
                border: `1px solid ${colors.borderLight}`,
              }}
            >
              <For each={prov().cities}>
                {(c) => (
                  <div
                    onClick={() => props.updateField('city', c)}
                    style={{
                      padding: '0.6rem 1rem',
                      'font-size': '0.9rem',
                      cursor: 'pointer',
                      'background-color':
                        selectedCity() === c ? colors.primaryLight : 'transparent',
                      color: selectedCity() === c ? colors.primary : colors.textDark,
                      'border-left':
                        selectedCity() === c
                          ? `3px solid ${colors.primary}`
                          : '3px solid transparent',
                    }}
                  >
                    {c}
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
