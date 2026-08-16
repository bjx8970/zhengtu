/**
 * 事件中心页面。
 *
 * 收件箱、计划中与历史记录分页展示，让玩家区分待处理事件、
 * 已计划事件与已结算记录；阻塞事件不在此处展示（由全局弹窗处理）。
 */

import { createSignal, For, Show } from 'solid-js';
import { PageHeader } from '../../components/page-header';
import { useGameStore } from '../../store/game-store';

type EventTab = 'pending' | 'scheduled' | 'history';

const TABS: EventTab[] = ['pending', 'scheduled', 'history'];

const tabLabels: Record<EventTab, string> = {
  pending: '待处理',
  scheduled: '计划中',
  history: '历史',
};

/**
 * @param signalType 领域信号类型
 * @returns 信号类型的中文来源标签
 */
function sourceLabel(signalType: string): string {
  switch (signalType) {
    case 'policy.approved':
      return '政策批准';
    case 'policy.phase_changed':
      return '政策阶段变化';
    case 'policy.metric_changed':
      return '政策指标变化';
    case 'action.completed':
      return '行动完成';
    case 'assessment.completed':
      return '年度考核';
    case 'event.resolved':
      return '事件结算';
    default:
      return signalType;
  }
}

/**
 * @param status 历史记录最终状态
 * @returns 状态中文标签
 */
function statusLabel(status: 'resolved' | 'expired' | 'cancelled'): string {
  switch (status) {
    case 'resolved':
      return '已解决';
    case 'expired':
      return '已过期';
    case 'cancelled':
      return '已取消';
  }
}

/**
 * 事件中心页面组件。
 *
 * @returns 事件收件箱、计划与历史三页签
 */
export function EventsPage() {
  const { state, dispatch } = useGameStore();
  const [tab, setTab] = createSignal<EventTab>('pending');
  const inboxEvents = () =>
    state.events.pending.filter((event) => event.snapshot.presentation === 'inbox');

  return (
    <>
      <PageHeader
        eyebrow="事件 · EVENTS"
        title="事件中心"
        desc="处理非阻塞事件，并查看计划与结算记录"
      />

      <section class="card">
        <nav class="navbar-inner" style={{ padding: '0 var(--space-md)' }} aria-label="事件分页">
          <For each={TABS}>
            {(item) => (
              <button
                class={tab() === item ? 'nav-link active' : 'nav-link'}
                onClick={() => setTab(item)}
                aria-current={tab() === item ? 'page' : undefined}
              >
                {tabLabels[item]}
              </button>
            )}
          </For>
        </nav>

        <div class="card-pad">
          {/* 待处理 */}
          <Show when={tab() === 'pending'}>
            <Show
              when={inboxEvents().length > 0}
              fallback={<p class="text-sm muted">没有待处理的非阻塞事件。</p>}
            >
              <div class="flex-col gap-md">
                <For each={inboxEvents()}>
                  {(event) => (
                    <article class="card">
                      <div class="card-pad flex-col gap-sm">
                        <div class="flex between gap-md">
                          <b class="serif" style={{ 'font-size': '1.05rem' }}>
                            {event.snapshot.title}
                          </b>
                          <span class="tag tag-blue">待处理</span>
                        </div>
                        <p class="text-sm secondary-text" style={{ 'line-height': '1.7' }}>
                          {event.snapshot.description}
                        </p>
                        <div class="flex gap-md text-xs muted" style={{ 'flex-wrap': 'wrap' }}>
                          <span>
                            截止：{event.deadlineDay === null ? '无' : `第 ${event.deadlineDay} 日`}
                          </span>
                          <span>来源：{sourceLabel(event.triggerContext.signalType)}</span>
                          <span>上下文：{event.sourceKey}</span>
                        </div>
                        <div class="flex-col gap-sm">
                          <For each={event.snapshot.options}>
                            {(option) => (
                              <button
                                class="btn"
                                data-testid={`event-option-${event.instanceId}-${option.id}`}
                                onClick={() =>
                                  dispatch({
                                    type: 'CHOOSE_EVENT_OPTION',
                                    eventInstanceId: event.instanceId,
                                    optionId: option.id,
                                  })
                                }
                                style={{
                                  'flex-direction': 'column',
                                  'align-items': 'flex-start',
                                  gap: '0.2rem',
                                }}
                              >
                                <b>{option.label}</b>
                                <Show when={option.description}>
                                  <span class="text-xs muted" style={{ 'font-weight': 400 }}>
                                    {option.description}
                                  </span>
                                </Show>
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* 计划中 */}
          <Show when={tab() === 'scheduled'}>
            <Show
              when={state.events.scheduled.length > 0}
              fallback={<p class="text-sm muted">没有计划中的事件。</p>}
            >
              <div class="flex-col gap-sm">
                <For each={state.events.scheduled}>
                  {(event) => (
                    <article class="card">
                      <div class="card-pad flex-col gap-sm">
                        <b class="serif">{event.snapshot.title}</b>
                        <div
                          class="flex gap-md text-xs secondary-text"
                          style={{ 'flex-wrap': 'wrap' }}
                        >
                          <span>激活日：第 {event.activateAtDay} 日</span>
                          <span>事件链：{event.chainInstanceId ?? '独立事件'}</span>
                          <span>来源：{sourceLabel(event.triggerContext.signalType)}</span>
                          <span>上下文：{event.sourceKey}</span>
                        </div>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* 历史 */}
          <Show when={tab() === 'history'}>
            <Show
              when={state.events.history.length > 0}
              fallback={<p class="text-sm muted">尚无事件历史。</p>}
            >
              <div class="flex-col gap-sm">
                <For each={state.events.history}>
                  {(event) => (
                    <article class="card">
                      <div class="card-pad flex-col gap-sm">
                        <div class="flex between gap-md">
                          <b class="serif">{event.titleSnapshot}</b>
                          <span class="tag tag-gray">{statusLabel(event.finalStatus)}</span>
                        </div>
                        <div class="flex-col gap-xs text-xs secondary-text">
                          <span>选择：{event.chosenOptionLabel ?? '未选择（自动结束）'}</span>
                          <span>完成日：第 {event.completedAtDay} 日</span>
                          <span>事件链：{event.chainInstanceId ?? '独立事件'}</span>
                          <span>来源：{event.sourceKey}</span>
                        </div>
                        <Show when={event.appliedEffects.length > 0}>
                          <div class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
                            <For each={event.appliedEffects}>
                              {(effect) => <span class="tag tag-green">{effect.label}</span>}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </section>
    </>
  );
}
