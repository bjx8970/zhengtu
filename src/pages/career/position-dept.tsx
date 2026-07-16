/**
 * 部门行动页面
 *
 * 展示指定部门的行动列表、冷却状态、KPI 当前值。
 * 玩家在此选择和执行部门行动，执行后槽位/KPI/冷却自动更新。
 */
import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { getConfigLoader } from '../../config/loader';
import { navigate } from '../../router';
import { formatCurrency } from '../../utils/format';
import type { PageProps } from '../../router';

/** 判断行动是否可执行 */
function canExecute(
  slotAvailable: number,
  slotCost: number,
  gameDay: number,
  cooldownEnd: number,
  remainingBudget: number,
  budgetDelta: number,
): { ok: boolean; reason: string } {
  if (slotAvailable < slotCost) return { ok: false, reason: `槽位不足（需${slotCost}，剩${slotAvailable}）` };
  if (gameDay < cooldownEnd)
    return { ok: false, reason: `冷却中（剩余${cooldownEnd - gameDay}天）` };
  if (remainingBudget < budgetDelta)
    return { ok: false, reason: `预算不足（需${budgetDelta}万）` };
  return { ok: true, reason: '' };
}

export function PositionDept(props: PageProps) {
  const { state, dispatch } = useGameStore();
  const deptIndex = parseInt(props.deptIndex ?? '0', 10);

  /** 当前职位配置 */
  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    const idx = parseInt(posId.split('_').pop() ?? '0', 10);
    return getConfigLoader().getPosition(state.currentCareerLine, state.currentLevel, idx);
  });

  /** 当前位置下的所有部门列表 */
  const allDepts = createMemo(() => positionConfig()?.departments ?? []);

  /** 当前部门配置 */
  const deptConfig = createMemo(() => allDepts()[deptIndex] ?? null);

  /** 当前部门运行时状态 */
  const deptState = createMemo(() => {
    const cfg = deptConfig();
    if (!cfg) return null;
    return state.departmentStates[cfg.id] ?? null;
  });

  /** 跳转到指定部门 */
  function goToDept(idx: number) {
    navigate(`/dept/${idx}`);
  }

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        'background-color': '#1a1a2e',
        color: '#e0e0e0',
      }}
    >
      {/* 顶部导航栏 */}
      <header
        style={{
          padding: '0.8rem 1rem',
          'border-bottom': '1px solid #333',
          display: 'flex',
          'align-items': 'center',
          gap: '0.8rem',
        }}
      >
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            background: 'none',
            color: '#888',
            border: 'none',
            'font-size': '1.2rem',
            cursor: 'pointer',
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <Show
            when={deptConfig()}
            fallback={<span style={{ color: '#888' }}>无部门数据</span>}
          >
            {(dept) => (
              <>
                <div style={{ 'font-size': '1.1rem', 'font-weight': 'bold' }}>
                  {dept().name}
                </div>
                <div style={{ 'font-size': '0.75rem', color: '#888' }}>
                  {positionConfig()?.name} · {allDepts().length} 个部门
                </div>
              </>
            )}
          </Show>
        </div>
      </header>

      {/* 部门标签导航（横向滚动） */}
      <Show when={allDepts().length > 1}>
        <div
          style={{
            display: 'flex',
            'overflow-x': 'auto',
            'border-bottom': '1px solid #333',
            gap: '0.3rem',
            padding: '0.5rem 0.5rem 0',
          }}
        >
          <For each={allDepts()}>
            {(dept, idx) => (
              <button
                onClick={() => goToDept(idx())}
                style={{
                  padding: '0.4rem 0.8rem',
                  'font-size': '0.85rem',
                  'background-color': idx() === deptIndex ? '#4A6FA5' : '#2a2a4a',
                  color: '#fff',
                  border: 'none',
                  'border-radius': '6px 6px 0 0',
                  cursor: 'pointer',
                  'white-space': 'nowrap',
                }}
              >
                {dept.name}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div style={{ flex: 1, 'overflow-y': 'auto', padding: '1rem' }}>
        <Show
          when={deptConfig() && deptState()}
          fallback={
            <div style={{ 'text-align': 'center', color: '#888', 'margin-top': '3rem' }}>
              暂无部门数据，请先在仪表盘中分配职位。
            </div>
          }
        >
          <Show when={deptConfig()!} keyed>
            {(dept) => (
              <Show when={deptState()!} keyed>
                {(dState) => {
                  const budgetInfo = createMemo(() => ({
                    monthly: formatCurrency(dept.baseConsumption * dept.consumptionCoefficient),
                  }));

                  return (
                    <>
                      {/* 槽位 + 资金状态栏 */}
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.8rem',
                          'margin-bottom': '1.2rem',
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            padding: '0.6rem',
                            'background-color': '#16213e',
                            'border-radius': '8px',
                            'text-align': 'center',
                          }}
                        >
                          <div style={{ 'font-size': '0.75rem', color: '#888' }}>槽位</div>
                          <div style={{ 'font-size': '1.2rem', 'font-weight': 'bold', color: '#4A6FA5' }}>
                            {state.slots.available}/{state.slots.max}
                          </div>
                        </div>
                        <div
                          style={{
                            flex: 2,
                            padding: '0.6rem',
                            'background-color': '#16213e',
                            'border-radius': '8px',
                            'text-align': 'center',
                          }}
                        >
                          <div style={{ 'font-size': '0.75rem', color: '#888' }}>月度消耗</div>
                          <div style={{ 'font-size': '1.2rem', 'font-weight': 'bold', color: '#FF9800' }}>
                            {budgetInfo().monthly}
                          </div>
                        </div>
                      </div>

                      {/* 行动列表 */}
                      <div
                        style={{
                          'margin-bottom': '1.2rem',
                        }}
                      >
                        <div
                          style={{
                            'font-size': '0.9rem',
                            'font-weight': 'bold',
                            'margin-bottom': '0.6rem',
                          }}
                        >
                          行动
                        </div>
                        <For each={dept.actions}>
                          {(action) => {
                            const gameDay = state.totalDaysPlayed;
                            const cooldownEnd = dState.actionCooldowns[action.id] ?? 0;
                            const remaining = Math.max(0, cooldownEnd - gameDay);
                            const status = canExecute(
                              state.slots.available,
                              action.slotCost,
                              gameDay,
                              cooldownEnd,
                              state.remainingBudget,
                              action.budgetDelta,
                            );

                            return (
                              <div
                                style={{
                                  padding: '0.8rem 1rem',
                                  'background-color': '#16213e',
                                  'border-radius': '8px',
                                  'margin-bottom': '0.5rem',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    'justify-content': 'space-between',
                                    'align-items': 'center',
                                    'margin-bottom': '0.3rem',
                                  }}
                                >
                                  <span style={{ 'font-size': '0.95rem', 'font-weight': 'bold' }}>
                                    {action.name}
                                  </span>
                                  <button
                                    onClick={() =>
                                      dispatch({
                                        type: 'EXECUTE_ACTION',
                                        deptId: dept.id,
                                        actionId: action.id,
                                      })
                                    }
                                    disabled={!status.ok}
                                    style={{
                                      padding: '0.3rem 1rem',
                                      'font-size': '0.85rem',
                                      'background-color': status.ok ? '#4CAF50' : '#555',
                                      color: '#fff',
                                      border: 'none',
                                      'border-radius': '6px',
                                      cursor: status.ok ? 'pointer' : 'not-allowed',
                                      opacity: status.ok ? 1 : 0.5,
                                    }}
                                  >
                                    {remaining > 0
                                      ? `冷却${remaining}天`
                                      : status.ok
                                        ? '执行'
                                        : status.reason}
                                  </button>
                                </div>
                                <div
                                  style={{
                                    'font-size': '0.75rem',
                                    color: '#888',
                                    display: 'flex',
                                    gap: '1rem',
                                  }}
                                >
                                  <span>槽位: {action.slotCost}</span>
                                  <span>预算: {formatCurrency(action.budgetDelta)}</span>
                                  <span>冷却: {action.cooldownDays}天</span>
                                </div>
                                {action.description && (
                                  <div
                                    style={{
                                      'font-size': '0.75rem',
                                      color: '#666',
                                      'margin-top': '0.2rem',
                                    }}
                                  >
                                    {action.description}
                                  </div>
                                )}
                              </div>
                            );
                          }}
                        </For>
                      </div>

                      {/* 部门 KPI */}
                      <div>
                        <div
                          style={{
                            'font-size': '0.9rem',
                            'font-weight': 'bold',
                            'margin-bottom': '0.6rem',
                          }}
                        >
                          部门 KPI
                        </div>
                        <For each={dept.kpiIndicators}>
                          {(kpi) => {
                            const value = dState.kpiValues[kpi.id] ?? 0;
                            const rate = kpi.targetValue > 0 ? value / kpi.targetValue : 0;
                            return (
                              <div
                                style={{
                                  padding: '0.6rem 1rem',
                                  'background-color': '#16213e',
                                  'border-radius': '6px',
                                  'margin-bottom': '0.4rem',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    'justify-content': 'space-between',
                                    'font-size': '0.85rem',
                                  }}
                                >
                                  <span>{kpi.name}</span>
                                  <span style={{ color: '#888' }}>
                                    {value} / {kpi.targetValue}{kpi.unit}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    height: '4px',
                                    'background-color': '#2a2a4a',
                                    'border-radius': '2px',
                                    overflow: 'hidden',
                                    'margin-top': '0.3rem',
                                  }}
                                >
                                  <div
                                    style={{
                                      height: '100%',
                                      width: `${Math.min(rate * 100, 100)}%`,
                                      'background-color':
                                        rate >= 1 ? '#4CAF50' : rate >= 0.6 ? '#4A6FA5' : '#C44D4D',
                                      'border-radius': '2px',
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </>
                  );
                }}
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
