/**
 * 晋升任命页
 *
 * 处理晋升流程的全阶段交互：
 * - 阶段步骤指示器（7 阶段轮盘）
 * - 当前阶段详情与玩家选择按钮
 * - 风险画像（优势 / 短板）
 *
 * 双列布局：
 * - 左侧：流程阶段 + 操作按钮
 * - 右侧：风险画像
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { AppShell } from '../../components/app-shell';
import { PageHeader } from '../../components/page-header';
import { getConfigLoader } from '../../config/loader';
import { PromotionStage } from '../../types/enums';
import { calculateKPI } from '../../engine/governance/kpi';
import { parsePositionIndex } from '../../utils/position';
import { colors, font, darkCardStyle } from '../../utils/theme';

const STAGE_LABELS: Record<PromotionStage, string> = {
  [PromotionStage.Idle]: '待触发',
  [PromotionStage.DemocraticVote]: '民主推荐',
  [PromotionStage.OrgInspection]: '组织考察',
  [PromotionStage.JointReview]: '多部门联审',
  [PromotionStage.CommitteeVote]: '常委会票决',
  [PromotionStage.PublicNotice]: '任前公示',
  [PromotionStage.Appointment]: '正式任命',
  [PromotionStage.Probation]: '试用期考察',
  [PromotionStage.Completed]: '晋升成功',
  [PromotionStage.Failed]: '晋升失败',
};

const ACTIVE_STAGES: PromotionStage[] = [
  PromotionStage.DemocraticVote,
  PromotionStage.OrgInspection,
  PromotionStage.JointReview,
  PromotionStage.CommitteeVote,
  PromotionStage.PublicNotice,
  PromotionStage.Appointment,
  PromotionStage.Probation,
];

/**
 * 晋升任命页组件。
 *
 * @returns 晋升任命页 JSX
 */
export function CareerPage() {
  const { state, dispatch } = useGameStore();

  const hasNextLevel = createMemo(() => {
    const line = getConfigLoader().getCareerLine(state.currentCareerLine);
    const levels = line?.levels;
    if (!levels) return false;
    return levels.some(
      (level) => level.level === state.currentLevel + 1 && level.positions.length > 0,
    );
  });

  const isActive = createMemo(
    () =>
      state.promotionStage !== PromotionStage.Idle &&
      state.promotionStage !== PromotionStage.Completed &&
      state.promotionStage !== PromotionStage.Failed,
  );

  const stageIndex = createMemo(() => {
    if (!isActive()) return -1;
    return ACTIVE_STAGES.indexOf(state.promotionStage);
  });

  const riskProfile = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return { strengths: [], weaknesses: [] };
    const idx = parsePositionIndex(posId);
    if (idx === null) return { strengths: [], weaknesses: [] };
    const position = getConfigLoader().getPosition(
      state.currentCareerLine,
      state.currentLevel,
      idx,
    );
    if (!position) return { strengths: [], weaknesses: [] };
    const kpi = calculateKPI(
      position.kpiIndicators,
      state.departmentStates,
      getConfigLoader().getGameConfig(),
    );
    if (!kpi) return { strengths: [], weaknesses: [] };

    const sorted = [...kpi.indicators].sort((a, b) => a.completionRate - b.completionRate);
    return {
      strengths: sorted
        .slice(-3)
        .filter((i) => i.completionRate > 0.6)
        .map((i) => ({
          label: i.name,
          pct: i.completionRate,
        })),
      weaknesses: sorted
        .slice(0, 3)
        .filter((i) => i.completionRate < 0.8)
        .map((i) => ({
          label: i.name,
          pct: i.completionRate,
        })),
    };
  });

  const hasChoices = createMemo(
    () =>
      state.promotionStage === PromotionStage.DemocraticVote ||
      state.promotionStage === PromotionStage.OrgInspection,
  );

  return (
    <AppShell>
      <PageHeader title="晋升任命" desc="民主推荐、组织考察、常委会票决" />
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'minmax(0, 1fr) minmax(300px, 0.72fr)',
          gap: '16px',
        }}
      >
        {/* 左侧：流程阶段 */}
        <article style={{ ...darkCardStyle('16px') }}>
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              gap: '12px',
              'align-items': 'flex-start',
              'margin-bottom': '14px',
            }}
          >
            <div>
              <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>流程阶段</h3>
              <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
                {isActive()
                  ? `当前停留在${STAGE_LABELS[state.promotionStage]}`
                  : '暂无进行中的晋升流程'}
              </p>
            </div>
          </div>

          {/* Idle 状态：启动晋升 */}
          <Show when={state.promotionStage === PromotionStage.Idle}>
            <div style={{ 'text-align': 'center', padding: '1.5rem 0' }}>
              <p style={{ 'margin-bottom': '0.8rem' }}>
                年度考核通过，获得晋升提名资格。是否启动晋升流程？
              </p>
              <p
                style={{ 'font-size': '0.85rem', color: colors.danger, 'margin-bottom': '1.5rem' }}
              >
                警告：晋升成功后原有岗位专属职权和事件将被永久清空。
              </p>
              <Show
                when={hasNextLevel()}
                fallback={
                  <div style={{ color: colors.textMuted, 'margin-top': '1rem' }}>
                    已达当前版本最高等级
                  </div>
                }
              >
                <button
                  onClick={() => dispatch({ type: 'START_PROMOTION' })}
                  style={{
                    padding: '0.8rem 2.5rem',
                    'background-color': colors.primary,
                    color: colors.primaryText,
                    border: 'none',
                    'border-radius': '8px',
                    cursor: 'pointer',
                    'font-size': '1rem',
                    'font-family': font.title,
                  }}
                >
                  启动晋升流程
                </button>
              </Show>
            </div>
          </Show>

          {/* 晋升进行中 */}
          <Show when={isActive()}>
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                gap: '4px',
                'margin-bottom': '1.2rem',
                'flex-wrap': 'wrap',
              }}
            >
              <For each={ACTIVE_STAGES}>
                {(_s, i) => {
                  const idx = stageIndex();
                  let dotColor: string = colors.border;
                  let dotText: string | undefined;
                  if (i() < idx) {
                    dotColor = colors.success;
                    dotText = '\u2713';
                  } else if (i() === idx) {
                    dotColor = colors.primary;
                  }
                  return (
                    <>
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          'border-radius': '50%',
                          'background-color': dotColor,
                          color: i() <= idx ? '#fff' : colors.textMuted,
                          display: 'flex',
                          'align-items': 'center',
                          'justify-content': 'center',
                          'font-size': '0.7rem',
                          'font-weight': 'bold',
                        }}
                      >
                        {dotText ?? i() + 1}
                      </div>
                      <Show when={i() < ACTIVE_STAGES.length - 1}>
                        <div
                          style={{
                            width: '16px',
                            height: '2px',
                            'background-color': i() < idx ? colors.success : colors.border,
                          }}
                        />
                      </Show>
                    </>
                  );
                }}
              </For>
            </div>

            <div style={{ 'text-align': 'center' }}>
              <div
                style={{
                  'font-size': '0.8rem',
                  color: colors.textSecondary,
                  'margin-bottom': '0.3rem',
                }}
              >
                当前阶段
              </div>
              <div
                style={{ 'font-size': '1.2rem', 'font-weight': 'bold', 'margin-bottom': '0.5rem' }}
              >
                {STAGE_LABELS[state.promotionStage]}
              </div>
              <Show when={state.promotionState?.targetLevel !== undefined}>
                <div
                  style={{
                    'font-size': '0.85rem',
                    color: colors.textSecondary,
                    'margin-bottom': '1rem',
                  }}
                >
                  目标职位：L{state.promotionState?.targetLevel}
                </div>
              </Show>
            </div>

            {/* 选择按钮 */}
            <Show when={hasChoices()}>
              <p
                style={{ 'text-align': 'center', 'margin-bottom': '0.8rem', 'font-size': '0.9rem' }}
              >
                {state.promotionStage === PromotionStage.DemocraticVote
                  ? '是否动用人脉拉票？（+10得票，30%概率留下负面记录）'
                  : '是否引导考察组？（消耗20政治资本，+8考核分）'}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() =>
                    dispatch({
                      type: 'PROMOTION_RESOLVE_STAGE',
                      choices:
                        state.promotionStage === PromotionStage.DemocraticVote
                          ? { useConnections: false }
                          : { influenceInspectors: false },
                    })
                  }
                  style={{
                    flex: 1,
                    padding: '0.6rem',
                    'background-color': colors.bgCard,
                    color: colors.textSecondary,
                    border: `1px solid ${colors.border}`,
                    'border-radius': '8px',
                    cursor: 'pointer',
                  }}
                >
                  {state.promotionStage === PromotionStage.DemocraticVote ? '不使用人脉' : '不引导'}
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: 'PROMOTION_RESOLVE_STAGE',
                      choices:
                        state.promotionStage === PromotionStage.DemocraticVote
                          ? { useConnections: true }
                          : { influenceInspectors: true },
                    })
                  }
                  style={{
                    flex: 1,
                    padding: '0.6rem',
                    'background-color': colors.primary,
                    color: colors.primaryText,
                    border: 'none',
                    'border-radius': '8px',
                    cursor: 'pointer',
                  }}
                >
                  {state.promotionStage === PromotionStage.DemocraticVote
                    ? '动用关系拉票'
                    : '引导考察组'}
                </button>
              </div>
            </Show>

            <Show when={!hasChoices()}>
              <button
                onClick={() => dispatch({ type: 'PROMOTION_RESOLVE_STAGE' })}
                style={{
                  width: '100%',
                  padding: '0.7rem',
                  'background-color': colors.primary,
                  color: colors.primaryText,
                  border: 'none',
                  'border-radius': '8px',
                  cursor: 'pointer',
                  'font-size': '1rem',
                  'font-family': font.title,
                }}
              >
                推进到下一阶段
              </button>
            </Show>
          </Show>

          {/* Completed */}
          <Show when={state.promotionStage === PromotionStage.Completed}>
            <div style={{ 'text-align': 'center', padding: '1rem 0' }}>
              <div
                style={{
                  color: colors.success,
                  'font-size': '1.4rem',
                  'margin-bottom': '1rem',
                  'font-weight': 'bold',
                }}
              >
                晋升成功
              </div>
              <p style={{ color: colors.textSecondary, 'margin-bottom': '1rem' }}>
                试用期考核合格，正式定岗为新职位。
              </p>
              <Show
                when={hasNextLevel()}
                fallback={
                  <button
                    onClick={() => dispatch({ type: 'RESET_PROMOTION' })}
                    style={{
                      padding: '0.6rem 1.5rem',
                      'background-color': colors.primary,
                      color: colors.primaryText,
                      border: 'none',
                      'border-radius': '8px',
                      cursor: 'pointer',
                    }}
                  >
                    继续任职
                  </button>
                }
              >
                <button
                  onClick={() => dispatch({ type: 'RESET_PROMOTION' })}
                  style={{
                    padding: '0.6rem 1.5rem',
                    'background-color': colors.success,
                    color: '#fff',
                    border: 'none',
                    'border-radius': '8px',
                    cursor: 'pointer',
                  }}
                >
                  开始新任期
                </button>
              </Show>
            </div>
          </Show>

          {/* Failed */}
          <Show when={state.promotionStage === PromotionStage.Failed}>
            <div style={{ 'text-align': 'center', padding: '1rem 0' }}>
              <div
                style={{
                  color: colors.danger,
                  'font-size': '1.3rem',
                  'margin-bottom': '1rem',
                  'font-weight': 'bold',
                }}
              >
                晋升失败
              </div>
              <p style={{ color: colors.textSecondary, 'margin-bottom': '1.5rem' }}>
                本次晋升未通过，消沉值增加。可等待下次年度考核后重新尝试。
              </p>
              <button
                onClick={() => dispatch({ type: 'RESET_PROMOTION' })}
                style={{
                  padding: '0.6rem 1.5rem',
                  'background-color': colors.primary,
                  color: colors.primaryText,
                  border: 'none',
                  'border-radius': '8px',
                  cursor: 'pointer',
                }}
              >
                关闭
              </button>
            </div>
          </Show>
        </article>

        {/* 右侧：风险画像 */}
        <article style={{ ...darkCardStyle('16px') }}>
          <div style={{ 'margin-bottom': '14px' }}>
            <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>风险画像</h3>
            <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
              把晋升决策拆成独立页面后，玩家能更清楚地准备材料。
            </p>
          </div>

          <div
            style={{
              padding: '15px',
              border: `1px solid ${colors.border}`,
              'border-radius': '8px',
              background: '#fff',
            }}
          >
            <h3 style={{ 'font-size': '16px' }}>优势</h3>
            <p
              style={{
                'margin-top': '8px',
                color: colors.textMuted,
                'font-size': '13px',
                'line-height': '1.6',
              }}
            >
              以下 KPI 完成度较高，有利于考核与联审阶段。
            </p>
            <Show
              when={riskProfile().strengths.length > 0}
              fallback={
                <p style={{ 'margin-top': '8px', color: colors.textMuted, 'font-size': '13px' }}>
                  暂无突出优势指标。
                </p>
              }
            >
              <div
                style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '7px', 'margin-top': '12px' }}
              >
                <For each={riskProfile().strengths}>
                  {(s) => (
                    <span
                      style={{
                        padding: '4px 7px',
                        'border-radius': '999px',
                        background: colors.successLight,
                        color: colors.success,
                        'font-size': '12px',
                        'font-weight': 800,
                      }}
                    >
                      {s.label} +{(s.pct * 100).toFixed(0)}%
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div
            style={{
              padding: '15px',
              border: `1px solid ${colors.border}`,
              'border-radius': '8px',
              background: '#fff',
              'margin-top': '12px',
            }}
          >
            <h3 style={{ 'font-size': '16px' }}>短板</h3>
            <p
              style={{
                'margin-top': '8px',
                color: colors.textMuted,
                'font-size': '13px',
                'line-height': '1.6',
              }}
            >
              以下 KPI 完成度不足，建议优先安排对应行动。
            </p>
            <Show
              when={riskProfile().weaknesses.length > 0}
              fallback={
                <p style={{ 'margin-top': '8px', color: colors.textMuted, 'font-size': '13px' }}>
                  暂无显著短板。
                </p>
              }
            >
              <div
                style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '7px', 'margin-top': '12px' }}
              >
                <For each={riskProfile().weaknesses}>
                  {(w) => (
                    <span
                      style={{
                        padding: '4px 7px',
                        'border-radius': '999px',
                        background: colors.warningLight,
                        color: colors.warning,
                        'font-size': '12px',
                        'font-weight': 800,
                      }}
                    >
                      {w.label} {(w.pct * 100).toFixed(0)}%
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </article>
      </div>

      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
