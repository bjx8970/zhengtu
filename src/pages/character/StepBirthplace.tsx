/**
 * Step 2 — 出生地选择（省份 → 城市级联）
 */
import { Show, For } from 'solid-js';
import type { CharacterData } from '../../types/character';
import type { ProvinceConfig } from '../../types/config';

interface StepBirthplaceProps {
  data: CharacterData;
  provinces: () => ProvinceConfig[];
  selectedProvince: () => ProvinceConfig | undefined;
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

/**
 * 出生地步骤组件（省份/城市两栏级联）。
 *
 * @param props.data            当前建档数据
 * @param props.provinces       省份配置
 * @param props.selectedProvince 当前选中的省份
 * @param props.updateField     字段更新回调
 * @returns 省份/城市两栏选择面板
 */
export function StepBirthplace(props: StepBirthplaceProps) {
  return (
    <div class="flex gap-md responsive-col" style={{ 'max-width': '620px', margin: '0 auto' }}>
      <div class="flex-1 flex-col gap-sm">
        <span class="form-label">选择省份</span>
        <div class="choice-grid" style={{ 'grid-template-columns': '1fr' }}>
          <For each={props.provinces()}>
            {(p) => (
              <button
                data-testid={`birthplace-province-${p.name}`}
                class={props.data.province === p.name ? 'choice-card selected' : 'choice-card'}
                onClick={() => {
                  props.updateField('province', p.name);
                  props.updateField('city', '');
                }}
              >
                <span class="choice-card-title">
                  {p.name}
                  {p.ethnicBonus > 0 && <span class="tag tag-gold">民族加分</span>}
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="flex-1 flex-col gap-sm">
        <span class="form-label">选择城市</span>
        <Show
          when={props.selectedProvince()}
          fallback={<div class="card center muted text-sm flex-1">请先选择省份</div>}
        >
          {(prov) => (
            <div class="choice-grid" style={{ 'grid-template-columns': '1fr' }}>
              <For each={prov().cities}>
                {(c) => (
                  <button
                    data-testid={`birthplace-city-${c}`}
                    class={props.data.city === c ? 'choice-card selected' : 'choice-card'}
                    onClick={() => props.updateField('city', c)}
                  >
                    <span class="choice-card-title">{c}</span>
                  </button>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
