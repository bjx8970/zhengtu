/**
 * Event center page.
 *
 * Keeps inbox, scheduled and history records separate so the player can inspect
 * persisted event runtime state without treating scheduled records as active work.
 */

import { createSignal, For, Show } from 'solid-js';
import { AppShell } from '../../components/app-shell';
import { PageHeader } from '../../components/page-header';
import { useGameStore } from '../../store/game-store';
import { colors, darkCardStyle, pillStyle } from '../../utils/theme';

type EventTab = 'pending' | 'scheduled' | 'history';

const tabLabels: Record<EventTab, string> = {
  pending: '待处理',
  scheduled: '计划中',
  history: '历史',
};

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
 * Renders the persisted event inbox, schedule and resolution history.
 *
 * @returns The events route content.
 */
export function EventsPage() {
  const { state, dispatch } = useGameStore();
  const [tab, setTab] = createSignal<EventTab>('pending');
  const inboxEvents = () =>
    state.events.pending.filter((event) => event.snapshot.presentation === 'inbox');

  return (
    <AppShell>
      <PageHeader title="事件中心" desc="处理非阻塞事件，并查看计划与结算记录" />
      <section style={{ ...darkCardStyle('18px'), 'margin-top': '16px' }}>
        <div style={{ display: 'flex', gap: '8px', 'border-bottom': `1px solid ${colors.border}` }}>
          <For each={['pending', 'scheduled', 'history'] as EventTab[]}>
            {(item) => (
              <button
                onClick={() => setTab(item)}
                style={{
                  padding: '9px 12px',
                  border: 'none',
                  'border-bottom':
                    tab() === item ? `2px solid ${colors.primary}` : '2px solid transparent',
                  background: 'transparent',
                  color: tab() === item ? colors.primary : colors.textSecondary,
                  cursor: 'pointer',
                  'font-weight': tab() === item ? 800 : 500,
                }}
              >
                {tabLabels[item]}
              </button>
            )}
          </For>
        </div>

        <Show when={tab() === 'pending'}>
          <div style={{ display: 'grid', gap: '12px', 'margin-top': '16px' }}>
            <Show
              when={inboxEvents().length > 0}
              fallback={<p style={{ color: colors.textMuted }}>没有待处理的非阻塞事件。</p>}
            >
              <For each={inboxEvents()}>
                {(event) => (
                  <article
                    style={{
                      padding: '14px',
                      border: `1px solid ${colors.borderLight}`,
                      'border-radius': '7px',
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{ display: 'flex', 'justify-content': 'space-between', gap: '10px' }}
                    >
                      <b>{event.snapshot.title}</b>
                      <span style={pillStyle(colors.secondaryLight, colors.secondary)}>待处理</span>
                    </div>
                    <p
                      style={{
                        'margin-top': '7px',
                        color: colors.textSecondary,
                        'font-size': '13px',
                        'line-height': '1.6',
                      }}
                    >
                      {event.snapshot.description}
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        'flex-wrap': 'wrap',
                        gap: '10px',
                        'margin-top': '10px',
                        color: colors.textMuted,
                        'font-size': '12px',
                      }}
                    >
                      <span>
                        截止：{event.deadlineDay === null ? '无' : `第 ${event.deadlineDay} 日`}
                      </span>
                      <span>来源：{sourceLabel(event.triggerContext.signalType)}</span>
                      <span>上下文：{event.sourceKey}</span>
                    </div>
                    <div style={{ display: 'grid', gap: '7px', 'margin-top': '14px' }}>
                      <For each={event.snapshot.options}>
                        {(option) => (
                          <button
                            onClick={() =>
                              dispatch({
                                type: 'CHOOSE_EVENT_OPTION',
                                eventInstanceId: event.instanceId,
                                optionId: option.id,
                              })
                            }
                            style={{
                              padding: '10px 12px',
                              border: `1px solid ${colors.border}`,
                              'border-radius': '5px',
                              background: colors.bgCard,
                              color: colors.textPrimary,
                              cursor: 'pointer',
                              'text-align': 'left',
                            }}
                          >
                            <b>{option.label}</b>
                            <Show when={option.description}>
                              <span
                                style={{
                                  display: 'block',
                                  'margin-top': '3px',
                                  color: colors.textMuted,
                                  'font-size': '12px',
                                }}
                              >
                                {option.description}
                              </span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </article>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'scheduled'}>
          <div style={{ display: 'grid', gap: '10px', 'margin-top': '16px' }}>
            <Show
              when={state.events.scheduled.length > 0}
              fallback={<p style={{ color: colors.textMuted }}>没有计划中的事件。</p>}
            >
              <For each={state.events.scheduled}>
                {(event) => (
                  <article
                    style={{
                      padding: '13px',
                      border: `1px solid ${colors.borderLight}`,
                      'border-radius': '7px',
                      background: '#fff',
                    }}
                  >
                    <b>{event.snapshot.title}</b>
                    <div
                      style={{
                        display: 'grid',
                        'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '8px',
                        'margin-top': '9px',
                        color: colors.textSecondary,
                        'font-size': '12px',
                      }}
                    >
                      <span>激活日：第 {event.activateAtDay} 日</span>
                      <span>事件链：{event.chainInstanceId ?? '独立事件'}</span>
                      <span>来源：{sourceLabel(event.triggerContext.signalType)}</span>
                      <span>上下文：{event.sourceKey}</span>
                    </div>
                  </article>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'history'}>
          <div style={{ display: 'grid', gap: '10px', 'margin-top': '16px' }}>
            <Show
              when={state.events.history.length > 0}
              fallback={<p style={{ color: colors.textMuted }}>尚无事件历史。</p>}
            >
              <For each={state.events.history}>
                {(event) => (
                  <article
                    style={{
                      padding: '13px',
                      border: `1px solid ${colors.borderLight}`,
                      'border-radius': '7px',
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{ display: 'flex', 'justify-content': 'space-between', gap: '10px' }}
                    >
                      <b>{event.titleSnapshot}</b>
                      <span style={pillStyle(colors.bgSoft, colors.textSecondary)}>
                        {statusLabel(event.finalStatus)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gap: '5px',
                        'margin-top': '9px',
                        color: colors.textSecondary,
                        'font-size': '12px',
                      }}
                    >
                      <span>选择：{event.chosenOptionLabel ?? '未选择（自动结束）'}</span>
                      <span>完成日：第 {event.completedAtDay} 日</span>
                      <span>事件链：{event.chainInstanceId ?? '独立事件'}</span>
                      <span>来源：{event.sourceKey}</span>
                    </div>
                    <Show when={event.appliedEffects.length > 0}>
                      <div
                        style={{
                          display: 'flex',
                          'flex-wrap': 'wrap',
                          gap: '6px',
                          'margin-top': '10px',
                        }}
                      >
                        <For each={event.appliedEffects}>
                          {(effect) => (
                            <span style={pillStyle(colors.successLight, '#27752a')}>
                              {effect.label}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                  </article>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </section>
      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
