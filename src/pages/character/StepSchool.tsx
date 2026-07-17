/**
 * Step 4 — 院校选择（档次 → 院校级联）
 */
import { Show, For } from 'solid-js';
import { colors, radius, cardStyle } from '../../utils/theme';
import { getAvailableTiers } from '../../utils/gaokao';
import type { CharacterData } from '../../types/character';
import type { UniversityConfig } from '../../types/config';

interface StepSchoolProps {
  data: CharacterData;
  universities: UniversityConfig;
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

export function StepSchool(props: StepSchoolProps) {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Show guarantees existence
  const schools = props.data.universityTier
    ? props.universities.tiers[props.data.universityTier.replace('预科', '本科')]
    : null;

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
      {/* 档次选择 */}
      <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
        <div
          style={{
            'font-size': '0.85rem',
            color: colors.textSecondary,
            'margin-bottom': '0.5rem',
            'text-align': 'center',
          }}
        >
          院校档次
        </div>
        <div
          style={{
            flex: 1,
            'overflow-y': 'auto',
            'border-radius': radius.md,
            border: `1px solid ${colors.borderLight}`,
          }}
        >
          <For each={getAvailableTiers(props.data.gaokaoTier)}>
            {(tier) => (
              <div
                onClick={() => {
                  props.updateField('universityTier', tier);
                  props.updateField('university', '');
                  props.updateField('isPreparatory', tier === '预科');
                }}
                style={{
                  padding: '0.6rem 1rem',
                  'font-size': '0.9rem',
                  cursor: 'pointer',
                  'background-color':
                    props.data.universityTier === tier ? colors.primaryLight : 'transparent',
                  color: props.data.universityTier === tier ? colors.primary : colors.textDark,
                  'border-left':
                    props.data.universityTier === tier
                      ? `3px solid ${colors.primary}`
                      : '3px solid transparent',
                }}
              >
                {tier === '预科' ? `预科班 🏔 (入职+1年)` : `${tier} 院校`}
              </div>
            )}
          </For>
        </div>
      </div>
      {/* 院校列表 */}
      <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column' }}>
        <div
          style={{
            'font-size': '0.85rem',
            color: colors.textSecondary,
            'margin-bottom': '0.5rem',
            'text-align': 'center',
          }}
        >
          选择院校
        </div>
        <Show
          when={schools}
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
              请先选择档次
            </div>
          }
        >
          <div
            style={{
              flex: 1,
              'overflow-y': 'auto',
              'border-radius': radius.md,
              border: `1px solid ${colors.borderLight}`,
            }}
          >
            <For each={schools!}>
              {(school) => (
                <div
                  onClick={() => props.updateField('university', school)}
                  style={{
                    padding: '0.6rem 1rem',
                    'font-size': '0.9rem',
                    cursor: 'pointer',
                    'background-color':
                      props.data.university === school ? colors.primaryLight : 'transparent',
                    color: props.data.university === school ? colors.primary : colors.textDark,
                    'border-left':
                      props.data.university === school
                        ? `3px solid ${colors.primary}`
                        : '3px solid transparent',
                  }}
                >
                  {school}
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
