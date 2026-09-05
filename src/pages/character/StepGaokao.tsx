/**
 * Step 3 — 高考成绩（随机生成 + 重掷）
 */
import { Show } from 'solid-js';
import type { CharacterData } from '../../types/character';
import type { ProvinceConfig } from '../../types/config';

interface StepGaokaoProps {
  data: CharacterData;
  province: ProvinceConfig;
  gaokaoYear: number;
  rollGaokao: (province: ProvinceConfig) => void;
}

/**
 * 高考成绩步骤组件。
 *
 * @param props.data       当前建档数据
 * @param props.province   已选省份（决定分数线与加分）
 * @param props.gaokaoYear 高考年份
 * @param props.rollGaokao 生成成绩回调
 * @returns 成绩生成/重掷面板
 */
export function StepGaokao(props: StepGaokaoProps) {
  const prov = props.province;

  return (
    <div class="flex-col gap-lg center" style={{ 'max-width': '360px', margin: '0 auto' }}>
      <div class="doc-eyebrow">
        {prov.name} · {props.gaokaoYear}年普通高等学校招生全国统一考试
      </div>
      <Show
        when={props.data.gaokaoScore > 0}
        fallback={
          <button
            data-testid="generate-gaokao-score"
            class="btn btn-primary btn-lg serif"
            onClick={() => props.rollGaokao(prov)}
          >
            {'\u2685'} 生成高考成绩
          </button>
        }
      >
        <div class="flex-col center gap-sm">
          <div
            class="stat-value serif"
            style={{ 'font-size': '3.4rem', color: 'var(--color-primary)' }}
          >
            {props.data.gaokaoScore}
          </div>
          <span class="tag tag-primary" style={{ 'font-size': '1rem', padding: '0.3rem 1.2rem' }}>
            {props.data.gaokaoTier} 档
          </span>
          {prov.ethnicBonus > 0 && (
            <span class="tag tag-gold">含民族加分 +{prov.ethnicBonus} 分</span>
          )}
          <p class="text-xs secondary-text">
            分数线：985={prov.gaokaoThresholds['985']} · 211={prov.gaokaoThresholds['211']} · 本科=
            {prov.gaokaoThresholds['本科']}
          </p>
          <button class="btn btn-sm" onClick={() => props.rollGaokao(prov)}>
            {'\u267B'} 重掷骰子
          </button>
        </div>
      </Show>
    </div>
  );
}
