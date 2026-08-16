/**
 * 部门治理页
 *
 * 展示当前职位的所有部门，点击部门进入行动列表并安排日程。
 * 交互流程：部门列表 → 点击部门 → 行动列表 + 槽位选择按钮。
 * 无领导职务阶段部门治理行动为领导专属：本页转为只读说明，
 * 科员的核心工作入口在「个人任务」工作台（issue #120）。
 */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { PageHeader } from '../../components/page-header';
import { getConfigLoader } from '../../config/loader';
import type { SlotTierKey, SlotOccupant } from '../../types/player';
import type { DepartmentConfig } from '../../types/config';
import { formatEffectLabel } from '../../utils/effect-labels';

/** 日程等级按钮配置 */
const TIER_BUTTONS: { key: SlotTierKey; label: string }[] = [
  { key: 'primary', label: '主要' },
  { key: 'secondary', label: '次要' },
  { key: 'reserve', label: '紧急' },
];

/** 行动类别标签 */
const CATEGORY_LABELS: Record<string, string> = {
  major: '重大',
  minor: '次要',
  routine: '日常',
};

/**
 * 部门治理页组件。
 *
 * @returns 部门页 JSX
 */
export function DepartmentsPage() {
  const { state } = useGameStore();
  const [selectedDeptIdx, setSelectedDeptIdx] = createSignal<number | null>(null);

  const isClerk = createMemo(() => state.career.appointment.leadershipRank === 'none');

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
    <>
      <PageHeader
        eyebrow="治理 · GOVERNANCE"
        title="部门治理"
        meta={positionConfig()?.name ?? ''}
        desc="查看部门状态、安排行动、管理槽位与冷却"
      />

      <Show
        when={!isClerk()}
        fallback={
          <div class="card card-pad flex-col gap-sm" data-testid="departments-readonly-notice">
            <h2 class="doc-title" style={{ 'font-size': '1.1rem' }}>
              部门治理由领导职务负责
            </h2>
            <p class="text-sm secondary-text">
              当前无领导职务：请通过「个人任务」工作台承接材料起草、调研走访、群众服务等具体任务开展工作。
            </p>
            <div>
              <a class="btn btn-primary" href="#/tasks">
                前往个人任务
              </a>
            </div>
          </div>
        }
      >
        <Show
          when={selectedDept() === null}
          fallback={
            // 安全：fallback 仅在 selectedDept() !== null 时渲染
            <DeptDetailView dept={selectedDept()!} onBack={() => setSelectedDeptIdx(null)} />
          }
        >
          <Show
            when={allDepts().length > 0}
            fallback={
              <div class="card center muted" style={{ padding: '3rem 0' }}>
                暂无部门数据
              </div>
            }
          >
            <div
              class="choice-grid"
              style={{ 'grid-template-columns': 'repeat(auto-fill, minmax(230px, 1fr))' }}
            >
              <For each={allDepts()}>
                {(dept, idx) => {
                  const deptState = state.actions.departmentStates[dept.id];
                  const kpiValues = deptState?.kpiValues ?? {};
                  const firstKpi = Object.entries(kpiValues).slice(0, 2);
                  const firstValue = firstKpi.length > 0 ? Number(firstKpi[0]?.[1] ?? 0) : 0;
                  return (
                    <button
                      data-testid={`department-${dept.id}`}
                      class="choice-card"
                      onClick={() => setSelectedDeptIdx(idx())}
                      style={{ 'min-height': '150px' }}
                    >
                      <span class="choice-card-title serif" style={{ 'font-size': '1.05rem' }}>
                        {dept.name}
                      </span>
                      <span class="choice-card-desc">
                        {dept.actions.length > 0
                          ? `可执行 ${dept.actions.length} 个行动`
                          : '暂无可用行动'}
                      </span>
                      <span class="meter">
                        <i
                          class="meter-fill green"
                          style={{ width: `${Math.min(Math.abs(firstValue) * 10, 100)}%` }}
                          aria-hidden="true"
                        />
                      </span>
                      <span class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
                        <For each={firstKpi}>
                          {([kpiId, value]) => (
                            <span class="tag tag-gray">
                              {dept.kpiIndicators.find((k) => k.id === kpiId)?.name ?? kpiId}{' '}
                              {String(value)}
                            </span>
                          )}
                        </For>
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </>
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
    <div class="flex-col gap-lg">
      <div class="flex gap-sm center">
        <button class="btn btn-sm" onClick={props.onBack} aria-label="返回部门列表">
          {'\u2190'} 返回部门列表
        </button>
        <h2 class="doc-title" style={{ 'font-size': '1.2rem' }}>
          {props.dept.name}
        </h2>
      </div>

      <Show
        when={props.dept.actions.length > 0}
        fallback={<div class="card card-pad muted text-sm">该部门暂无可用行动。</div>}
      >
        <div class="flex-col gap-md">
          <For each={props.dept.actions}>
            {(action) => {
              const deptState = state.actions.departmentStates[props.dept.id];
              const cooldownUntil = deptState?.actionCooldownUntilDays?.[action.id] ?? 0;
              const onCooldown =
                action.category !== 'routine' && state.time.totalDaysPlayed < cooldownUntil;

              return (
                <div class="card">
                  <div class="card-pad flex-col gap-sm">
                    <div class="flex between center">
                      <h3 style={{ 'font-size': '1rem' }}>{action.name}</h3>
                      <span class="tag tag-blue">{CATEGORY_LABELS[action.category]}行动</span>
                    </div>
                    <p class="text-sm secondary-text">
                      {action.durationDays} 天
                      {action.cooldownDays > 0 && ` · 冷却 ${action.cooldownDays} 天`}
                    </p>
                    <div class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
                      <span class="tag tag-gray">
                        {action.budgetDelta >= 0
                          ? `预算 +${action.budgetDelta}万`
                          : `预算 ${action.budgetDelta}万`}
                      </span>
                      <For each={action.effects.slice(0, 3)}>
                        {(eff) => <span class="tag tag-gray">{formatEffectLabel(eff)}</span>}
                      </For>
                    </div>
                    <Show when={onCooldown}>
                      <p class="banner banner-warning text-sm">
                        冷却中（{cooldownUntil - state.time.totalDaysPlayed} 天）
                      </p>
                    </Show>
                    <div class="flex gap-sm">
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
                              data-testid={`start-action-${props.dept.id}-${action.id}-${tb.key}`}
                              class={
                                disabled
                                  ? 'btn flex-1'
                                  : tb.key === 'reserve'
                                    ? 'btn btn-danger flex-1'
                                    : 'btn btn-primary flex-1'
                              }
                              onClick={() =>
                                dispatch({
                                  type: 'START_ACTION',
                                  deptId: props.dept.id,
                                  actionId: action.id,
                                  tierKey: tb.key,
                                })
                              }
                              disabled={disabled}
                              title={
                                disabled
                                  ? onCooldown
                                    ? '行动冷却中'
                                    : !hasFree
                                      ? '该档位已无空槽'
                                      : '预算不足'
                                  : undefined
                              }
                            >
                              {tb.label}槽
                            </button>
                          );
                        }}
                      </For>
                    </div>
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
