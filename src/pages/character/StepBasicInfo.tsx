/**
 * Step 1 — 基本信息（姓名 + 性别）
 */
import { For } from 'solid-js';
import { colors, radius, font, cardStyle } from '../../utils/theme';
import type { CharacterData } from '../../types/character';

interface StepBasicInfoProps {
  data: CharacterData;
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

export function StepBasicInfo(props: StepBasicInfoProps) {
  return (
    <div
      style={{ ...cardStyle('2rem'), width: '100%', 'max-width': '340px', 'text-align': 'center' }}
    >
      <h2 style={{ 'font-size': '1.3rem', 'font-weight': 'normal', 'margin-bottom': '0.5rem' }}>
        基本信息
      </h2>
      <div
        style={{
          'font-family': font.title,
          color: colors.primary,
          opacity: 0.7,
          'margin-bottom': '1.5rem',
          'font-size': '0.85rem',
        }}
      >
        —— 名不正则言不顺 ——
      </div>
      <input
        type="text"
        placeholder="请输入姓名"
        value={props.data.characterName}
        onInput={(e) => props.updateField('characterName', e.currentTarget.value)}
        style={{
          padding: '0.8rem 1rem',
          'font-size': '1.1rem',
          'border-radius': radius.md,
          border: `1px solid ${colors.borderLight}`,
          'background-color': colors.bgInput,
          color: colors.textDark,
          width: '100%',
          'text-align': 'center',
          outline: 'none',
          'margin-bottom': '1.2rem',
        }}
        autofocus
      />
      <div style={{ display: 'flex', gap: '0.8rem' }}>
        <For each={['男', '女'] as const}>
          {(g) => (
            <button
              onClick={() => props.updateField('gender', g)}
              style={{
                flex: 1,
                padding: '0.7rem',
                'font-size': '1rem',
                'background-color': props.data.gender === g ? colors.primary : colors.bgInput,
                color: props.data.gender === g ? colors.primaryText : colors.textDark,
                border:
                  props.data.gender === g
                    ? `1px solid ${colors.primary}`
                    : `1px solid ${colors.borderLight}`,
                'border-radius': radius.md,
                cursor: 'pointer',
              }}
            >
              {g}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
