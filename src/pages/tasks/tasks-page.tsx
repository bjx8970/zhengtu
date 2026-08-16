/**
 * 个人任务工作台页
 *
 * 无领导职务阶段的核心工作入口：浏览可承接的个人任务、
 * 查看时长/槽位占用/成本/预计效果与不可执行原因，并安排日程。
 * 领导职务阶段保留少量领导本人任务（由任务配置的前置条件过滤）。
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { PageHeader } from '../../components/page-header';
import { getConfigLoader } from '../../config/loader';
import { describePersonalTaskAvailability } from '../../engine/tasks/personal-task';
import { PERSONAL_TASK_LEDGER_ID, type SlotOccupant, type SlotTierKey } from '../../types/player';
import {
  PERSONAL_TASK_TYPES,
  PERSONAL_TASK_TYPE_LABELS,
  type PersonalTaskTemplate,
} from '../../types/config';
import { formatEffectDefinitionLabel, formatKpiEffectLabel } from '../../utils/effect-labels';

/** 日程等级按钮配置（与部门治理页一致） */
const TIER_BUTTONS: { key: SlotTierKey; label: string }[] = [
  { key: 'primary', label: '主要' },
  { key: 'secondary', label: '次要' },
  { key: 'reserve', label: '紧急' },
];

/** 任务类别标签 */
const CATEGORY_LABELS: Record<string, string> = {
  major: '重大',
  minor: '次要',
  routine: '日常',
};

/**
 * 个人任务工作台组件。
 *
 * @returns 任务页 JSX
 */
export function TasksPage() {
  const { state, dispatch } = useGameStore();

  const isClerk = createMemo(() => state.career.appointment.leadershipRank === 'none');

  const allTasks = createMemo(() => getConfigLoader().getAllPersonalTaskTemplates());

  /** 领导职务阶段只保留仍可承接的本人任务 */
  const visibleTasks = createMemo(() =>
    allTasks().filter((task) => {
      const availability = describePersonalTaskAvailability(task, {
        leadershipRank: state.career.appointment.leadershipRank,
        civilServiceRank: state.career.civilServiceRank,
        totalCompletedTasks: state.actions.personalTasks.totalCompleted,
        facts: state.world.facts,
      });
      return isClerk() || availability.available;
    }),
  );

  /** 进行中的个人任务（按任务 ID 索引） */
  const runningTaskIds = createMemo(() => {
    const ids = new Set<string>();
    for (const tier of ['primary', 'secondary', 'reserve'] as const) {
      for (const occupant of state.actions.slots[tier].occupants) {
        if (occupant && occupant.deptId === PERSONAL_TASK_LEDGER_ID) ids.add(occupant.actionId);
      }
    }
    return ids;
  });

  /** 最近完成的任务反馈（通知保留最近 5 条，过滤个人任务） */
  const recentCompleted = createMemo(() =>
    state.actions.lastCompletedActions.filter((item) => item.deptName === '个人任务'),
  );

  return (
    <>
      <PageHeader
        eyebrow="任务 · PERSONAL TASKS"
        title="个人任务"
        meta={`${state.actions.personalTasks.totalCompleted} 项已交付`}
        desc={isClerk() ? '承接、排期、交付本人具体任务' : '领导本人可承接的事务性任务'}
      />

      <Show
        when={!isClerk()}
        fallback={<p class="banner">无领导职务阶段：个人任务是主要工作方式。</p>}
      >
        <p class="banner">已担任领导职务：主要治理入口在「部门治理」，此处仅保留领导本人任务。</p>
      </Show>

      <For each={PERSONAL_TASK_TYPES}>
        {(taskType) => {
          const tasks = visibleTasks().filter((task) => task.type === taskType);
          return (
            <Show when={tasks.length > 0}>
              <section class="card">
                <div class="card-title">
                  <span class="card-title-mark" aria-hidden="true" />
                  {PERSONAL_TASK_TYPE_LABELS[taskType]}
                </div>
                <div class="card-pad flex-col gap-md">
                  <For each={tasks}>
                    {(task) => (
                      <TaskCard
                        task={task}
                        running={runningTaskIds().has(task.id)}
                        onStart={(tierKey) =>
                          dispatch({ type: 'START_PERSONAL_TASK', taskId: task.id, tierKey })
                        }
                      />
                    )}
                  </For>
                </div>
              </section>
            </Show>
          );
        }}
      </For>

      <Show when={recentCompleted().length > 0}>
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            最近交付
          </div>
          <div class="card-pad flex-col gap-sm">
            <For each={recentCompleted()}>
              {(item) => (
                <div class="flex between center gap-sm" style={{ 'flex-wrap': 'wrap' }}>
                  <span class="text-sm">
                    <strong>{item.actionName}</strong>
                  </span>
                  <span class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
                    <For each={item.effects.slice(0, 4)}>
                      {(effect) => <span class="tag tag-gray">{effect}</span>}
                    </For>
                  </span>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </>
  );
}

/**
 * 单个任务卡片：属性展示 + 可承接性判定 + 槽位安排按钮。
 *
 * @param props.task 任务模板
 * @param props.running 是否进行中
 * @param props.onStart 安排到指定槽位等级的回调
 * @returns 任务卡片 JSX
 */
function TaskCard(props: {
  task: PersonalTaskTemplate;
  running: boolean;
  onStart: (tierKey: SlotTierKey) => void;
}) {
  const { state } = useGameStore();

  const availability = createMemo(() =>
    describePersonalTaskAvailability(props.task, {
      leadershipRank: state.career.appointment.leadershipRank,
      civilServiceRank: state.career.civilServiceRank,
      totalCompletedTasks: state.actions.personalTasks.totalCompleted,
      facts: state.world.facts,
    }),
  );

  const completedCount = createMemo(
    () => state.actions.personalTasks.completedCounts[props.task.id] ?? 0,
  );
  const cooldownUntil = createMemo(
    () => state.actions.personalTasks.cooldownUntilDays[props.task.id] ?? 0,
  );
  const onCooldown = createMemo(
    () => props.task.category !== 'routine' && state.time.totalDaysPlayed < cooldownUntil(),
  );
  const onceDone = createMemo(() => props.task.repeatPolicy === 'once' && completedCount() > 0);

  const effectLabels = createMemo(() => {
    const labels: string[] = props.task.effects.map((effect) =>
      formatEffectDefinitionLabel(effect),
    );
    for (const kpiEffect of props.task.kpiEffects ?? [])
      labels.push(formatKpiEffectLabel(kpiEffect));
    return labels;
  });

  /** 禁排原因（供按钮 title 与卡片提示共用） */
  function blockReason(): string | null {
    if (!availability().available) return availability().reason ?? '不满足承接条件';
    if (onceDone()) return '该任务已完成后不可再次承接';
    if (onCooldown()) return `任务冷却中（剩 ${cooldownUntil() - state.time.totalDaysPlayed} 天）`;
    if (state.remainingBudget < props.task.budgetDelta) return '预算不足';
    return null;
  }

  return (
    <div class="card" data-testid={`personal-task-${props.task.id}`}>
      <div class="card-pad flex-col gap-sm">
        <div class="flex between center gap-sm">
          <h3 style={{ 'font-size': '1rem' }}>{props.task.name}</h3>
          <span class="flex gap-sm">
            <span class="tag tag-blue">{CATEGORY_LABELS[props.task.category]}任务</span>
            <Show when={props.running}>
              <span class="tag tag-green">进行中</span>
            </Show>
            <Show when={onceDone()}>
              <span class="tag tag-gray">已交付</span>
            </Show>
          </span>
        </div>
        <Show when={props.task.description}>
          <p class="text-sm secondary-text">{props.task.description}</p>
        </Show>
        <p class="text-sm secondary-text">
          {props.task.durationDays} 天
          {props.task.cooldownDays > 0 && ` · 冷却 ${props.task.cooldownDays} 天`}
          {props.task.repeatPolicy === 'once' && ' · 仅可完成一次'}
        </p>
        <div class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
          <span class="tag tag-gray" data-testid={`task-cost-${props.task.id}`}>
            成本 {props.task.budgetDelta}万
          </span>
          <For each={effectLabels()}>{(label) => <span class="tag tag-gray">{label}</span>}</For>
        </div>
        <Show when={blockReason()}>
          <p class="banner banner-warning text-sm">{blockReason()}</p>
        </Show>
        <div class="flex gap-sm">
          <For each={TIER_BUTTONS}>
            {(tb) => {
              if (props.task.category === 'major' && tb.key !== 'primary') return null;
              const tierGroup = state.actions.slots[tb.key];
              const hasFree = tierGroup.occupants.some((o: SlotOccupant | null) => o === null);
              const insufficientBudget = state.remainingBudget < props.task.budgetDelta;
              const disabled = Boolean(blockReason()) || !hasFree || insufficientBudget;
              return (
                <button
                  data-testid={`start-task-${props.task.id}-${tb.key}`}
                  class={
                    disabled
                      ? 'btn flex-1'
                      : tb.key === 'reserve'
                        ? 'btn btn-danger flex-1'
                        : 'btn btn-primary flex-1'
                  }
                  onClick={() => props.onStart(tb.key)}
                  disabled={disabled}
                  title={
                    disabled
                      ? (blockReason() ?? (!hasFree ? '该档位已无空槽' : '预算不足'))
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
}
