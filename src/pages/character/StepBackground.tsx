/**
 * Step 5 — 家庭背景 × 晋升通道（双列选择 + 加成预览）
 */
import { For, createMemo } from 'solid-js';
import { ATTR_LABELS } from '../../utils/theme';
import type { CharacterData } from '../../types/character';
import type { FamilyBackgroundItem, PromotionPathItem } from '../../types/config';

interface StepBackgroundProps {
  data: CharacterData;
  backgrounds: FamilyBackgroundItem[];
  paths: PromotionPathItem[];
  updateField: <K extends keyof CharacterData>(field: K, value: CharacterData[K]) => void;
}

/**
 * 家庭背景与晋升通道步骤组件。
 *
 * @param props.data        当前建档数据
 * @param props.backgrounds 家庭背景配置
 * @param props.paths       晋升通道配置
 * @param props.updateField 字段更新回调
 * @returns 双列选择面板 + 属性加成预览
 */
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
    <div class="flex-col gap-md" style={{ 'max-width': '560px', margin: '0 auto' }}>
      <div class="flex gap-md responsive-col">
        <div class="flex-1 flex-col gap-sm">
          <span class="form-label">家庭背景</span>
          <div class="choice-grid" style={{ 'grid-template-columns': '1fr' }}>
            <For each={props.backgrounds}>
              {(bg) => (
                <button
                  data-testid={`family-background-${bg.id}`}
                  class={
                    props.data.familyBackground === bg.id ? 'choice-card selected' : 'choice-card'
                  }
                  onClick={() => props.updateField('familyBackground', bg.id)}
                >
                  <span class="choice-card-title">{bg.name}</span>
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="flex-1 flex-col gap-sm">
          <span class="form-label">晋升通道</span>
          <div class="choice-grid" style={{ 'grid-template-columns': '1fr' }}>
            <For each={props.paths}>
              {(p) => (
                <button
                  data-testid={`promotion-path-${p.id}`}
                  class={props.data.promotionPath === p.id ? 'choice-card selected' : 'choice-card'}
                  onClick={() => props.updateField('promotionPath', p.id)}
                >
                  <span class="choice-card-title">{p.name}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
      <div
        class="flex-col gap-sm"
        style={{ 'border-top': '1px solid var(--border-color)', 'padding-top': 'var(--space-md)' }}
      >
        <span class="form-label">加成预览</span>
        <div class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
          <For each={Object.entries(totalBonuses())}>
            {([key, val]) => (
              <span class="tag tag-primary">
                {ATTR_LABELS[key] ?? key} +{val}
              </span>
            )}
          </For>
        </div>
      </div>
      <p class="serif secondary-text text-sm center">—— 朝中有人好做官 ——</p>
    </div>
  );
}
