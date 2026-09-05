/**
 * 工作台主页
 *
 * 职责：展示履职概览、真实工作指标、时间推进、干部档案和业务入口。
 * 日程占用与进度由 ScheduleBoard 订阅游戏状态并实时展示。
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
import { ScheduleBoard } from '../../components/schedule-board';
import { UiIcon } from '../../components/ui-icon';

/** 时间推进选项 */
const GRANULARITIES: { label: string; desc: string; granularity: 'day' | 'week' | 'month' }[] = [
  { label: '推进 1 天', desc: '适合等待短日程完成', granularity: 'day' },
  { label: '推进 1 周', desc: '结算一周政务变化', granularity: 'week' },
  { label: '推进 1 月', desc: '进入月度考核节奏', granularity: 'month' },
];

/** 工作台政务入口（仅已实现功能；科员阶段个人任务为第一入口） */
const WORK_CARDS_LEADER: { icon: string; label: string; desc: string; route: string }[] = [
  {
    icon: '部',
    label: '部门治理',
    desc: '查看部门、安排行动、管理槽位与冷却',
    route: '/departments',
  },
  { icon: '任', label: '个人任务', desc: '承接并交付本人具体任务', route: '/tasks' },
  { icon: '考', label: 'KPI 考核', desc: '指标完成度、得分与改进建议', route: '/assessment' },
  { icon: '策', label: '政策治理', desc: '提议政策、跟踪阶段与生命周期操作', route: '/policies' },
  { icon: '事', label: '事件中心', desc: '处理收件箱事件、计划与历史记录', route: '/events' },
  { icon: '晋', label: '职务与职级', desc: '职级晋升条件、岗位机会与选拔流程', route: '/career' },
];

/** 科员（无领导职务）阶段的政务入口：部门治理转由领导负责 */
const WORK_CARDS_CLERK: { icon: string; label: string; desc: string; route: string }[] = [
  { icon: '任', label: '个人任务', desc: '承接、排期、交付本人具体任务', route: '/tasks' },
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
    const probation = state.career.appointment.probation;
    if (probation?.status === 'active') {
      const remaining = Math.max(probation.endsAtDay - state.time.totalDaysPlayed, 0);
      items.push({
        id: 'probation-active',
        level: remaining <= 30 ? 'warning' : 'info',
        message: `${probation.extensionCount > 0 ? '延期试用' : '录用试用'}进行中，距转正评估还有 ${remaining} 天。`,
        action: { label: '查看条件', route: '/career' },
      });
    } else if (probation?.status === 'passed') {
      items.push({
        id: 'probation-passed',
        level: 'info',
        message: probation.outcomeReason ?? '试用期已通过。',
        action: { label: '查看记录', route: '/career' },
      });
    } else if (probation?.status === 'failed') {
      items.push({
        id: 'probation-failed',
        level: 'danger',
        message: probation.outcomeReason ?? '试用期未通过，本次任职已终止。',
        action: { label: '查看原因', route: '/career' },
      });
    }
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
        eyebrow="OVERVIEW / 工作总览"
        title="工作台"
        meta={`${dateStr()} · 在任第 ${state.time.totalDaysPlayed} 日`}
        desc="从容安排今日工作，让每一步前行都有方向。"
      />

      <section class="welcome-panel">
        <div>
          <span class="welcome-kicker">履职路上 · 日有所进</span>
          <h2>{state.character.characterName || '新同事'}，欢迎回到工作台。</h2>
          <p>
            {positionConfig()?.name ?? '待任职'} · {institutionConfig()?.name ?? '待分配机构'}
          </p>
          <a
            class="welcome-action"
            href={state.career.appointment.leadershipRank === 'none' ? '#/tasks' : '#/departments'}
          >
            开始今日工作 <UiIcon name="arrow" />
          </a>
        </div>
        <div class="welcome-art" aria-hidden="true">
          <span class="art-orbit" />
          <span class="art-building building-back" />
          <span class="art-building building-front" />
          <span class="art-tree" />
          <span class="art-ground" />
          <span class="art-caption">笃行 · 致远</span>
        </div>
      </section>
      <div class="overview-metrics">
        <a class="overview-metric" href="#/assessment">
          <span class="metric-icon">
            <UiIcon name="assessment" />
          </span>
          <span class="metric-label">当前 KPI 得分</span>
          <strong>
            {kpiResult()?.totalScore.toFixed(1) ?? '—'}
            <small>分</small>
          </strong>
          <span class="metric-foot">
            查看指标与考核 <UiIcon name="arrow" />
          </span>
        </a>
        <a
          class="overview-metric"
          href={state.career.appointment.leadershipRank === 'none' ? '#/tasks' : '#/departments'}
        >
          <span class="metric-icon gold">
            <UiIcon name="wallet" />
          </span>
          <span class="metric-label">可用工作预算</span>
          <strong>
            {state.remainingBudget.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}
            <small>万</small>
          </strong>
          <span class="metric-foot">
            合理安排每一笔支出 <UiIcon name="arrow" />
          </span>
        </a>
        <a class="overview-metric" href="#/tasks">
          <span class="metric-icon blue">
            <UiIcon name="tasks" />
          </span>
          <span class="metric-label">已完成个人任务</span>
          <strong>
            {state.actions.personalTasks.totalCompleted}
            <small>项</small>
          </strong>
          <span class="metric-foot">
            积累属于你的工作实绩 <UiIcon name="arrow" />
          </span>
        </a>
        <a class="overview-metric" href="#/events">
          <span class="metric-icon rose">
            <UiIcon name="events" />
          </span>
          <span class="metric-label">待处理事件</span>
          <strong>
            {state.events.pending.filter((event) => event.snapshot.presentation === 'inbox').length}
            <small>件</small>
          </strong>
          <span class="metric-foot">
            前往事件中心处理 <UiIcon name="arrow" />
          </span>
        </a>
      </div>
      <AlertBanner alerts={alerts()} />
      <div class="dashboard-layout">
        {/* 干部档案 */}
        <section class="card identity-panel">
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
                  当前职级 {state.time.totalDaysPlayed - state.career.civilServiceRankStartedAtDay}{' '}
                  天
                </div>
              </div>
            </div>
            <div class="stat-grid identity-grid">
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
        <section class="card time-panel">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            推进时间
          </div>
          <div class="card-pad flex-col gap-md">
            <div class="time-actions">
              <For each={GRANULARITIES}>
                {(g, i) => (
                  <button
                    data-testid={`advance-${g.granularity}`}
                    class={i() === 2 ? 'btn btn-primary flex-1' : 'btn flex-1'}
                    disabled={state.career.appointment.status === 'ended'}
                    onClick={() => {
                      setLastAdvance(true);
                      dispatch({ type: 'ADVANCE_TIME', granularity: g.granularity });
                    }}
                    style={{
                      'flex-direction': 'column',
                      'align-items': 'flex-start',
                      gap: '0.2rem',
                    }}
                  >
                    <span class="advance-icon">
                      <UiIcon name="clock" />
                    </span>
                    <strong>{g.label}</strong>
                    <span class="advance-description text-xs">{g.desc}</span>
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

        <ScheduleBoard />
      </div>

      {/* 政务入口 */}
      <section class="card shortcuts-panel">
        <div class="card-title">
          <span class="card-title-mark" aria-hidden="true" />
          政务入口
        </div>
        <div class="card-pad">
          <div class="choice-grid shortcut-grid">
            <For
              each={
                state.career.appointment.leadershipRank === 'none'
                  ? WORK_CARDS_CLERK
                  : WORK_CARDS_LEADER
              }
            >
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
                  <UiIcon name="arrow" class="shortcut-arrow" />
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
