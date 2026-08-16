/**
 * Step 1 — 基本信息（姓名 + 性别）
 */
import { For } from 'solid-js';
import type { CharacterData } from '../../types/character';

interface StepBasicInfoProps {
  data: CharacterData;
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

/**
 * 基本信息步骤组件。
 *
 * @param props.data        当前建档数据
 * @param props.updateField 字段更新回调
 * @returns 姓名与性别表单
 */
export function StepBasicInfo(props: StepBasicInfoProps) {
  return (
    <div class="flex-col gap-lg center" style={{ 'max-width': '360px', margin: '0 auto' }}>
      <div class="flex-col gap-sm center">
        <div class="doc-eyebrow">第一栏 · 姓名</div>
        <p class="serif secondary-text" style={{ 'font-size': '0.85rem' }}>
          —— 名不正则言不顺 ——
        </p>
      </div>
      <div class="form-field">
        <label class="form-label" for="character-name-input">
          姓名（至少两个字）
        </label>
        <input
          id="character-name-input"
          data-testid="character-name"
          type="text"
          placeholder="请输入姓名"
          value={props.data.characterName}
          onInput={(e) => props.updateField('characterName', e.currentTarget.value)}
          class="form-input"
          style={{ 'text-align': 'center', 'font-size': '1.1rem', padding: '0.8rem 1rem' }}
          autofocus
        />
      </div>
      <div class="form-field">
        <span class="form-label">性别</span>
        <div class="flex gap-sm">
          <For each={['男', '女'] as const}>
            {(g) => (
              <button
                class={
                  props.data.gender === g
                    ? 'choice-card selected flex-1 center'
                    : 'choice-card flex-1 center'
                }
                onClick={() => props.updateField('gender', g)}
                aria-pressed={props.data.gender === g}
              >
                {g}
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
