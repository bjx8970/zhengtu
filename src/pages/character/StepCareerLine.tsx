/**
 * 建档步骤 6：职业线选择
 *
 * 展示 4 条职业线（行政/党群/纪检/群团）供玩家选择，
 * 未开放线路置灰并标注「未开放」。
 */

import { For } from 'solid-js';
import { CareerLine } from '../../types/enums';
import type { CharacterData } from '../../types/character';

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
    desc: '党务组织，改革与治理并重，适合政治型干部',
    disabled: true,
  },
  {
    id: CareerLine.Discipline,
    label: '纪检线',
    desc: '纪律监督，治廉权重高，维护政治生态的核心力量',
    disabled: true,
  },
  {
    id: CareerLine.Mass,
    label: '群团线',
    desc: '群众工作，改革与政绩导向，贴近基层民生',
    disabled: true,
  },
];

/**
 * 职业线选择步骤组件。
 *
 * @param props.data        当前建档数据
 * @param props.updateField 字段更新回调
 * @returns 四条职业线选择列表
 */
export function StepCareerLine(props: Props) {
  return (
    <div class="flex-col gap-md" style={{ 'max-width': '560px', margin: '0 auto' }}>
      <div class="doc-eyebrow center">选择职业路线</div>
      <div class="choice-grid" style={{ 'grid-template-columns': '1fr' }}>
        <For each={LINES}>
          {(line) => {
            const selected = props.data.careerLine === line.id;
            return (
              <button
                data-testid={`career-line-${line.id}`}
                onClick={() => {
                  if (!line.disabled) props.updateField('careerLine', line.id);
                }}
                disabled={line.disabled}
                class={selected ? 'choice-card selected' : 'choice-card'}
              >
                <span class="flex between center">
                  <span class="choice-card-title">{line.label}</span>
                  {line.disabled && <span class="tag tag-gray">未开放</span>}
                </span>
                <span class="choice-card-desc">{line.desc}</span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
