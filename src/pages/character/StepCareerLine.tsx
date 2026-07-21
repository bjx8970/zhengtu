/**
 * 建档步骤 6：职业线选择
 *
 * 展示 4 条职业线（行政/党群/纪检/群团）供玩家选择，
 * 每条线展示名称和简短描述。
 */

import { For } from 'solid-js';
import { CareerLine } from '../../types/enums';
import type { CharacterData } from '../../types/character';
import { colors, radius, font } from '../../utils/theme';

interface Props {
  data: CharacterData;
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

const LINES = [
  {
    id: CareerLine.Administrative,
    label: '行政线',
    desc: '综合管理，晋升空间广，预算充裕，适合全能型发展',
    disabled: false,
  },
  {
    id: CareerLine.Party,
    label: '党群线',
    desc: '党务组织，改革与治理并重，适合政治型干部（未开放）',
    disabled: true,
  },
  {
    id: CareerLine.Discipline,
    label: '纪检线',
    desc: '纪律监督，治廉权重高，维护政治生态的核心力量（未开放）',
    disabled: true,
  },
  {
    id: CareerLine.Mass,
    label: '群团线',
    desc: '群众工作，改革与政绩导向，贴近基层民生（未开放）',
    disabled: true,
  },
];

export function StepCareerLine(props: Props) {
  return (
    <div style={{ 'max-width': '540px', width: '100%' }}>
      <h3
        style={{
          'font-size': '1.2rem',
          'font-family': font.title,
          color: colors.textPrimary,
          'margin-bottom': '1rem',
          'text-align': 'center',
        }}
      >
        选择职业路线
      </h3>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.6rem' }}>
        <For each={LINES}>
          {(line) => {
            const selected = props.data.careerLine === line.id;
            return (
              <button
                onClick={() => {
                  if (!line.disabled) props.updateField('careerLine', line.id);
                }}
                disabled={line.disabled}
                style={{
                  padding: '1rem',
                  'text-align': 'left',
                  'background-color': line.disabled
                    ? colors.bgSoft
                    : selected
                      ? colors.primaryLight
                      : colors.bgCard,
                  border: line.disabled
                    ? `1px solid ${colors.border}`
                    : selected
                      ? `2px solid ${colors.primary}`
                      : `1px solid ${colors.border}`,
                  'border-radius': radius.md,
                  cursor: line.disabled ? 'not-allowed' : 'pointer',
                  opacity: line.disabled ? 0.55 : 1,
                  color: line.disabled
                    ? colors.textMuted
                    : selected
                      ? colors.primary
                      : colors.textPrimary,
                  'font-family': font.body,
                }}
              >
                <div
                  style={{ 'font-size': '0.95rem', 'font-weight': 600, 'margin-bottom': '0.3rem' }}
                >
                  {line.label}
                </div>
                <div style={{ 'font-size': '0.8rem', color: colors.textSecondary }}>
                  {line.desc}
                </div>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
