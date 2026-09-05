/** 日程看板：响应时间推进实时更新占用数量、剩余天数和完成进度。 */
import { For, Show } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { navigate } from '../router';
import { PERSONAL_TASK_LEDGER_ID, type SlotOccupant, type SlotTierKey } from '../types/player';
import { PERSONAL_TASK_TYPE_LABELS } from '../types/config';
import { UiIcon } from './ui-icon';

const TIERS: { key: SlotTierKey; label: string; hint: string }[] = [
  { key: 'primary', label: '主要日程', hint: '优先处理重要事务' },
  { key: 'secondary', label: '次要日程', hint: '有序推进日常工作' },
  { key: 'reserve', label: '紧急日程', hint: '加班会扣减健康、增加消沉' },
];

function ScheduleItem(props: { occupant: SlotOccupant; day: number }) {
  const remaining = () =>
    Math.max(props.occupant.durationDays - (props.day - props.occupant.startedAtDay), 0);
  const progress = () =>
    Math.min(
      100,
      Math.max(
        0,
        ((props.day - props.occupant.startedAtDay) / Math.max(1, props.occupant.durationDays)) *
          100,
      ),
    );
  const taskType = () => {
    const item = props.occupant;
    return item.deptId === PERSONAL_TASK_LEDGER_ID && 'task' in item.executableSnapshot
      ? PERSONAL_TASK_TYPE_LABELS[item.executableSnapshot.task.type]
      : null;
  };
  return (
    <div class="schedule-item">
      <div class="flex between gap-sm">
        <strong>{props.occupant.actionName}</strong>
        <span class="tag tag-blue">进行中</span>
      </div>
      <Show when={taskType()}>
        <span class="text-xs secondary-text">{taskType()}</span>
      </Show>
      <div
        class="meter"
        role="progressbar"
        aria-label={`${props.occupant.actionName}进度`}
        aria-valuenow={Math.round(progress())}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i class="meter-fill blue" style={{ width: `${progress()}%` }} />
      </div>
      <div class="flex between text-xs secondary-text">
        <span>剩余 {remaining()} 天</span>
        <span>{Math.round(progress())}%</span>
      </div>
    </div>
  );
}

/**
 * 渲染三类日程槽位，空槽位直接进入任务安排页面。
 * @param _props 无需外部属性
 * @returns 由 Store 派生的日程看板
 */
export function ScheduleBoard(_props: Record<string, never>) {
  const { state } = useGameStore();
  const workRoute = () =>
    state.career.appointment.leadershipRank === 'none' ? '/tasks' : '/departments';
  return (
    <section class="card schedule-panel">
      <div class="card-title">
        <UiIcon name="clock" />
        <h2>日程规划</h2>
        <a class="section-link" href={`#${workRoute()}`}>
          安排日程 <UiIcon name="arrow" />
        </a>
      </div>
      <div class="schedule-columns">
        <For each={TIERS}>
          {(tier) => (
            <div class={`schedule-tier tier-${tier.key}`}>
              <div class="schedule-tier-heading">
                <span class="tier-dot" />
                <h3>{tier.label}</h3>
                <span class="tag tag-gray" data-testid={`schedule-count-${tier.key}`}>
                  {state.actions.slots[tier.key].occupants.filter((item) => item !== null).length}/
                  {state.actions.slots[tier.key].count}
                </span>
              </div>
              <p class="schedule-hint">{tier.hint}</p>
              <For each={state.actions.slots[tier.key].occupants}>
                {(occupant) => (
                  <Show
                    when={occupant}
                    fallback={
                      <button
                        class="empty-slot"
                        onClick={() => navigate(workRoute())}
                        aria-label={`安排${tier.label}`}
                      >
                        <UiIcon name="plus" />
                        <span>空闲 · 安排日程</span>
                      </button>
                    }
                  >
                    {(item) => <ScheduleItem occupant={item()} day={state.time.totalDaysPlayed} />}
                  </Show>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
