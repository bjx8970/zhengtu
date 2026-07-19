/**
 * 旧版能力接入矩阵。
 *
 * 只暴露当前真实可用的入口；计划功能保留稳定标识、阶段和说明。
 */

import { For } from 'solid-js';
import type { FeatureEntry } from '../types/ui';
import { navigate } from '../router';

const FEATURES: readonly FeatureEntry[] = [
  {
    id: 'governance',
    label: '部门施政',
    description: '安排部门行动并占用行动槽',
    icon: '政',
    status: 'available',
    route: '/main',
    phase: '已接入',
  },
  {
    id: 'kpi',
    label: '年度考核',
    description: '查看 KPI 目标与完成情况',
    icon: '考',
    status: 'available',
    route: '/main',
    phase: '已接入',
  },
  {
    id: 'promotion',
    label: '组织晋升',
    description: '推进考察、联审与任命流程',
    icon: '升',
    status: 'available',
    route: '/main',
    phase: '已接入',
  },
  {
    id: 'relations',
    label: '人脉关系',
    description: '上级、同僚与派系关系网络',
    icon: '联',
    status: 'planned',
    phase: 'Phase 2',
  },
  {
    id: 'secretary',
    label: '秘书与公文',
    description: '秘书培养、批示和舆情摘要',
    icon: '文',
    status: 'planned',
    phase: 'Phase 3',
  },
  {
    id: 'personal-life',
    label: '个人生活',
    description: '家庭、健康与个人资产系统',
    icon: '家',
    status: 'planned',
    phase: 'Phase 3',
  },
  {
    id: 'investigation',
    label: '巡视调查',
    description: '廉政风险、调查与纪律处置',
    icon: '巡',
    status: 'planned',
    phase: 'Phase 4',
  },
  {
    id: 'archives',
    label: '生涯档案',
    description: '履历、成就、回顾与历史评价',
    icon: '档',
    status: 'planned',
    phase: 'Phase 4',
  },
];

/**
 * 渲染功能接入状态矩阵。
 *
 * @returns 可操作与计划中功能卡片。
 */
export function FeatureRoadmap() {
  return (
    <section style={{ padding: '1rem' }}>
      <div
        style={{
          display: 'flex',
          'justify-content': 'space-between',
          'align-items': 'end',
          'margin-bottom': '0.8rem',
        }}
      >
        <div>
          <div class="eyebrow">SYSTEM MAP</div>
          <h2 style={{ 'font-size': '1rem', 'margin-top': '0.2rem' }}>功能接入路线</h2>
        </div>
        <span style={{ 'font-size': '0.68rem', color: 'var(--text-muted)' }}>
          3 已接入 · 5 待接入
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.55rem',
        }}
      >
        <For each={FEATURES}>
          {(feature) => (
            <button
              disabled={feature.status === 'planned'}
              onClick={() => feature.route && navigate(feature.route)}
              title={
                feature.status === 'planned' ? `${feature.phase} 计划接入` : feature.description
              }
              style={{
                position: 'relative',
                padding: '0.8rem',
                'text-align': 'left',
                'min-height': '96px',
                border: `1px ${feature.status === 'planned' ? 'dashed' : 'solid'} var(--border-color)`,
                'border-bottom': `3px solid ${feature.status === 'planned' ? 'var(--border-color)' : 'var(--color-secondary)'}`,
                background: feature.status === 'planned' ? 'rgba(255,255,255,0.38)' : '#fff',
                color: 'var(--text-primary)',
                cursor: feature.status === 'planned' ? 'not-allowed' : 'pointer',
                opacity: feature.status === 'planned' ? 0.72 : 1,
              }}
            >
              <span
                style={{
                  display: 'grid',
                  'place-items': 'center',
                  width: '26px',
                  height: '26px',
                  background:
                    feature.status === 'planned'
                      ? 'var(--border-color-light)'
                      : 'var(--color-secondary)',
                  color: feature.status === 'planned' ? 'var(--text-muted)' : '#fff',
                  'font-family': 'var(--font-title)',
                  'margin-bottom': '0.45rem',
                }}
              >
                {feature.icon}
              </span>
              <strong style={{ display: 'block', 'font-size': '0.8rem' }}>{feature.label}</strong>
              <span
                style={{
                  display: 'block',
                  'font-size': '0.65rem',
                  color: 'var(--text-secondary)',
                  'line-height': '1.45',
                  'margin-top': '0.2rem',
                }}
              >
                {feature.description}
              </span>
              <span
                style={{
                  position: 'absolute',
                  top: '0.55rem',
                  right: '0.55rem',
                  'font-size': '0.58rem',
                  color:
                    feature.status === 'planned' ? 'var(--text-muted)' : 'var(--color-success)',
                }}
              >
                {feature.phase}
              </span>
            </button>
          )}
        </For>
      </div>
    </section>
  );
}
