/**
 * 工作台主页
 *
 * 单一工作台布局，自上而下：
 * - 干部档案卡：姓名 + 职位/机构/地区/层级/领导职务/公务员职级分开展示
 * - 推进时间：1 天 / 1 周 / 1 月 三档 + 结算状态反馈
 * - 日程规划：主要/次要/紧急三类槽位的在办日程与进度
 * - 政务入口：真实可用的五大功能入口（不展示未实现功能）
 */

import { createMemo, createSignal, For } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { navigate } from '../../router';
import { AlertBanner, type AlertItem } from '../../components/alert-banner';
import { PageHeader } from '../../components/page-header';
import { calculateKPI } from '../../engine/governance/kpi';
import { getConfigLoader } from '../../config/loader';
import { formatDate } from '../../utils/format';
import {
  CIVIL_SERVICE_RANK_LABELS,
  INSTITUTION_LEVEL_LABELS,
  LEADERSHIP_RANK_LABELS,
} from '../../domain/career/types';
import {
  evaluateCivilServiceRankEligibility,
  getActiveCareerRestrictions,
} from '../../engine/career/civil-service-rank-eligibility';
import { formatCareerRegion } from '../career/career-display';
import type { SlotOccupant, SlotTierKey } from '../../types/player';

/** 时间推进选项 */
const GRANULARITIES: { label: string; desc: string; granularity: 'day' | 'week' | 'month' }[] = [
  { label: '推进 1 天', desc: '适合等待短日程完成', granularity: 'day' },
  { label: '推进 1 周', desc: '结算一周政务变化', granularity: 'week' },
  { label: '推进 1 月', desc: '进入月度考核节奏', granularity: 'month' },
];

/** 日程分组配置 */
const SCHEDULE_TIERS: { key: SlotTierKey; label: string; hint: string }[] = [
  { key: 'primary', label: '主要日程', hint: '仅主要槽位' },
  { key: 'secondary', label: '次要日程', hint: '任意槽位' },
  { key: 'reserve', label: '紧急日程', hint: '加班：扣减健康、增加消沉' },
];

/** 工作台政务入口（仅已实现功能） */
const WORK_CARDS: { icon: string; label: string; desc: string; route: string }[] = [
  {
    icon: '部',
    label: '部门治理',
    desc: '查看部门、安排行动、管理槽位与冷却',
    route: '/departments',
  },
  { icon: '考', label: 'KPI 考核', desc: '指标完成度、得分与改进建议', route: '/assessment' },
  { icon: '策', label: '政策治理', desc: '提议政策、跟踪阶段与生命周期操作', route: '/policies' },
  { icon: '事', label: '事件中心', desc: '处理收件箱事件、计划与历史记录', route: '/events' },
  { icon: '晋', label: '职务与职级', desc: '职级晋升条件、岗位机会与选拔流程', route: '/career' },
];

/**
 * 工作台主页组件。
 *
 * @returns 工作台 JSX
 */
export function HomePage() {
  const { state, dispatch } = useGameStore();
  const [lastAdvance, setLastAdvance] = createSignal(false);

  const positionConfig = createMemo(() => {
    const posId = state.career.appointment.positionId;
    if (!posId) return null;
    return getConfigLoader().getPositionById(posId);
  });

  const dateStr = createMemo(() => formatDate(state.time.year, state.time.month, state.time.day));
  const timeFeedback = createMemo(() => {
    const date = dateStr();
    if (state.events.activeBlockingEventId) {
      return `推进因阻塞事件中断，当前停留在 ${date}。处理事件后将继续本日剩余节点。`;
    }
    if (state.time.pendingContinuation) {
      return `当前停留在 ${date}，仍有同日 continuation 等待结算。处理事件后将继续剩余节点。`;
    }
    return lastAdvance() ? `推进完整完成，当前停留在 ${date}。` : `当前停留在 ${date}。`;
  });

  const institutionConfig = createMemo(() =>
    getConfigLoader().getInstitutionById(state.career.appointment.institutionId),
  );

  const careerRankEligibility = createMemo(() => {
    const config = getConfigLoader().getGameConfig();
    return evaluateCivilServiceRankEligibility(
      state,
      state.time.totalDaysPlayed,
      config.daysPerMonth * config.monthsPerYear,
      getConfigLoader().getCivilServiceRankProgressionRule(state.career.civilServiceRank),
    );
  });

  const activeCareerRestrictions = createMemo(() =>
    getActiveCareerRestrictions(state.career.restrictions, state.time.totalDaysPlayed),
  );

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
    const availableOpportunities = state.career.opportunities.filter(
      (opportunity) => opportunity.status === 'available',
    );
    if (availableOpportunities.length > 0) {
      items.push({
        id: 'career-opportunity',
        level: 'info',
        message: `有 ${availableOpportunities.length} 个可处理的岗位机会。`,
        action: { label: '查看机会', route: '/career' },
      });
    }
    const expiringOpportunities = availableOpportunities.filter(
      (opportunity) =>
        opportunity.expiresAtDay !== null &&
        opportunity.expiresAtDay - state.time.totalDaysPlayed <= 7,
    );
    if (expiringOpportunities.length > 0) {
      items.push({
        id: 'career-expiring',
        level: 'warning',
        message: '有岗位机会将在 7 天内到期，请及时处理。',
        action: { label: '前往处理', route: '/career' },
      });
    }
    if (state.career.activeProcess) {
      items.push({
        id: 'career-process',
        level: 'info',
        message: '有正在进行的岗位选拔流程。',
        action: { label: '查看流程', route: '/career' },
      });
    }
    if (careerRankEligibility().eligible) {
      items.push({
        id: 'career-rank-ready',
        level: 'info',
        message: '已满足公务员职级晋升条件。',
        action: { label: '办理晋升', route: '/career' },
      });
    }
    if (activeCareerRestrictions().length > 0) {
      items.push({
        id: 'career-restriction',
        level: 'danger',
        message: '存在生效中的职业限制，可能影响职级晋升或岗位选拔。',
        action: { label: '查看限制', route: '/career' },
      });
    }
    return items;
  });

  /** 按分组获取日程占用列表 */
  function getTierOccupants(tierKey: SlotTierKey) {
    return state.actions.slots[tierKey].occupants;
  }

  /** 计算占用数/总数 */
  function getTierCount(tierKey: SlotTierKey) {
    const tier = state.actions.slots[tierKey];
    const occupied = tier.occupants.filter((o: SlotOccupant | null) => o !== null).length;
    return { occupied, total: tier.count };
  }

  const identityStats = () => [
    { label: '职位', value: positionConfig()?.name ?? '未分配' },
    { label: '机构', value: institutionConfig()?.name ?? '未知机构' },
    { label: '地区', value: formatCareerRegion(state.career.appointment.regionId) },
    {
      label: '机构层级',
      value: INSTITUTION_LEVEL_LABELS[state.career.appointment.institutionLevel],
    },
    { label: '领导职务', value: LEADERSHIP_RANK_LABELS[state.career.appointment.leadershipRank] },
    { label: '公务员职级', value: CIVIL_SERVICE_RANK_LABELS[state.career.civilServiceRank] },
  ];

  return (
    <>
      <PageHeader
        eyebrow="工作台 · DASHBOARD"
        title="工作台"
        meta={`${dateStr()} · 在任第 ${state.time.totalDaysPlayed} 日`}
        desc="干部档案、时间推进与政务入口总览"
      />

      <AlertBanner alerts={alerts()} />

      {/* 干部档案 */}
      <section class="card">
        <div class="card-title">
          <span class="card-title-mark" aria-hidden="true" />
          干部档案
        </div>
        <div class="card-pad flex-col gap-lg">
          <div class="flex gap-md center">
            <div
              class="masthead-seal"
              style={{ width: '52px', height: '52px', 'font-size': '28px' }}
            >
              {state.character.characterName ? state.character.characterName.charAt(0) : '?'}
            </div>
            <div>
              <div class="serif" style={{ 'font-size': '1.3rem', 'font-weight': 700 }}>
                {state.character.characterName || '未创建角色'}
              </div>
              <div class="text-xs secondary-text">
                当前任职 {state.time.totalDaysPlayed - state.career.appointment.startedAtDay} 天 ·
                当前职级 {state.time.totalDaysPlayed - state.career.civilServiceRankStartedAtDay} 天
              </div>
            </div>
          </div>
          <div class="stat-grid">
            <For each={identityStats()}>
              {(item) => (
                <div class="stat">
                  <div class="stat-value">{item.value}</div>
                  <div class="stat-label">{item.label}</div>
                </div>
              )}
            </For>
          </div>
        </div>
      </section>

      {/* 推进时间 */}
      <section class="card">
        <div class="card-title">
          <span class="card-title-mark" aria-hidden="true" />
          推进时间
        </div>
        <div class="card-pad flex-col gap-md">
          <div class="flex gap-sm responsive-col">
            <For each={GRANULARITIES}>
              {(g, i) => (
                <button
                  data-testid={`advance-${g.granularity}`}
                  class={i() === 2 ? 'btn btn-primary flex-1' : 'btn flex-1'}
                  onClick={() => {
                    setLastAdvance(true);
                    dispatch({ type: 'ADVANCE_TIME', granularity: g.granularity });
                  }}
                  style={{ 'flex-direction': 'column', 'align-items': 'flex-start', gap: '0.2rem' }}
                >
                  <strong>{g.label}</strong>
                  <span
                    class="text-xs"
                    style={{
                      color: i() === 2 ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)',
                      'font-weight': 400,
                    }}
                  >
                    {g.desc}
                  </span>
                </button>
              )}
            </For>
          </div>
          <p
            role="status"
            class={state.events.activeBlockingEventId ? 'banner banner-danger' : 'banner'}
          >
            {timeFeedback()}
          </p>
        </div>
      </section>

      {/* 日程规划 */}
      <section class="card">
        <div class="card-title">
          <span class="card-title-mark" aria-hidden="true" />
          日程规划
        </div>
        <div class="card-pad flex-col gap-lg">
          <For each={SCHEDULE_TIERS}>
            {(tier) => {
              const count = getTierCount(tier.key);
              const occupants = getTierOccupants(tier.key);
              return (
                <div class="flex-col gap-sm">
                  <div class="flex gap-sm center">
                    <span style={{ 'font-weight': 700 }}>{tier.label}</span>
                    <span class="tag tag-gray">
                      {count.occupied}/{count.total}
                    </span>
                    <span class="text-xs muted">{tier.hint}</span>
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
                            class="card flex between center gap-md"
                            style={{ padding: '0.6rem 0.9rem' }}
                          >
                            <strong class="text-sm">{occupant.actionName}</strong>
                            <span class="text-xs muted">剩余 {remain} 天</span>
                            <div class="meter flex-1" style={{ 'max-width': '220px' }}>
                              <i
                                class="meter-fill blue"
                                style={{ width: `${pct}%` }}
                                aria-hidden="true"
                              />
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                          class="card center text-xs muted"
                          style={{ padding: '0.55rem 0.9rem' }}
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
        </div>
      </section>

      {/* 政务入口 */}
      <section class="card">
        <div class="card-title">
          <span class="card-title-mark" aria-hidden="true" />
          政务入口
        </div>
        <div class="card-pad">
          <div
            class="choice-grid"
            style={{ 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))' }}
          >
            <For each={WORK_CARDS}>
              {(card) => (
                <button class="choice-card" onClick={() => navigate(card.route)}>
                  <span class="flex gap-sm center">
                    <span
                      class="masthead-seal"
                      style={{ width: '32px', height: '32px', 'font-size': '16px' }}
                    >
                      {card.icon}
                    </span>
                    <span class="choice-card-title">{card.label}</span>
                  </span>
                  <span class="choice-card-desc">{card.desc}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </section>

      {/* 底部留白 */}
      <div style={{ height: '8px' }} />
    </>
  );
}
