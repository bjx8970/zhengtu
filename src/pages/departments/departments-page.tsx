/**
 * 部门治理页
 *
 * 展示当前职位的所有部门，点击部门可查看行动列表并安排日程。
 * 交互流程：部门列表 → 点击部门 → 行动列表 + 日程选择按钮。
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { AppShell } from '../../components/app-shell';
import { PageHeader } from '../../components/page-header';
import { getConfigLoader } from '../../config/loader';
import type { SlotTierKey, SlotOccupant } from '../../types/player';
import type { DepartmentConfig } from '../../types/config';
import { colors, font, meterContainer, darkCardStyle } from '../../utils/theme';
import { formatEffectLabel } from '../../utils/effect-labels';

/** 日程等级按钮配置 */
const TIER_BUTTONS: { key: SlotTierKey; label: string }[] = [
  { key: 'primary', label: '主要' },
  { key: 'secondary', label: '次要' },
  { key: 'reserve', label: '紧急' },
];

/**
 * 部门治理页组件。
 *
 * @returns 部门页 JSX
 */
export function DepartmentsPage() {
  const { state } = useGameStore();
  const [selectedDeptIdx, setSelectedDeptIdx] = createSignal<number | null>(null);

  const positionConfig = createMemo(() => {
    const posId = state.career.appointment.positionId;
    if (!posId) return null;
    return getConfigLoader().getPositionById(posId);
  });

  const allDepts = createMemo(() => {
    const pos = positionConfig();
    if (!pos) return [];
    return getConfigLoader().resolvePositionDepartments(pos.id);
  });
  const selectedDept = createMemo(() => {
    const idx = selectedDeptIdx();
    if (idx === null) return null;
    return allDepts()[idx] ?? null;
  });

  return (
    <AppShell>
      <PageHeader title="部门治理" desc="查看部门状态、安排日程、管理冷却" />

      <Show
        when={selectedDept() === null}
        fallback={
          // 安全：fallback 仅在 selectedDept() !== null 时渲染
          <DeptDetailView dept={selectedDept()!} onBack={() => setSelectedDeptIdx(null)} />
        }
      >
        {/* 部门列表视图 */}
        <div style={{ ...darkCardStyle('18px'), 'margin-bottom': '16px', 'margin-top': '16px' }}>
          <h2 style={{ 'font-size': '25px', 'font-family': font.title }}>部门治理</h2>
          <p
            style={{
              'margin-top': '6px',
              color: colors.textMuted,
              'font-size': '14px',
              'line-height': '1.6',
            }}
          >
            点击部门查看可执行行动并安排日程。
          </p>
        </div>

        <Show
          when={allDepts().length > 0}
          fallback={
            <div style={{ color: colors.textMuted, 'text-align': 'center', 'margin-top': '3rem' }}>
              暂无部门数据
            </div>
          }
        >
          <div
            class="responsive-dept-grid"
            style={{
              display: 'grid',
              'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
              gap: '14px',
            }}
          >
            <For each={allDepts()}>
              {(dept, idx) => {
                const deptState = state.actions.departmentStates[dept.id];
                const kpiValues = deptState?.kpiValues ?? {};
                const firstKpi = Object.entries(kpiValues).slice(0, 2);
                const firstValue = firstKpi.length > 0 ? Number(firstKpi[0]?.[1] ?? 0) : 0;
                return (
                  <article
                    onClick={() => setSelectedDeptIdx(idx())}
                    style={{
                      ...darkCardStyle('16px'),
                      'min-height': '156px',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    <h3 style={{ 'font-size': '16px' }}>{dept.name}</h3>
                    <p
                      style={{
                        'margin-top': '8px',
                        color: colors.textMuted,
                        'font-size': '13px',
                        'line-height': '1.6',
                      }}
                    >
                      {dept.actions.length > 0
                        ? `可执行 ${dept.actions.length} 个行动`
                        : '暂无可用行动'}
                    </p>
                    <div style={{ ...meterContainer(), 'margin-top': '12px' }}>
                      <div
                        style={{
                          height: '100%',
                          'border-radius': 'inherit',
                          background: colors.success,
                          width: `${Math.min(Math.abs(firstValue) * 10, 100)}%`,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        'flex-wrap': 'wrap',
                        gap: '7px',
                        'margin-top': '12px',
                      }}
                    >
                      <For each={firstKpi}>
                        {([kpiId, value]) => (
                          <span
                            style={{
                              padding: '4px 7px',
                              'border-radius': '999px',
                              background: colors.bgSoft,
                              color: colors.textMuted,
                              'font-size': '12px',
                              'font-weight': 800,
                            }}
                          >
                            {dept.kpiIndicators.find((k) => k.id === kpiId)?.name ?? kpiId}{' '}
                            {String(value)}
                          </span>
                        )}
                      </For>
                    </div>
                  </article>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <div style={{ height: '24px' }} />
    </AppShell>
  );
}

/**
 * 部门详情视图：展示行动列表并支持日程安排。
 *
 * @param props.dept  当前选中的部门配置
 * @param props.onBack 返回部门列表的回调
 * @returns 部门详情 JSX
 */
function DeptDetailView(props: { dept: DepartmentConfig; onBack: () => void }) {
  const { state, dispatch } = useGameStore();

  return (
    <div style={{ 'margin-top': '16px' }}>
      {/* 返回按钮 + 部门名 */}
      <div
        style={{ display: 'flex', 'align-items': 'center', gap: '12px', 'margin-bottom': '16px' }}
      >
        <button
          onClick={props.onBack}
          style={{
            display: 'grid',
            'place-items': 'center',
            width: '32px',
            height: '32px',
            border: `1px solid ${colors.border}`,
            'border-radius': '50%',
            background: '#fff',
            color: colors.textPrimary,
            'font-size': '16px',
            cursor: 'pointer',
          }}
        >
          {'\u2190'}
        </button>
        <h2 style={{ 'font-size': '20px', 'font-family': font.title }}>{props.dept.name}</h2>
      </div>

      {/* 行动列表 */}
      <Show
        when={props.dept.actions.length > 0}
        fallback={
          <div style={{ color: colors.textMuted, 'font-size': '13px', padding: '16px' }}>
            该部门暂无可用行动。
          </div>
        }
      >
        <div style={{ display: 'grid', gap: '12px' }}>
          <For each={props.dept.actions}>
            {(action) => {
              const deptState = state.actions.departmentStates[props.dept.id];
              const cooldownUntil = deptState?.actionCooldownUntilDays?.[action.id] ?? 0;
              const onCooldown =
                action.category !== 'routine' && state.time.totalDaysPlayed < cooldownUntil;

              return (
                <div
                  style={{
                    padding: '15px',
                    border: `1px solid ${colors.border}`,
                    'border-radius': '8px',
                    background: '#fff',
                  }}
                >
                  <h3 style={{ 'font-size': '16px' }}>{action.name}</h3>
                  <p
                    style={{
                      'margin-top': '8px',
                      color: colors.textMuted,
                      'font-size': '13px',
                      'line-height': '1.6',
                    }}
                  >
                    {action.category === 'major'
                      ? '重大'
                      : action.category === 'minor'
                        ? '次要'
                        : '日常'}
                    行动 · {action.durationDays}天
                    {action.cooldownDays > 0 && ` · 冷却${action.cooldownDays}天`}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      'flex-wrap': 'wrap',
                      gap: '7px',
                      'margin-top': '12px',
                    }}
                  >
                    <span
                      style={{
                        padding: '4px 7px',
                        'border-radius': '999px',
                        background: colors.bgSoft,
                        color: colors.textMuted,
                        'font-size': '12px',
                        'font-weight': 800,
                      }}
                    >
                      {action.budgetDelta >= 0
                        ? `预算+${action.budgetDelta}万`
                        : `预算${action.budgetDelta}万`}
                    </span>
                    <For each={action.effects.slice(0, 3)}>
                      {(eff) => (
                        <span
                          style={{
                            padding: '4px 7px',
                            'border-radius': '999px',
                            background: colors.bgSoft,
                            color: colors.textMuted,
                            'font-size': '12px',
                            'font-weight': 800,
                          }}
                        >
                          {formatEffectLabel(eff)}
                        </span>
                      )}
                    </For>
                  </div>
                  <Show when={onCooldown}>
                    <div
                      style={{
                        'margin-top': '8px',
                        'font-size': '12px',
                        color: colors.warning,
                      }}
                    >
                      冷却中（{cooldownUntil - state.time.totalDaysPlayed}天）
                    </div>
                  </Show>
                  {/* 日程选择按钮 */}
                  <div style={{ display: 'flex', gap: '8px', 'margin-top': '12px' }}>
                    <For each={TIER_BUTTONS}>
                      {(tb) => {
                        const disallowedByCategory =
                          action.category === 'major' && tb.key !== 'primary';
                        if (disallowedByCategory) return null;
                        const tierGroup = state.actions.slots[tb.key];
                        const hasFree = tierGroup.occupants.some(
                          (o: SlotOccupant | null) => o === null,
                        );
                        const insufficientBudget = state.remainingBudget < action.budgetDelta;
                        const disabled = onCooldown || !hasFree || insufficientBudget;
                        return (
                          <button
                            onClick={() =>
                              dispatch({
                                type: 'START_ACTION',
                                deptId: props.dept.id,
                                actionId: action.id,
                                tierKey: tb.key,
                              })
                            }
                            disabled={disabled}
                            style={{
                              flex: 1,
                              padding: '7px',
                              border: disabled ? `1px solid ${colors.border}` : 'none',
                              'border-radius': '6px',
                              background: disabled
                                ? colors.bgSoft
                                : tb.key === 'reserve'
                                  ? colors.danger
                                  : colors.primary,
                              color: disabled ? colors.textMuted : '#fff',
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              'font-size': '13px',
                              'font-weight': 700,
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
        </div>
      </Show>
    </div>
  );
}
