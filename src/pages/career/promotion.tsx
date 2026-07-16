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

  const handleStart = () => dispatch({ type: 'START_PROMOTION' });
  const handleResolve = (choices?: { useConnections?: boolean; influenceInspectors?: boolean }) =>
    dispatch({ type: 'PROMOTION_RESOLVE_STAGE', choices });

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        'background-color': '#1a1a2e',
        color: '#e0e0e0',
        padding: '1rem',
      }}
    >
      {/* 页头 */}
      <header
        style={{
          display: 'flex',
          'justify-content': 'space-between',
          'align-items': 'center',
          'padding-bottom': '1rem',
          'border-bottom': '1px solid #333',
        }}
      >
        <h2 style={{ margin: 0, 'font-size': '1.3rem' }}>晋升流程</h2>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '0.4rem 0.8rem',
            'background-color': '#333',
            color: '#aaa',
            border: 'none',
            'border-radius': '4px',
            cursor: 'pointer',
          }}
        >
          返回
        </button>
      </header>

      {/* 内容区 */}
      <div
        style={{
          flex: 1,
          'overflow-y': 'auto',
          padding: '1rem 0',
        }}
      >
        <Switch>
          {/* 未触发 */}
          <Match when={state.promotionStage === PromotionStage.Idle}>
            <p style={{ 'margin-bottom': '1rem' }}>
              年度考核通过，获得晋升提名资格。是否启动晋升流程？
            </p>
            <p style={{ 'font-size': '0.85rem', color: '#C44D4D', 'margin-bottom': '1rem' }}>
              警告：晋升成功后原有岗位专属职权和事件将被永久清空，仅保留职级基础权限，无法回滚。
            </p>
            <button
              onClick={handleStart}
              style={{
                padding: '0.8rem 2rem',
                'background-color': '#4A6FA5',
                color: '#fff',
                border: 'none',
                'border-radius': '8px',
                cursor: 'pointer',
                'font-size': '1rem',
              }}
            >
              启动晋升流程
            </button>
          </Match>

          {/* 失败 */}
          <Match when={state.promotionStage === PromotionStage.Failed}>
            <div style={{ 'text-align': 'center' }}>
              <div style={{ color: '#C44D4D', 'font-size': '1.2rem', 'margin-bottom': '1rem' }}>
                晋升失败
              </div>
              <p style={{ color: '#888', 'margin-bottom': '1.5rem' }}>
                本次晋升未通过，消沉值增加。可等待下次年度考核后重新尝试。
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', 'justify-content': 'center' }}>
                <button
                  onClick={() => navigate('/dashboard')}
                  style={{
                    padding: '0.6rem 1.5rem',
                    'background-color': '#333',
                    color: '#aaa',
                    border: 'none',
                    'border-radius': '8px',
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
                    'background-color': '#4A6FA5',
                    color: '#fff',
                    border: 'none',
                    'border-radius': '8px',
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
            <div style={{ 'text-align': 'center' }}>
              <div style={{ color: '#4CAF50', 'font-size': '1.3rem', 'margin-bottom': '1rem' }}>
                晋升成功
              </div>
              <p style={{ color: '#888', 'margin-bottom': '1rem' }}>
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
                  'background-color': '#4CAF50',
                  color: '#fff',
                  border: 'none',
                  'border-radius': '8px',
                  cursor: 'pointer',
                }}
              >
                返回仪表盘
              </button>
            </div>
          </Match>

          {/* 进行中 */}
          <Match when={isActive()}>
            <div
              style={{
                'background-color': '#16213e',
                'border-radius': '8px',
                padding: '1.5rem',
              }}
            >
              <div style={{ 'font-size': '0.85rem', color: '#888', 'margin-bottom': '0.5rem' }}>
                当前阶段
              </div>
              <div
                style={{ 'font-size': '1.2rem', 'font-weight': 'bold', 'margin-bottom': '1rem' }}
              >
                {stageLabel()}
              </div>

              <Show when={state.promotionState?.targetLevel !== undefined}>
                <p style={{ 'font-size': '0.85rem', color: '#888', 'margin-bottom': '1rem' }}>
                  目标职位：L{state.promotionState?.targetLevel}
                </p>
              </Show>

              {/* 玩家选择 */}
              <Show when={state.promotionStage === PromotionStage.DemocraticVote}>
                <p style={{ 'margin-bottom': '0.8rem', 'font-size': '0.9rem' }}>
                  是否动用人脉拉票？（+10得票，30%概率留下负面记录）
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleResolve({ useConnections: false })}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      'background-color': '#333',
                      color: '#e0e0e0',
                      border: 'none',
                      'border-radius': '6px',
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
                      'background-color': '#4A6FA5',
                      color: '#fff',
                      border: 'none',
                      'border-radius': '6px',
                      cursor: 'pointer',
                    }}
                  >
                    动用关系拉票
                  </button>
                </div>
              </Show>

              <Show when={state.promotionStage === PromotionStage.OrgInspection}>
                <p style={{ 'margin-bottom': '0.8rem', 'font-size': '0.9rem' }}>
                  是否引导考察组？（消耗20政治资本，+8考核分）
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleResolve({ influenceInspectors: false })}
                    style={{
                      flex: 1,
                      padding: '0.6rem',
                      'background-color': '#333',
                      color: '#e0e0e0',
                      border: 'none',
                      'border-radius': '6px',
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
                      'background-color': '#4A6FA5',
                      color: '#fff',
                      border: 'none',
                      'border-radius': '6px',
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
                    'background-color': '#4A6FA5',
                    color: '#fff',
                    border: 'none',
                    'border-radius': '6px',
                    cursor: 'pointer',
                    'font-size': '1rem',
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
