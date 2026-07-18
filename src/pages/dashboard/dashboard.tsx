/**
 * 仪表盘（主界面 — 折叠面板版）
 *
 * 所有子系统合并为一个页面：
 * 1. 顶部状态栏（永远可见）— 个人信息 + 时间 + 推进按钮 + 完成通知
 * 2. 行动槽位 — 三级长条进度条（主要/次要/备用）
 * 3. 部门行动 — Tab 切换部门 + 启动按钮
 * 4. KPI 概览 — 折叠面板
 * 5. 晋升状态 — 折叠面板（含晋升流程交互）
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import type { SlotOccupant, SlotTierKey } from '../../types/player';
import { formatDate } from '../../utils/format';
import { calculateKPI } from '../../engine/governance/kpi';
import { hasActiveActions } from '../../engine/core/action';
import { getConfigLoader } from '../../config/loader';
import { PromotionStage, KPITier } from '../../types/enums';
import type { TimeGranularity } from '../../types/enums';
import { colors, radius, pageBase, darkCardStyle, progressBarColor } from '../../utils/theme';
import type { KPIResult } from '../../types/game';
import type { ActionCategory } from '../../types/config';
import { FeatureRoadmap } from '../../components/feature-roadmap';
import { parsePositionIndex } from '../../utils/position';

const TIER_COLOR: Record<SlotTierKey, string> = {
  primary: '#4A6FA5',
  secondary: '#6B8E6B',
  reserve: '#C44D4D',
};

const CATEGORY_LABEL: Record<ActionCategory, string> = {
  major: '重大',
  minor: '次要',
  routine: '日常',
};

const CATEGORY_COLOR: Record<ActionCategory, string> = {
  major: '#C44D4D',
  minor: '#E6A817',
  routine: '#6B8E6B',
};

/** 各级槽位按钮的显示顺序 */
const TIER_BUTTONS: { key: SlotTierKey; label: string }[] = [
  { key: 'primary', label: '主要' },
  { key: 'secondary', label: '次要' },
  { key: 'reserve', label: '加班' },
];

const GRANULARITIES: { key: TimeGranularity; label: string; days: number }[] = [
  { key: 'day', label: '推进1天', days: 1 },
  { key: 'week', label: '推进7天', days: 7 },
  { key: 'month', label: '推进30天', days: 30 },
];

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

function CollapsiblePanel(props: {
  title: string;
  defaultOpen?: boolean;
  children: import('solid-js').JSX.Element;
}) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? true);
  return (
    <div style={{ 'border-bottom': `1px solid ${colors.border}` }}>
      <div
        onClick={() => setOpen(!open())}
        style={{
          padding: '0.7rem 1rem',
          'font-size': '0.9rem',
          'font-weight': 'bold',
          cursor: 'pointer',
          display: 'flex',
          'justify-content': 'space-between',
          'user-select': 'none',
        }}
      >
        <span>
          {open() ? '▾' : '▸'} {props.title}
        </span>
      </div>
      <Show when={open()}>
        <div style={{ padding: '0 1rem 0.8rem' }}>{props.children}</div>
      </Show>
    </div>
  );
}

export function Dashboard() {
  const { state, dispatch } = useGameStore();

  const [activeDeptIdx, setActiveDeptIdx] = createSignal(0);

  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    const idx = parsePositionIndex(posId);
    if (idx === null) return null;
    return getConfigLoader().getPosition(state.currentCareerLine, state.currentLevel, idx);
  });

  const allDepts = createMemo(() => positionConfig()?.departments ?? []);
  const currentDept = createMemo(() => allDepts()[activeDeptIdx()] ?? null);

  const kpiResults = createMemo(() => {
    const pos = positionConfig();
    if (!pos) return { indicators: [] as KPIResult[], totalScore: 0, tier: KPITier.Basic };
    const cfg = getConfigLoader().getGameConfig();
    return calculateKPI(pos.kpiIndicators, state.departmentStates, cfg);
  });

  const isActivePromotion = createMemo(
    () =>
      state.promotionStage !== PromotionStage.Idle &&
      state.promotionStage !== PromotionStage.Completed &&
      state.promotionStage !== PromotionStage.Failed,
  );

  const promotionHasChoices = createMemo(
    () =>
      state.promotionStage === PromotionStage.DemocraticVote ||
      state.promotionStage === PromotionStage.OrgInspection,
  );

  const hasNextLevel = createMemo(() => {
    const line = getConfigLoader().getCareerLine(state.currentCareerLine);
    return (
      line?.levels.some(
        (level) => level.level === state.currentLevel + 1 && level.positions.length > 0,
      ) ?? false
    );
  });

  const hasPendingActions = createMemo(() => hasActiveActions(state.slots));

  function startAction(deptId: string, actionId: string, tierKey: SlotTierKey) {
    dispatch({ type: 'START_ACTION', deptId, actionId, tierKey });
  }

  return (
    <div style={{ ...pageBase, padding: '0', overflow: 'hidden' }}>
      {/* ═══ 顶部状态栏（永远可见）═══ */}
      <div
        style={{
          padding: '0.8rem 1rem',
          'border-bottom': `2px solid ${colors.primary}`,
          'background-color': colors.bgCard,
        }}
      >
        <div
          style={{ display: 'flex', 'justify-content': 'space-between', 'margin-bottom': '0.4rem' }}
        >
          <div>
            <span style={{ 'font-size': '1.1rem', 'font-weight': 'bold' }}>
              {state.characterName || '未创建角色'}
            </span>
            <Show when={positionConfig()}>
              <span
                style={{
                  'font-size': '0.8rem',
                  color: colors.textSecondary,
                  'margin-left': '0.6rem',
                }}
              >
                {positionConfig()?.name} · L{state.currentLevel}
              </span>
            </Show>
          </div>
          <div
            style={{ 'text-align': 'right', 'font-size': '0.8rem', color: colors.textSecondary }}
          >
            {formatDate(state.time.year, state.time.month, state.time.day)}
            <div style={{ 'font-size': '0.7rem', color: colors.textMuted }}>
              累计 {state.totalDaysPlayed} 天
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            'font-size': '0.78rem',
            color: colors.textSecondary,
            'margin-bottom': '0.5rem',
          }}
        >
          <span>预算: {state.remainingBudget}万</span>
          <span>❤️ {state.health}</span>
          <span>消沉: {state.demoralization}</span>
          <Show when={positionConfig()}>
            <span>任职 {state.yearsInCurrentPosition} 年</span>
          </Show>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <For each={GRANULARITIES}>
            {(g) => (
              <button
                onClick={() => dispatch({ type: 'ADVANCE_TIME', granularity: g.key })}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  'font-size': '0.8rem',
                  'background-color': colors.primary,
                  color: colors.primaryText,
                  border: 'none',
                  'border-radius': radius.sm,
                  cursor: 'pointer',
                }}
              >
                {g.label}
              </button>
            )}
          </For>
        </div>
        <Show when={state.lastCompletedActions.length > 0}>
          <div style={{ 'margin-top': '0.4rem', 'font-size': '0.75rem', color: colors.success }}>
            <For each={state.lastCompletedActions.slice(0, 3)}>
              {(n) => (
                <div>
                  ▶ {n.actionName}（{n.effects.join('、')}）
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <FeatureRoadmap />

      {/* ═══ 行动槽位 ═══ */}
      <CollapsiblePanel title="行动槽位" defaultOpen={true}>
        <For each={Object.entries(state.slots) as [SlotTierKey, typeof state.slots.primary][]}>
          {([tierKey, tier]) => (
            <div style={{ 'margin-bottom': '0.6rem' }}>
              <div
                style={{
                  'font-size': '0.75rem',
                  'font-weight': 'bold',
                  color: TIER_COLOR[tierKey] || colors.textSecondary,
                  'margin-bottom': '0.3rem',
                }}
              >
                {tier.label} (
                {`${tier.occupants.filter((o: SlotOccupant | null) => o !== null).length}/${tier.count}`}
                )
                {tierKey === 'reserve' && (
                  <span
                    style={{
                      'font-size': '0.7rem',
                      color: colors.warning,
                      'margin-left': '0.5rem',
                    }}
                  >
                    {`\u26A0\uFE0F 健康${getConfigLoader().getGameConfig().reservePenalty.health} 消沉+${getConfigLoader().getGameConfig().reservePenalty.demoralization}`}
                  </span>
                )}
              </div>
              <For each={tier.occupants}>
                {(occupant: SlotOccupant | null) => {
                  if (occupant) {
                    const elapsed = state.totalDaysPlayed - occupant.startedAtDay;
                    const pct = Math.min((elapsed / occupant.durationDays) * 100, 100);
                    return (
                      <div
                        style={{
                          height: '22px',
                          'background-color': '#2a2a3a',
                          'border-radius': radius.sm,
                          'margin-bottom': '0.2rem',
                          display: 'flex',
                          'align-items': 'center',
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            'background-color': TIER_COLOR[tierKey] || colors.primary,
                            'border-radius': radius.sm,
                            transition: 'width 0.3s',
                          }}
                        />
                        <span
                          style={{
                            position: 'absolute',
                            left: '8px',
                            'font-size': '0.72rem',
                            color: '#fff',
                            'text-shadow': '0 0 3px rgba(0,0,0,0.6)',
                          }}
                        >
                          {occupant.actionName} {elapsed}/{occupant.durationDays}天
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div
                      style={{
                        height: '22px',
                        'background-color': '#1e1e2e',
                        border: `1px dashed ${colors.border}`,
                        'border-radius': radius.sm,
                        'margin-bottom': '0.2rem',
                        display: 'flex',
                        'align-items': 'center',
                        'justify-content': 'center',
                        'font-size': '0.72rem',
                        color: colors.textMuted,
                      }}
                    >
                      (空闲)
                    </div>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </CollapsiblePanel>

      {/* ═══ 部门行动 ═══ */}
      <CollapsiblePanel title="部门行动" defaultOpen={true}>
        <Show
          when={allDepts().length > 0}
          fallback={
            <div style={{ color: colors.textMuted, 'font-size': '0.8rem' }}>暂无部门数据</div>
          }
        >
          {/* 部门 Tab */}
          <div
            style={{
              display: 'flex',
              gap: '0.2rem',
              'overflow-x': 'auto',
              'margin-bottom': '0.6rem',
            }}
          >
            <For each={allDepts()}>
              {(dept, idx) => (
                <button
                  onClick={() => setActiveDeptIdx(idx())}
                  style={{
                    padding: '0.3rem 0.6rem',
                    'font-size': '0.78rem',
                    'background-color': idx() === activeDeptIdx() ? colors.primary : colors.bgCard,
                    color: idx() === activeDeptIdx() ? colors.primaryText : colors.textSecondary,
                    border: `1px solid ${idx() === activeDeptIdx() ? colors.primary : colors.border}`,
                    'border-radius': radius.sm,
                    cursor: 'pointer',
                    'white-space': 'nowrap',
                  }}
                >
                  {dept.name}
                </button>
              )}
            </For>
          </div>

          {/* 行动列表 */}
          <Show when={currentDept()}>
            {(dept) => (
              <For each={dept().actions}>
                {(action) => {
                  const categoryCfg = CATEGORY_LABEL[action.category] ?? action.category;
                  const catColor = CATEGORY_COLOR[action.category] ?? colors.textSecondary;

                  const deptState = state.departmentStates[dept().id];
                  const cooldownUntil = deptState?.actionCooldownUntilDays?.[action.id] ?? 0;
                  const onCooldown =
                    action.category !== 'routine' && state.totalDaysPlayed < cooldownUntil;
                  const cooldownRemain = onCooldown ? cooldownUntil - state.totalDaysPlayed : 0;

                  const isRunningThisDept = (Object.keys(state.slots) as SlotTierKey[]).some((k) =>
                    state.slots[k].occupants.some(
                      (o: SlotOccupant | null) =>
                        o?.actionId === action.id && o?.deptId === dept().id,
                    ),
                  );

                  return (
                    <div
                      style={{
                        ...darkCardStyle('0.5rem 0.8rem'),
                        'margin-bottom': '0.4rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          'justify-content': 'space-between',
                          'align-items': 'center',
                        }}
                      >
                        <div style={{ flex: 1, 'min-width': 0 }}>
                          <div style={{ 'font-size': '0.85rem', 'font-weight': 'bold' }}>
                            {action.name}
                            <span
                              style={{
                                'font-size': '0.65rem',
                                'margin-left': '0.4rem',
                                padding: '0.1rem 0.3rem',
                                'border-radius': radius.sm,
                                'background-color': catColor + '33',
                                color: catColor,
                              }}
                            >
                              {categoryCfg}
                            </span>
                          </div>
                          <div style={{ 'font-size': '0.7rem', color: colors.textMuted }}>
                            {action.durationDays}天 · 预算{action.budgetDelta}万
                            {action.cooldownDays > 0 && ` · 冷却${action.cooldownDays}天`}
                            <Show when={action.effects.length > 0}>
                              {' · '}
                              {action.effects
                                .map((e) => {
                                  const label = e.target
                                    .replace('dept.kpi.', '')
                                    .replace('player.', '');
                                  return `${label}${e.value >= 0 ? '+' : ''}${e.value}`;
                                })
                                .join(' ')}
                            </Show>
                          </div>
                        </div>
                        <Show when={isRunningThisDept}>
                          <span
                            style={{
                              'font-size': '0.75rem',
                              color: colors.primary,
                              'margin-right': '0.5rem',
                              'white-space': 'nowrap',
                            }}
                          >
                            执行中
                          </span>
                        </Show>
                      </div>

                      {/* 冷却提示 */}
                      <Show when={onCooldown}>
                        <div
                          style={{
                            'font-size': '0.7rem',
                            color: colors.warning,
                            'margin-top': '0.3rem',
                          }}
                        >
                          冷却还剩 {cooldownRemain} 天
                        </div>
                      </Show>

                      {/* 槽位等级按钮 */}
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.3rem',
                          'margin-top': '0.4rem',
                          'flex-wrap': 'wrap',
                        }}
                      >
                        <For each={TIER_BUTTONS}>
                          {(tb) => {
                            const disallowedByCategory =
                              action.category === 'major' && tb.key !== 'primary';
                            if (disallowedByCategory) return null;

                            const tierGroup = state.slots[tb.key];
                            const hasFree = tierGroup.occupants.some(
                              (o: SlotOccupant | null) => o === null,
                            );
                            const blockedByDuplicate =
                              action.category !== 'routine' && isRunningThisDept;
                            const insufficientBudget = state.remainingBudget < action.budgetDelta;
                            const disabled =
                              insufficientBudget || !hasFree || blockedByDuplicate || onCooldown;

                            let tooltip = '';
                            if (insufficientBudget) tooltip = '预算不足';
                            else if (!hasFree) tooltip = '槽位已满';
                            else if (blockedByDuplicate) tooltip = '执行中';
                            else if (onCooldown) tooltip = `冷却${cooldownRemain}天`;

                            return (
                              <button
                                onClick={() => startAction(dept().id, action.id, tb.key)}
                                disabled={disabled}
                                title={tooltip}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  'font-size': '0.72rem',
                                  'background-color': disabled
                                    ? colors.border
                                    : tb.key === 'reserve'
                                      ? colors.danger
                                      : colors.secondary,
                                  color: disabled ? colors.textMuted : colors.white,
                                  border: 'none',
                                  'border-radius': radius.sm,
                                  cursor: disabled ? 'not-allowed' : 'pointer',
                                  'white-space': 'nowrap',
                                }}
                              >
                                {tb.label}
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  );
                }}
              </For>
            )}
          </Show>
        </Show>
      </CollapsiblePanel>

      {/* ═══ KPI 概览 ═══ */}
      <CollapsiblePanel title="KPI 概览" defaultOpen={false}>
        <For each={kpiResults().indicators}>
          {(kpi: KPIResult) => (
            <div style={{ 'margin-bottom': '0.5rem' }}>
              <div
                style={{
                  display: 'flex',
                  'justify-content': 'space-between',
                  'font-size': '0.78rem',
                }}
              >
                <span>{kpi.name}</span>
                <span style={{ color: colors.textSecondary }}>
                  {kpi.currentValue}/{kpi.targetValue}
                </span>
              </div>
              <div
                style={{
                  height: '4px',
                  'background-color': colors.border,
                  'border-radius': radius.sm,
                  overflow: 'hidden',
                  'margin-top': '0.2rem',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(kpi.completionRate * 100, 150)}%`,
                    height: '100%',
                    'background-color': progressBarColor(kpi.completionRate),
                    'border-radius': radius.sm,
                  }}
                />
              </div>
            </div>
          )}
        </For>
      </CollapsiblePanel>

      {/* ═══ 晋升状态 ═══ */}
      <CollapsiblePanel title="晋升状态" defaultOpen={false}>
        <div style={{ 'font-size': '0.8rem' }}>
          <div style={{ 'margin-bottom': '0.5rem' }}>
            当前阶段: <strong>{STAGE_LABELS[state.promotionStage] ?? '未知'}</strong>
            <Show when={state.frozenPeriods > 0}>
              <span style={{ color: colors.warning, 'margin-left': '0.5rem' }}>
                (冻结 {state.frozenPeriods} 期)
              </span>
            </Show>
          </div>

          <Show when={state.promotionStage === PromotionStage.Idle}>
            <Show
              when={hasNextLevel()}
              fallback={<div style={{ color: colors.textMuted }}>已达当前版本最高等级</div>}
            >
              <button
                onClick={() => dispatch({ type: 'START_PROMOTION' })}
                disabled={state.frozenPeriods > 0 || hasPendingActions()}
                style={{
                  padding: '0.5rem 1rem',
                  'font-size': '0.85rem',
                  'background-color':
                    state.frozenPeriods > 0 || hasPendingActions() ? colors.border : colors.primary,
                  color:
                    state.frozenPeriods > 0 || hasPendingActions()
                      ? colors.textMuted
                      : colors.primaryText,
                  border: 'none',
                  'border-radius': radius.sm,
                  cursor:
                    state.frozenPeriods > 0 || hasPendingActions() ? 'not-allowed' : 'pointer',
                  'margin-bottom': '0.5rem',
                }}
              >
                启动晋升
              </button>
              <Show when={hasPendingActions()}>
                <div style={{ color: colors.warning }}>请先完成当前行动，再启动晋升</div>
              </Show>
            </Show>
          </Show>

          <Show when={isActivePromotion()}>
            <div style={{ 'margin-bottom': '0.5rem' }}>
              目标: L{state.promotionState?.targetLevel ?? '?'}
            </div>

            <Show when={promotionHasChoices()}>
              <div
                style={{
                  display: 'flex',
                  gap: '0.4rem',
                  'flex-wrap': 'wrap',
                  'margin-bottom': '0.5rem',
                }}
              >
                <button
                  onClick={() =>
                    dispatch({
                      type: 'PROMOTION_RESOLVE_STAGE',
                      choices: { useConnections: false },
                    })
                  }
                  style={btnStyle()}
                >
                  常规推进
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: 'PROMOTION_RESOLVE_STAGE',
                      choices: { useConnections: true },
                    })
                  }
                  style={btnStyle()}
                >
                  动用关系
                </button>
              </div>
              <Show when={state.promotionStage === PromotionStage.OrgInspection}>
                <button
                  onClick={() =>
                    dispatch({
                      type: 'PROMOTION_RESOLVE_STAGE',
                      choices: { influenceInspectors: true },
                    })
                  }
                  style={btnStyle()}
                >
                  影响考察组
                </button>
              </Show>
            </Show>

            <Show when={!promotionHasChoices()}>
              <button
                onClick={() => dispatch({ type: 'PROMOTION_RESOLVE_STAGE' })}
                style={btnStyle()}
              >
                推进阶段
              </button>
            </Show>
          </Show>

          <Show when={state.promotionStage === PromotionStage.Completed}>
            <div style={{ color: colors.success, 'margin-bottom': '0.5rem' }}>晋升成功！</div>
            <Show
              when={hasNextLevel()}
              fallback={
                <>
                  <div style={{ color: colors.textMuted, 'margin-bottom': '0.5rem' }}>
                    已达当前版本最高等级
                  </div>
                  <button onClick={() => dispatch({ type: 'RESET_PROMOTION' })} style={btnStyle()}>
                    继续任职
                  </button>
                </>
              }
            >
              <button onClick={() => dispatch({ type: 'RESET_PROMOTION' })} style={btnStyle()}>
                开始新任期
              </button>
            </Show>
          </Show>

          <Show when={state.promotionStage === PromotionStage.Failed}>
            <div style={{ color: colors.warning, 'margin-bottom': '0.3rem' }}>晋升失败</div>
            <button onClick={() => dispatch({ type: 'RESET_PROMOTION' })} style={btnStyle()}>
              关闭
            </button>
          </Show>
        </div>
      </CollapsiblePanel>
    </div>
  );
}

function btnStyle() {
  return {
    padding: '0.4rem 0.8rem',
    'font-size': '0.8rem',
    'background-color': colors.primary,
    color: colors.primaryText,
    border: 'none',
    'border-radius': radius.sm,
    cursor: 'pointer',
  } as const;
}
