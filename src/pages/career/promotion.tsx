/**
 * 晋升流程页面
 *
 * 玩家触发晋升后在此页面跟踪六阶段流程：
 * - 展示当前阶段名称和说明
 * - 有玩家选择的阶段（民主推荐/组织考察）渲染交互按钮
 * - 无选择阶段只显示"推进"按钮
 * - 失败时显示失败原因和关闭按钮
 * - 完成时显示晋升成功确认
 *
 * 晋升中锁定其他操作（ADVANCE_TIME / EXECUTE_ACTION 被 gate 拦截）。
 */

import { createMemo, Show, Switch, Match } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { navigate } from '../../router';
import { PromotionStage } from '../../types/enums';
import { colors, radius, font, pageBase, darkCardStyle } from '../../utils/theme';

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

export function Promotion() {
  const { state, dispatch } = useGameStore();

  const stageLabel = createMemo(() => STAGE_LABELS[state.promotionStage] ?? '未知阶段');
  const hasChoices = createMemo(
    () =>
      state.promotionStage === PromotionStage.DemocraticVote ||
      state.promotionStage === PromotionStage.OrgInspection,
  );
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

  const handleStart = () => dispatch({ type: 'START_PROMOTION' });
  const handleResolve = (choices?: { useConnections?: boolean; influenceInspectors?: boolean }) =>
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', choices });

  return (
    <div style={pageBase}>
      {/* 页头 */}
      <header
        style={{
          display: 'flex',
          'justify-content': 'space-between',
          'align-items': 'center',
          padding: '0.8rem 1rem',
          'border-bottom': `1px solid ${colors.border}`,
        }}
      >
        <h2 style={{ margin: 0, 'font-size': '1.2rem', 'font-family': font.title }}>晋升流程</h2>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '0.3rem 0.8rem',
            'background-color': colors.bgCard,
            color: colors.textSecondary,
            border: `1px solid ${colors.border}`,
            'border-radius': radius.md,
            cursor: 'pointer',
            'font-size': '0.85rem',
          }}
        >
          返回
        </button>
      </header>

      <div style={{ flex: 1, 'overflow-y': 'auto', padding: '1rem' }}>
        <Switch>
          {/* 未触发 */}
          <Match when={state.promotionStage === PromotionStage.Idle}>
            <div style={{ ...darkCardStyle('1.5rem'), 'text-align': 'center' }}>
              <p style={{ 'margin-bottom': '0.8rem' }}>
                年度考核通过，获得晋升提名资格。是否启动晋升流程？
              </p>
              <p
                style={{
                  'font-size': '0.85rem',
                  color: colors.danger,
                  'margin-bottom': '1.5rem',
                }}
              >
                警告：晋升成功后原有岗位专属职权和事件将被永久清空，仅保留职级基础权限，无法回滚。
              </p>
              <button
                onClick={handleStart}
                style={{
                  padding: '0.8rem 2.5rem',
                  'background-color': colors.primary,
                  color: colors.primaryText,
                  border: 'none',
                  'border-radius': radius.md,
                  cursor: 'pointer',
                  'font-size': '1rem',
                  'font-family': font.title,
                }}
              >
                启动晋升流程
              </button>
            </div>
          </Match>

          {/* 失败 */}
          <Match when={state.promotionStage === PromotionStage.Failed}>
            <div style={{ ...darkCardStyle('1.5rem'), 'text-align': 'center' }}>
              <div style={{ color: colors.danger, 'font-size': '1.3rem', 'margin-bottom': '1rem' }}>
                晋升失败
              </div>
              <p style={{ color: colors.textSecondary, 'margin-bottom': '1.5rem' }}>
                本次晋升未通过，消沉值增加。可等待下次年度考核后重新尝试。
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', 'justify-content': 'center' }}>
                <button
                  onClick={() => navigate('/dashboard')}
                  style={{
                    padding: '0.6rem 1.5rem',
                    'background-color': colors.bgCard,
                    color: colors.textSecondary,
                    border: `1px solid ${colors.border}`,
                    'border-radius': radius.md,
                    cursor: 'pointer',
                  }}
                >
                  返回仪表盘
                </button>
                <button
                  onClick={() => {
                    dispatch({
                      type: 'LOAD_SAVE',
                      save: {
                        ...state,
                        promotionStage: PromotionStage.Idle,
                      } as unknown as typeof state,
                    });
                    handleStart();
                  }}
                  style={{
                    padding: '0.6rem 1.5rem',
                    'background-color': colors.primary,
                    color: colors.primaryText,
                    border: 'none',
                    'border-radius': radius.md,
                    cursor: 'pointer',
                  }}
                >
                  重新尝试
                </button>
              </div>
            </div>
          </Match>

          {/* 完成 */}
          <Match when={state.promotionStage === PromotionStage.Completed}>
            <div style={{ ...darkCardStyle('1.5rem'), 'text-align': 'center' }}>
              <div
                style={{ color: colors.success, 'font-size': '1.4rem', 'margin-bottom': '1rem' }}
              >
                晋升成功
              </div>
              <p style={{ color: colors.textSecondary, 'margin-bottom': '1rem' }}>
                试用期考核合格，正式定岗为新职位。
              </p>
              {state.promotionState && (
                <p style={{ 'margin-bottom': '1.5rem' }}>
                  新职级：L{state.currentLevel} — {state.currentPositionId}
                </p>
              )}
              <button
                onClick={() => navigate('/dashboard')}
                style={{
                  padding: '0.6rem 1.5rem',
                  'background-color': colors.success,
                  color: colors.primaryText,
                  border: 'none',
                  'border-radius': radius.md,
                  cursor: 'pointer',
                }}
              >
                返回仪表盘
              </button>
            </div>
          </Match>

          {/* 进行中 */}
          <Match when={isActive()}>
            <div style={{ ...darkCardStyle('1.5rem') }}>
              {/* 阶段进度指示器 */}
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  gap: '0.4rem',
                  'margin-bottom': '1.2rem',
                }}
              >
                {ACTIVE_STAGES.map((_s, i) => (
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      'border-radius': '50%',
                      'background-color':
                        i < stageIndex()
                          ? colors.success
                          : i === stageIndex()
                            ? colors.primary
                            : colors.border,
                      color: i <= stageIndex() ? colors.primaryText : colors.textMuted,
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'center',
                      'font-size': '0.7rem',
                      'font-weight': 'bold',
                    }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>

              <div
                style={{
                  'font-size': '0.8rem',
                  color: colors.textSecondary,
                  'margin-bottom': '0.3rem',
                  'text-align': 'center',
                }}
              >
                当前阶段
              </div>
              <div
                style={{
                  'font-size': '1.2rem',
                  'font-weight': 'bold',
                  'margin-bottom': '1rem',
                  'text-align': 'center',
                }}
              >
                {stageLabel()}
              </div>

              <Show when={state.promotionState?.targetLevel !== undefined}>
                <p
                  style={{
                    'font-size': '0.85rem',
                    color: colors.textSecondary,
                    'margin-bottom': '1rem',
                    'text-align': 'center',
                  }}
                >
                  目标职位：L{state.promotionState?.targetLevel}
                </p>
              </Show>

              {/* 得票展示 */}
              <Show when={state.promotionState?.stageResults.democraticVotes !== undefined}>
                <div
                  style={{
                    'text-align': 'center',
                    'margin-bottom': '1rem',
                    'font-size': '0.9rem',
                  }}
                >
                  得票：
                  <span
                    style={{ color: colors.primary, 'font-weight': 'bold', 'font-size': '1.1rem' }}
                  >
                    {state.promotionState?.stageResults.democraticVotes}
                  </span>{' '}
                  分
                </div>
              </Show>

              {/* 玩家选择 */}
              <Show when={state.promotionStage === PromotionStage.DemocraticVote}>
                <p
                  style={{
                    'margin-bottom': '0.8rem',
                    'font-size': '0.9rem',
                    'text-align': 'center',
                  }}
                >
                  是否动用人脉拉票？（+10得票，30%概率留下负面记录）
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleResolve({ useConnections: false })}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      'background-color': colors.bgCard,
                      color: colors.textSecondary,
                      border: `1px solid ${colors.border}`,
                      'border-radius': radius.md,
                      cursor: 'pointer',
                    }}
                  >
                    不使用人脉
                  </button>
                  <button
                    onClick={() => handleResolve({ useConnections: true })}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      'background-color': colors.primary,
                      color: colors.primaryText,
                      border: 'none',
                      'border-radius': radius.md,
                      cursor: 'pointer',
                    }}
                  >
                    动用关系拉票
                  </button>
                </div>
              </Show>

              <Show when={state.promotionStage === PromotionStage.OrgInspection}>
                <p
                  style={{
                    'margin-bottom': '0.8rem',
                    'font-size': '0.9rem',
                    'text-align': 'center',
                  }}
                >
                  是否引导考察组？（消耗20政治资本，+8考核分）
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleResolve({ influenceInspectors: false })}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      'background-color': colors.bgCard,
                      color: colors.textSecondary,
                      border: `1px solid ${colors.border}`,
                      'border-radius': radius.md,
                      cursor: 'pointer',
                    }}
                  >
                    不引导
                  </button>
                  <button
                    onClick={() => handleResolve({ influenceInspectors: true })}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      'background-color': colors.primary,
                      color: colors.primaryText,
                      border: 'none',
                      'border-radius': radius.md,
                      cursor: 'pointer',
                    }}
                  >
                    引导考察组
                  </button>
                </div>
              </Show>

              {/* 无选择阶段：推进按钮 */}
              <Show when={!hasChoices()}>
                <button
                  onClick={() => handleResolve()}
                  style={{
                    width: '100%',
                    padding: '0.7rem',
                    'background-color': colors.primary,
                    color: colors.primaryText,
                    border: 'none',
                    'border-radius': radius.md,
                    cursor: 'pointer',
                    'font-size': '1rem',
                    'font-family': font.title,
                  }}
                >
                  推进到下一阶段
                </button>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
