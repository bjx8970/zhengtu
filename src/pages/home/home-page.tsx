/**
 * 主页（Home）
 *
 * 主页面只处理角色状态与时间推进：
 * - 角色名片（头像 + 信息 + 属性）
 * - 时间推进按钮
 * - 状态摘要（预算 / KPI / 槽位 / 健康）
 * - 子页面入口（部门 / 行动 / KPI / 晋升）
 * - 当前进行中的任务
 * - 月度提醒
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { navigate } from '../../router';
import { AppShell } from '../../components/app-shell';
import { MetricsBar } from '../../components/metrics-bar';
import { calculateKPI } from '../../engine/governance/kpi';
import { hasActiveActions } from '../../engine/core/action';
import { getConfigLoader } from '../../config/loader';
import { formatNumber } from '../../utils/format';
import { parsePositionIndex } from '../../utils/position';
import type { SlotOccupant, SlotTierKey } from '../../types/player';
import { colors, font, sealStyle, pillStyle, darkCardStyle } from '../../utils/theme';

const GRANULARITIES: { label: string; days: number; granularity: 'day' | 'week' | 'month' }[] = [
  { label: '推进1天', days: 1, granularity: 'day' },
  { label: '推进7天', days: 7, granularity: 'week' },
  { label: '推进30天', days: 30, granularity: 'month' },
];

const FEATURE_ENTRIES = [
  {
    icon: '政',
    label: '部门治理',
    desc: '查看部门卡片、行动清单、冷却状态',
    route: '/departments',
    color: colors.secondary,
  },
  {
    icon: '\u25F7',
    label: '行动排程',
    desc: '管理主要、次要、备用槽位',
    route: '/actions',
    color: colors.success,
  },
  {
    icon: '\u25CE',
    label: 'KPI 考核',
    desc: '查看指标构成、得分与改进建议',
    route: '/assessment',
    color: colors.gold,
  },
  {
    icon: '\u25B2',
    label: '晋升任命',
    desc: '处理民主推荐、组织考察、票决',
    route: '/career',
    color: colors.cyan,
  },
];

export function HomePage() {
  const { state, dispatch } = useGameStore();

  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    const idx = parsePositionIndex(posId);
    if (idx === null) return null;
    return getConfigLoader().getPosition(state.currentCareerLine, state.currentLevel, idx);
  });

  const kpiResult = createMemo(() => {
    const pos = positionConfig();
    if (!pos) return null;
    return calculateKPI(
      pos.kpiIndicators,
      state.departmentStates,
      getConfigLoader().getGameConfig(),
    );
  });

  const kpiDisplay = createMemo(() => {
    const r = kpiResult();
    if (!r) return { value: 'N/A', pct: 0 };
    return { value: formatNumber(r.totalScore, 1), pct: r.totalScore / 100 };
  });

  const hasPending = createMemo(() => hasActiveActions(state.slots));

  const slotOccupied = createMemo(() => {
    let count = 0;
    let total = 0;
    for (const tier of Object.values(state.slots)) {
      total += tier.count;
      count += tier.occupants.filter((o: SlotOccupant | null) => o !== null).length;
    }
    return { count, total };
  });

  const budgetMax = createMemo(() => positionConfig()?.annualBudget ?? 100);

  const pendingSlots = createMemo(() => {
    const result: { occupant: SlotOccupant; tierKey: SlotTierKey; tierLabel: string }[] = [];
    for (const [tierKey, tier] of Object.entries(state.slots) as [
      SlotTierKey,
      typeof state.slots.primary,
    ][]) {
      for (const o of tier.occupants) {
        if (o !== null) result.push({ occupant: o, tierKey, tierLabel: tier.label });
      }
    }
    return result;
  });

  return (
    <AppShell activeTab={0}>
      {/* 角色名片 */}
      <article
        style={{
          display: 'grid',
          'grid-template-columns': 'minmax(0,1fr) 220px',
          gap: '18px',
          'min-height': '256px',
          ...darkCardStyle('22px'),
          'border-top': `4px solid ${colors.primary}`,
        }}
      >
        <div>
          <div style={{ color: colors.textMuted, 'font-size': '13px' }}>当前角色</div>
          <h2 style={{ 'font-family': font.title, 'font-size': '30px', 'margin-top': '3px' }}>
            {state.characterName || '未创建角色'}
          </h2>
          <div
            style={{
              display: 'flex',
              'flex-wrap': 'wrap',
              gap: '8px',
              'margin-top': '12px',
              'margin-bottom': '18px',
            }}
          >
            <Show when={positionConfig()}>
              <span style={pillStyle('rgba(40,75,112,0.1)', colors.secondary)}>
                {positionConfig()?.name}
              </span>
            </Show>
            <span style={pillStyle('rgba(40,75,112,0.1)', colors.secondary)}>
              行政线 L{state.currentLevel}
            </span>
            <span style={pillStyle('rgba(40,75,112,0.1)', colors.secondary)}>
              任职第 {state.yearsInCurrentPosition} 年
            </span>
          </div>
          <p
            style={{
              'max-width': '560px',
              color: colors.textMuted,
              'font-size': '14px',
              'line-height': '1.7',
            }}
          >
            {kpiResult()?.tier ?? ''}考核，预算{state.remainingBudget >= 0 ? '充足' : '紧张'}。
            {hasPending() ? '有行动进行中。' : '暂无进行中的行动。'}
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            'align-content': 'space-between',
            'min-height': '212px',
            padding: '16px',
            border: `1px solid ${colors.border}`,
            'border-radius': '8px',
            background: `linear-gradient(135deg, rgba(179,38,45,0.12), transparent 45%),
                         linear-gradient(180deg, #fff, ${colors.bgSoft})`,
          }}
        >
          <div style={sealStyle()}>{state.characterName ? state.characterName.charAt(0) : '?'}</div>
          <dl
            style={{
              display: 'grid',
              'grid-template-columns': '1fr auto',
              gap: '8px 12px',
              margin: 0,
              'font-size': '13px',
            }}
          >
            <dt style={{ color: colors.textMuted }}>累计天数</dt>
            <dd style={{ margin: 0, 'font-weight': 800 }}>{state.totalDaysPlayed} 天</dd>
            <dt style={{ color: colors.textMuted }}>健康</dt>
            <dd style={{ margin: 0, 'font-weight': 800 }}>{state.health}</dd>
            <dt style={{ color: colors.textMuted }}>消沉</dt>
            <dd style={{ margin: 0, 'font-weight': 800 }}>{state.demoralization}</dd>
          </dl>
        </div>
      </article>

      {/* 推进时间 */}
      <article style={{ ...darkCardStyle('18px'), 'margin-top': '16px' }}>
        <div style={{ 'margin-bottom': '14px' }}>
          <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>推进时间</h3>
          <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
            主页保留最高频操作，完成行动后再提示进入对应子页面查看详情。
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'repeat(3, 1fr)',
            gap: '10px',
          }}
        >
          <For each={GRANULARITIES}>
            {(g, i) => (
              <button
                onClick={() => dispatch({ type: 'ADVANCE_TIME', granularity: g.granularity })}
                style={{
                  'min-height': '78px',
                  padding: '12px',
                  border: i() === 2 ? 'none' : `1px solid ${colors.border}`,
                  'border-radius': '8px',
                  background: i() === 2 ? colors.primary : '#fff',
                  color: i() === 2 ? '#fff' : colors.textPrimary,
                  cursor: 'pointer',
                  'text-align': 'left',
                }}
              >
                <strong style={{ display: 'block' }}>{g.label}</strong>
                <span
                  style={{
                    display: 'block',
                    'margin-top': '6px',
                    color: i() === 2 ? 'rgba(255,255,255,0.82)' : colors.textMuted,
                    'font-size': '12px',
                    'line-height': '1.45',
                  }}
                >
                  {i() === 0
                    ? '适合等待短行动完成'
                    : i() === 1
                      ? '结算一周政务变化'
                      : '进入月度考核节奏'}
                </span>
              </button>
            )}
          </For>
        </div>
      </article>

      {/* 状态摘要 */}
      <article style={{ ...darkCardStyle('18px'), 'margin-top': '16px' }}>
        <div style={{ 'margin-bottom': '14px' }}>
          <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>状态摘要</h3>
          <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
            详细分析下沉到 KPI、行动、部门等子页面。
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
            gap: '12px',
          }}
        >
          <MetricsBar
            label="剩余预算"
            value={`${formatNumber(state.remainingBudget)}万`}
            pct={budgetMax() > 0 ? state.remainingBudget / budgetMax() : 0}
            barColor={colors.secondary}
          />
          <MetricsBar
            label="KPI 总分"
            value={kpiDisplay().value}
            pct={kpiDisplay().pct}
            barColor={colors.cyan}
          />
          <MetricsBar
            label="健康状态"
            value={`${state.health}`}
            pct={state.health / 100}
            barColor={colors.gold}
          />
          <MetricsBar
            label="槽位占用"
            value={`${slotOccupied().count}/${slotOccupied().total}`}
            pct={slotOccupied().total > 0 ? slotOccupied().count / slotOccupied().total : 0}
            barColor={colors.primary}
          />
        </div>
      </article>

      {/* 子页面入口 */}
      <article style={{ ...darkCardStyle('18px'), 'margin-top': '16px' }}>
        <div style={{ 'margin-bottom': '14px' }}>
          <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>子页面入口</h3>
          <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
            功能集中放到各自页面，主页只展示必要摘要。
          </p>
        </div>
        <div style={{ display: 'grid', gap: '10px' }}>
          <For each={FEATURE_ENTRIES}>
            {(entry) => (
              <button
                onClick={() => navigate(entry.route)}
                style={{
                  display: 'grid',
                  'grid-template-columns': '38px minmax(0,1fr) auto',
                  gap: '12px',
                  'align-items': 'center',
                  'min-height': '72px',
                  padding: '12px',
                  border: `1px solid ${colors.border}`,
                  'border-radius': '8px',
                  background: '#fff',
                  cursor: 'pointer',
                  'text-align': 'left',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    'place-items': 'center',
                    width: '38px',
                    height: '38px',
                    'border-radius': '8px',
                    color: '#fff',
                    background: entry.color,
                    'font-weight': 900,
                  }}
                >
                  {entry.icon}
                </div>
                <div>
                  <strong style={{ display: 'block', 'font-size': '13px' }}>{entry.label}</strong>
                  <span
                    style={{
                      display: 'block',
                      'margin-top': '6px',
                      color: colors.textMuted,
                      'font-size': '12px',
                      'line-height': '1.45',
                    }}
                  >
                    {entry.desc}
                  </span>
                </div>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    border: `1px solid ${colors.border}`,
                    'border-radius': '50%',
                    color: colors.secondary,
                    background: colors.bgSoft,
                    display: 'grid',
                    'place-items': 'center',
                    'font-weight': 900,
                  }}
                >
                  ›
                </div>
              </button>
            )}
          </For>
        </div>
      </article>

      {/* 当前进行中 */}
      <article style={{ ...darkCardStyle('16px'), 'margin-top': '16px' }}>
        <div style={{ 'margin-bottom': '14px' }}>
          <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>当前进行中</h3>
          <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
            仅展示摘要，点击后进入行动排程页。
          </p>
        </div>
        <Show
          when={pendingSlots().length > 0}
          fallback={
            <div style={{ padding: '12px 14px', color: colors.textMuted, 'font-size': '13px' }}>
              暂无进行中的行动。
            </div>
          }
        >
          <For each={pendingSlots()}>
            {(item) => {
              const elapsed = state.totalDaysPlayed - item.occupant.startedAtDay;
              const total = item.occupant.durationDays;
              const pct = Math.min((elapsed / total) * 100, 100);
              return (
                <div
                  style={{
                    display: 'grid',
                    'grid-template-columns': '68px minmax(0,1fr) 44px',
                    gap: '10px',
                    'align-items': 'center',
                    padding: '12px 0',
                    'border-top': `1px solid ${colors.border}`,
                  }}
                >
                  <b style={{ color: colors.secondary, 'font-size': '13px' }}>
                    {item.tierLabel}槽位
                  </b>
                  <div>
                    <strong style={{ display: 'block', 'font-size': '13px' }}>
                      {item.occupant.actionName}
                    </strong>
                    <span
                      style={{
                        display: 'block',
                        'margin-top': '4px',
                        color: colors.textMuted,
                        'font-size': '12px',
                      }}
                    >
                      剩余 {total - elapsed} 天
                    </span>
                  </div>
                  <span
                    style={{ 'font-size': '12px', color: colors.textMuted, 'text-align': 'right' }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            }}
          </For>
        </Show>
      </article>

      {/* 月度提醒 */}
      <Show when={kpiResult()?.indicators.some((i) => i.completionRate < 0.5) ?? false}>
        <article
          style={{
            'margin-top': '16px',
            padding: '12px 14px',
            border: `1px solid ${colors.border}`,
            'border-radius': '8px',
            background: `rgba(183,131,36,0.1)`,
            color: '#5e4825',
            'font-size': '13px',
            'line-height': '1.65',
            'border-left': `3px solid ${colors.gold}`,
          }}
        >
          有 KPI 指标完成度低于 50%，进入「KPI 考核」页面查看详情并安排对应行动。
        </article>
      </Show>

      {/* 底部留白给 Tab 栏 */}
      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
