/**
 * 工作台主页
 *
 * 单一工作台布局，自上而下包含：
 * - 信息栏：人物名称、职务、就职位置、当前日期、设置按钮
 * - 时间推进模块：推进1天/1周/1月
 * - 日程规划模块：主要日程(3格)、次要日程(2格)、紧急日程(1格)，进度条展示
 * - 工作台卡片区：按功能分类的政务操作入口
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { navigate } from '../../router';
import { AppShell } from '../../components/app-shell';
import { AlertBanner, type AlertItem } from '../../components/alert-banner';
import { calculateKPI } from '../../engine/governance/kpi';
import { getConfigLoader } from '../../config/loader';
import { formatDate } from '../../utils/format';
import { LEADERSHIP_RANK_LABELS } from '../../domain/career/types';
import type { SlotOccupant, SlotTierKey } from '../../types/player';
import { colors, font } from '../../utils/theme';

/** 时间推进选项 */
const GRANULARITIES: { label: string; desc: string; granularity: 'day' | 'week' | 'month' }[] = [
  { label: '推进 1 天', desc: '适合等待短日程完成', granularity: 'day' },
  { label: '推进 1 周', desc: '结算一周政务变化', granularity: 'week' },
  { label: '推进 1 月', desc: '进入月度考核节奏', granularity: 'month' },
];

/** 日程分组配置 */
const SCHEDULE_TIERS: { key: SlotTierKey; label: string; color: string }[] = [
  { key: 'primary', label: '主要日程', color: colors.secondary },
  { key: 'secondary', label: '次要日程', color: colors.success },
  { key: 'reserve', label: '紧急日程', color: colors.danger },
];

/** 工作台功能卡片 */
const WORK_CARDS: {
  icon: string;
  label: string;
  desc: string;
  route: string;
  color: string;
}[] = [
  {
    icon: '政',
    label: '部门治理',
    desc: '查看部门、安排日程、管理冷却',
    route: '/departments',
    color: colors.secondary,
  },
  {
    icon: '考',
    label: 'KPI 考核',
    desc: '查看指标完成度、得分与改进建议',
    route: '/assessment',
    color: colors.gold,
  },
  {
    icon: '晋',
    label: '晋升任命',
    desc: '民主推荐、组织考察、常委会票决',
    route: '/career',
    color: colors.cyan,
  },
  {
    icon: '文',
    label: '公文处理',
    desc: '批阅请示、报告、方案与建议',
    route: '/departments', // TODO: Phase 4 实现独立路由
    color: colors.warning,
  },
  {
    icon: '廉',
    label: '廉政风险',
    desc: '监控贪腐风险值、应对调查与举报',
    route: '/departments', // TODO: Phase 4 实现独立路由
    color: colors.primary,
  },
  {
    icon: '交',
    label: '人脉关系',
    desc: '维护上级、同事、学界与媒体关系',
    route: '/departments', // TODO: Phase 4 实现独立路由
    color: colors.purple,
  },
];

/**
 * 工作台主页组件。
 *
 * @returns 工作台 JSX
 */
export function HomePage() {
  const { state, dispatch } = useGameStore();

  const positionConfig = createMemo(() => {
    const posId = state.career.appointment.positionId;
    if (!posId) return null;
    return getConfigLoader().getPositionById(posId);
  });

  const dateStr = createMemo(() => formatDate(state.time.year, state.time.month, state.time.day));

  const kpiResult = createMemo(() => {
    const pos = positionConfig();
    if (!pos) return null;
    return calculateKPI(
      getConfigLoader().resolvePositionKpis(pos.id),
      state.actions.departmentStates,
      getConfigLoader().getGameConfig(),
    );
  });

  /** 通用提醒列表（后续扩展只需追加条件） */
  const alerts = createMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];
    if (kpiResult()?.indicators.some((i) => i.completionRate < 0.5)) {
      items.push({
        id: 'kpi-low',
        level: 'warning',
        message: '有 KPI 指标完成度低于 50%，建议安排对应行动提升。',
        action: { label: '查看考核', route: '/assessment' },
      });
    }
    return items;
  });

  /** 按分组获取日程占用列表 */
  function getTierOccupants(tierKey: SlotTierKey) {
    const tier = state.actions.slots[tierKey];
    return tier.occupants;
  }

  /** 计算占用数/总数 */
  function getTierCount(tierKey: SlotTierKey) {
    const tier = state.actions.slots[tierKey];
    const occupied = tier.occupants.filter((o: SlotOccupant | null) => o !== null).length;
    return { occupied, total: tier.count };
  }

  return (
    <AppShell>
      {/* ═══ 信息栏 ═══ */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          'z-index': 10,
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          padding: '14px 20px',
          background: colors.bgHeader,
          color: '#fff',
          'border-radius': '0 0 8px 8px',
          'box-shadow': '0 4px 16px rgba(23,43,69,0.18)',
        }}
      >
        <div style={{ display: 'flex', 'align-items': 'center', gap: '14px' }}>
          <div
            style={{
              display: 'grid',
              'place-items': 'center',
              width: '40px',
              height: '40px',
              'border-radius': '8px',
              background: colors.primary,
              'font-family': font.title,
              'font-size': '22px',
              'font-weight': 700,
              color: '#fff',
            }}
          >
            {state.character.characterName ? state.character.characterName.charAt(0) : '?'}
          </div>
          <div>
            <div
              style={{
                'font-size': '18px',
                'font-weight': 700,
                'font-family': font.title,
              }}
            >
              {state.character.characterName || '未创建角色'}
            </div>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                'margin-top': '3px',
                'font-size': '12px',
                color: 'rgba(255,255,255,0.72)',
              }}
            >
              <Show when={positionConfig()}>
                <span>{positionConfig()?.name}</span>
                <span>·</span>
              </Show>
              <span>{LEADERSHIP_RANK_LABELS[state.career.appointment.leadershipRank]}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '16px' }}>
          <div
            style={{ 'text-align': 'right', 'font-size': '13px', color: 'rgba(255,255,255,0.85)' }}
          >
            {dateStr()}
            <div
              style={{ 'font-size': '11px', color: 'rgba(255,255,255,0.55)', 'margin-top': '2px' }}
            >
              任职第{' '}
              {Math.floor(
                (state.time.totalDaysPlayed - state.career.appointment.startedAtDay) / 360,
              ) + 1}{' '}
              年 · 累计 {state.time.totalDaysPlayed} 天
            </div>
          </div>
          <button
            title="设置"
            style={{
              display: 'grid',
              'place-items': 'center',
              width: '34px',
              height: '34px',
              border: '1px solid rgba(255,255,255,0.25)',
              'border-radius': '50%',
              background: 'transparent',
              color: 'rgba(255,255,255,0.8)',
              'font-size': '16px',
              cursor: 'pointer',
            }}
          >
            ⚙
          </button>
        </div>
      </header>

      {/* ═══ 信息提醒 ═══ */}
      <AlertBanner alerts={alerts()} />

      {/* ═══ 时间推进 ═══ */}
      <section
        style={{
          'margin-top': '16px',
          background: colors.bgCard,
          border: `1px solid ${colors.border}`,
          'border-radius': '8px',
          padding: '18px 20px',
        }}
      >
        <h2 style={{ 'font-size': '16px', 'font-weight': 700, 'font-family': font.title }}>
          时间推进
        </h2>
        <p style={{ 'font-size': '12px', color: colors.textMuted, margin: '4px 0 14px' }}>
          推进时间以结算进行中的日程，触发月度预算扣除与年度考核。
        </p>
        <div style={{ display: 'grid', 'grid-template-columns': 'repeat(3, 1fr)', gap: '10px' }}>
          <For each={GRANULARITIES}>
            {(g, i) => (
              <button
                onClick={() => dispatch({ type: 'ADVANCE_TIME', granularity: g.granularity })}
                style={{
                  padding: '14px 12px',
                  border: i() === 2 ? 'none' : `1px solid ${colors.border}`,
                  'border-radius': '8px',
                  background: i() === 2 ? colors.primary : '#fff',
                  color: i() === 2 ? '#fff' : colors.textPrimary,
                  cursor: 'pointer',
                  'text-align': 'left',
                }}
              >
                <strong style={{ display: 'block', 'font-size': '14px' }}>{g.label}</strong>
                <span
                  style={{
                    display: 'block',
                    'margin-top': '5px',
                    'font-size': '11px',
                    color: i() === 2 ? 'rgba(255,255,255,0.75)' : colors.textMuted,
                    'line-height': '1.4',
                  }}
                >
                  {g.desc}
                </span>
              </button>
            )}
          </For>
        </div>
      </section>

      {/* ═══ 日程规划 ═══ */}
      <section
        style={{
          'margin-top': '16px',
          background: colors.bgCard,
          border: `1px solid ${colors.border}`,
          'border-radius': '8px',
          padding: '18px 20px',
        }}
      >
        <h2 style={{ 'font-size': '16px', 'font-weight': 700, 'font-family': font.title }}>
          日程规划
        </h2>
        <p style={{ 'font-size': '12px', color: colors.textMuted, margin: '4px 0 14px' }}>
          管理当前正在执行的政务日程，日程完成后自动结算效果。
        </p>

        <For each={SCHEDULE_TIERS}>
          {(tier) => {
            const count = getTierCount(tier.key);
            const occupants = getTierOccupants(tier.key);
            return (
              <div style={{ 'margin-bottom': '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '8px',
                    'margin-bottom': '10px',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      'border-radius': '50%',
                      background: tier.color,
                    }}
                  />
                  <span style={{ 'font-size': '13px', 'font-weight': 700 }}>{tier.label}</span>
                  <span style={{ 'font-size': '11px', color: colors.textMuted }}>
                    {count.occupied}/{count.total}
                  </span>
                  <Show when={tier.key === 'reserve'}>
                    <span
                      style={{ 'font-size': '11px', color: colors.warning, 'margin-left': '4px' }}
                    >
                      ⚠ 使用将扣减健康、增加消沉
                    </span>
                  </Show>
                </div>

                <For each={occupants}>
                  {(occupant: SlotOccupant | null) => {
                    if (occupant) {
                      const elapsed = state.time.totalDaysPlayed - occupant.startedAtDay;
                      const total = occupant.durationDays;
                      const pct = Math.min((elapsed / total) * 100, 100);
                      const remain = Math.max(total - elapsed, 0);
                      return (
                        <div
                          style={{
                            display: 'grid',
                            'grid-template-columns': '1fr auto',
                            gap: '8px 12px',
                            'align-items': 'center',
                            padding: '10px 14px',
                            border: `1px solid ${colors.borderLight}`,
                            'border-radius': '4px',
                            background: '#fff',
                            'margin-bottom': '6px',
                          }}
                        >
                          <div style={{ 'font-size': '13px', 'font-weight': 600 }}>
                            {occupant.actionName}
                          </div>
                          <div
                            style={{
                              'font-size': '11px',
                              color: colors.textMuted,
                              'text-align': 'right',
                            }}
                          >
                            剩余 {remain} 天
                          </div>
                          <div
                            style={{
                              'grid-column': '1 / -1',
                              height: '6px',
                              'border-radius': '999px',
                              background: '#e7e1d6',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                'border-radius': 'inherit',
                                width: `${pct}%`,
                                background: tier.color,
                                transition: 'width 0.3s',
                              }}
                            />
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        style={{
                          padding: '10px 14px',
                          border: `1px dashed ${colors.border}`,
                          'border-radius': '4px',
                          'text-align': 'center',
                          'font-size': '12px',
                          color: colors.textMuted,
                          'margin-bottom': '6px',
                        }}
                      >
                        （空闲）
                      </div>
                    );
                  }}
                </For>
              </div>
            );
          }}
        </For>
      </section>

      {/* ═══ 工作台 ═══ */}
      <section
        style={{
          'margin-top': '16px',
          background: colors.bgCard,
          border: `1px solid ${colors.border}`,
          'border-radius': '8px',
          padding: '18px 20px',
        }}
      >
        <h2 style={{ 'font-size': '16px', 'font-weight': 700, 'font-family': font.title }}>
          工作台
        </h2>
        <p style={{ 'font-size': '12px', color: colors.textMuted, margin: '4px 0 14px' }}>
          按功能分类的政务操作入口。
        </p>
        <div style={{ display: 'grid', 'grid-template-columns': 'repeat(2, 1fr)', gap: '12px' }}>
          <For each={WORK_CARDS}>
            {(card) => (
              <button
                onClick={() => navigate(card.route)}
                style={{
                  display: 'flex',
                  'align-items': 'flex-start',
                  gap: '12px',
                  padding: '16px',
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
                    'font-weight': 900,
                    'font-size': '16px',
                    'flex-shrink': 0,
                    background: card.color,
                  }}
                >
                  {card.icon}
                </div>
                <div style={{ flex: 1, 'min-width': 0 }}>
                  <div style={{ 'font-size': '14px', 'font-weight': 700 }}>{card.label}</div>
                  <div
                    style={{
                      'margin-top': '4px',
                      'font-size': '12px',
                      color: colors.textMuted,
                      'line-height': '1.5',
                    }}
                  >
                    {card.desc}
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </section>

      {/* 底部留白 */}
      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
