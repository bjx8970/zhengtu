/**
 * 仪表盘（主界面）
 *
 * 玩家的核心操作面板，展示：
 * 1. 身份卡片（姓名/职位/级别/日期/进度）
 * 2. 行动槽位状态（含进度条）
 * 3. 推进粒度切换 + 推进时间按钮
 * 4. 各子系统入口（2 列卡片网格）
 */

import { useGameStore } from '../../store/game-store';
import { navigate } from '../../router';
import { formatDate, formatGranularity } from '../../utils/format';
import { PromotionStage, type TimeGranularity } from '../../types/enums';
import { For, createMemo, Show } from 'solid-js';
import { colors, radius, font, pageBase, cardStyle, darkCardStyle } from '../../utils/theme';
import { getConfigLoader } from '../../config/loader';

interface DashboardEntry {
  label: string;
  path: string;
  desc: string;
  show: () => boolean;
}

export function Dashboard() {
  const { state, dispatch } = useGameStore();

  const granularities: TimeGranularity[] = ['day', 'week', 'month'];

  const positionName = createMemo(() => {
    if (!state.currentPositionId) return '';
    const posId = state.currentPositionId;
    const idx = parseInt(posId.split('_').pop() ?? '0', 10);
    const pos = getConfigLoader().getPosition(state.currentCareerLine, state.currentLevel, idx);
    return pos?.name ?? '';
  });

  const levelProgress = createMemo(() => {
    return Math.min(state.yearsInCurrentPosition * 25, 100);
  });

  /** 子系统入口 */
  const entries: DashboardEntry[] = [
    {
      label: '考核指标',
      path: '/kpi',
      desc: 'KPI 完成率与等次',
      show: () => !!state.currentPositionId,
    },
    {
      label: '部门行动',
      path: '/dept/0',
      desc: '执行行政事务',
      show: () => !!state.currentPositionId,
    },
    {
      label: '晋升提名',
      path: '/promotion',
      desc:
        state.promotionStage === PromotionStage.Idle
          ? '可启动'
          : state.promotionStage === PromotionStage.Completed
            ? '已完成'
            : state.promotionStage === PromotionStage.Failed
              ? '已失败'
              : '进行中',
      show: () => !!state.currentPositionId && state.promotionStage !== PromotionStage.Completed,
    },
    {
      label: '上级关系',
      path: '/superior',
      desc: `${state.superiorFavor} 好感`,
      show: () => true,
    },
    {
      label: '人脉网络',
      path: '/relations',
      desc: '社交关系管理',
      show: () => true,
    },
    {
      label: '个人生活',
      path: '/personal',
      desc: '住房/子女/健康',
      show: () => true,
    },
    {
      label: '档案成就',
      path: '/archives',
      desc: `${state.achievements.length} 项`,
      show: () => true,
    },
  ];

  const visibleEntries = createMemo(() => entries.filter((e) => e.show()));

  return (
    <div
      style={{
        ...pageBase,
        padding: '0',
        overflow: 'hidden',
      }}
    >
      {/* 身份卡片 */}
      <div
        style={{
          padding: '1rem 1rem 0.5rem',
        }}
      >
        <div
          style={{
            ...darkCardStyle('1rem'),
          }}
        >
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'flex-start',
              'margin-bottom': '0.5rem',
            }}
          >
            <div>
              <div style={{ 'font-size': '1.3rem', 'font-weight': 'bold' }}>
                {state.characterName || '未创建角色'}
              </div>
              <Show when={positionName()}>
                <div style={{ 'font-size': '0.85rem', color: colors.textSecondary }}>
                  {positionName()} · 行政线 L{state.currentLevel}
                </div>
              </Show>
            </div>
            <div style={{ 'text-align': 'right' }}>
              <div style={{ 'font-size': '0.85rem', color: colors.textSecondary }}>
                {formatDate(state.time.year, state.time.month, state.time.day)}
              </div>
              <div style={{ 'font-size': '0.8rem', color: colors.textMuted }}>
                累计 {state.totalDaysPlayed} 天
              </div>
            </div>
          </div>

          {/* 任期进度条 */}
          <div style={{ 'margin-top': '0.5rem' }}>
            <div
              style={{
                display: 'flex',
                'justify-content': 'space-between',
                'font-size': '0.75rem',
                color: colors.textSecondary,
                'margin-bottom': '0.3rem',
              }}
            >
              <span>任职 {state.yearsInCurrentPosition} 年</span>
              <span>任期进度 {levelProgress()}%</span>
            </div>
            <div
              style={{
                height: '3px',
                'background-color': colors.border,
                'border-radius': radius.sm,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${levelProgress()}%`,
                  height: '100%',
                  'background-color': colors.primary,
                  'border-radius': radius.sm,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 槽位卡片 */}
      <div style={{ padding: '0 1rem 0.5rem' }}>
        <div
          style={{
            background: `linear-gradient(135deg, ${colors.primaryLight}, transparent)`,
            border: `1px solid ${colors.primary}`,
            'border-radius': radius.md,
            padding: '0.8rem 1rem',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
          }}
        >
          <div>
            <div style={{ 'font-size': '0.75rem', color: colors.textSecondary }}>行动槽位</div>
            <div style={{ 'font-size': '1.8rem', 'font-weight': 'bold', color: colors.primary }}>
              {state.slots.available}
              <span style={{ 'font-size': '1rem', color: colors.textMuted }}>
                /{state.slots.max}
              </span>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              height: '6px',
              'background-color': colors.border,
              'border-radius': radius.sm,
              overflow: 'hidden',
              'margin-left': '1rem',
            }}
          >
            <div
              style={{
                width: `${(state.slots.available / Math.max(state.slots.max, 1)) * 100}%`,
                height: '100%',
                'background-color': colors.primary,
                'border-radius': radius.sm,
              }}
            />
          </div>
        </div>
      </div>

      {/* 粒度切换 */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
        }}
      >
        <For each={granularities}>
          {(g) => (
            <button
              onClick={() => dispatch({ type: 'SET_GRANULARITY', granularity: g })}
              style={{
                flex: 1,
                padding: '0.5rem',
                'font-size': '0.85rem',
                'background-color': state.time.granularity === g ? colors.primary : colors.bgCard,
                color: state.time.granularity === g ? colors.primaryText : colors.textSecondary,
                border:
                  state.time.granularity === g
                    ? `1px solid ${colors.primary}`
                    : `1px solid ${colors.border}`,
                'border-radius': radius.md,
                cursor: 'pointer',
              }}
            >
              {formatGranularity(g)}
            </button>
          )}
        </For>
      </div>

      {/* 推进时间按钮 */}
      <div style={{ padding: '0.5rem 1rem' }}>
        <button
          onClick={() => dispatch({ type: 'ADVANCE_TIME', granularity: state.time.granularity })}
          style={{
            width: '100%',
            padding: '0.9rem',
            'font-size': '1.05rem',
            'font-family': font.title,
            'background-color': colors.primary,
            color: colors.primaryText,
            border: 'none',
            'border-radius': radius.md,
            cursor: 'pointer',
            'letter-spacing': '0.1rem',
          }}
        >
          ◆ 推进时间
        </button>
      </div>

      {/* 分隔线 */}
      <div
        style={{
          height: '1px',
          'background-color': colors.border,
          margin: '0.5rem 1rem',
        }}
      />

      {/* 入口网格 */}
      <div
        style={{
          flex: 1,
          'overflow-y': 'auto',
          padding: '0.5rem 1rem 1rem',
          display: 'grid',
          'grid-template-columns': '1fr 1fr',
          gap: '0.5rem',
          'align-content': 'start',
        }}
      >
        <For each={visibleEntries()}>
          {(entry) => (
            <div
              onClick={() => navigate(entry.path)}
              style={{
                ...cardStyle('0.8rem'),
                display: 'flex',
                'flex-direction': 'column',
                gap: '0.3rem',
                cursor: 'pointer',
                'min-height': '80px',
              }}
            >
              <div
                style={{
                  'font-size': '0.95rem',
                  'font-weight': 'bold',
                  color: colors.textDark,
                }}
              >
                {entry.label}
              </div>
              <div style={{ 'font-size': '0.78rem', color: colors.textMuted }}>{entry.desc}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
