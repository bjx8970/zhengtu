/**
 * Step 4 — 院校选择（档次 → 院校级联）
 */
import { Show, For, createMemo } from 'solid-js';
import { getAvailableTiers } from '../../utils/gaokao';
import type { CharacterData } from '../../types/character';
import type { UniversityConfig } from '../../types/config';

interface StepSchoolProps {
  data: CharacterData;
  universities: UniversityConfig;
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

/**
 * 院校选择步骤组件（档次/院校两栏级联）。
 *
 * @param props.data        当前建档数据
 * @param props.universities 院校配置
 * @param props.updateField 字段更新回调
 * @returns 档次与院校两栏选择面板
 */
export function StepSchool(props: StepSchoolProps) {
  const schools = createMemo(() =>
    props.data.universityTier
      ? (props.universities.tiers[props.data.universityTier.replace('预科', '本科')] ?? null)
      : null,
  );

  return (
    <div class="flex gap-md responsive-col" style={{ 'max-width': '620px', margin: '0 auto' }}>
      <div class="flex-1 flex-col gap-sm">
        <span class="form-label">院校档次</span>
        <div class="choice-grid" style={{ 'grid-template-columns': '1fr' }}>
          <For each={getAvailableTiers(props.data.gaokaoTier)}>
            {(tier) => (
              <button
                data-testid={`university-tier-${tier}`}
                class={props.data.universityTier === tier ? 'choice-card selected' : 'choice-card'}
                onClick={() => {
                  props.updateField('universityTier', tier);
                  props.updateField('university', '');
                  props.updateField('isPreparatory', tier === '预科');
                }}
              >
                <span class="choice-card-title">
                  {tier === '预科' ? '预科班（入职+1年）' : `${tier} 院校`}
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="flex-1 flex-col gap-sm">
        <span class="form-label">选择院校</span>
        <Show
          when={schools()}
          fallback={<div class="card center muted text-sm flex-1">请先选择档次</div>}
        >
          <div class="choice-grid" style={{ 'grid-template-columns': '1fr' }}>
            {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Show guarantees existence */}
            <For each={schools()!}>
              {(school) => (
                <button
                  data-testid={`university-${school}`}
                  class={props.data.university === school ? 'choice-card selected' : 'choice-card'}
                  onClick={() => props.updateField('university', school)}
                >
                  <span class="choice-card-title">{school}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
