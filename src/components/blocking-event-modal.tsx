/**
 * Global blocking-event dialog.
 *
 * Reads the active event directly from the game store so it remains visible after a
 * reload and above every route until the player has settled the required choice.
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { colors, font } from '../utils/theme';
import { formatDate } from '../utils/format';

/**
 * Renders the non-dismissible dialog for the active blocking event.
 *
 * @returns A full-screen modal when a blocking event is active, otherwise nothing.
 */
export function BlockingEventModal() {
  const { state, dispatch } = useGameStore();
  const activeEvent = createMemo(() => {
    const activeId = state.events.activeBlockingEventId;
    return activeId
      ? state.events.pending.find((event) => event.instanceId === activeId)
      : undefined;
  });

  const deadline = createMemo(() => {
    const event = activeEvent();
    if (!event || event.deadlineDay === null) return '无明确截止日';
    const remaining = Math.max(event.deadlineDay - state.time.totalDaysPlayed, 0);
    return `第 ${event.deadlineDay} 日（剩余 ${remaining} 天）`;
  });

  return (
    <Show when={activeEvent()}>
      {(event) => (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="blocking-event-title"
          style={{
            position: 'fixed',
            inset: 0,
            'z-index': 100,
            display: 'grid',
            'place-items': 'center',
            padding: '20px',
            background: 'rgba(15, 27, 42, 0.76)',
          }}
        >
          <section
            style={{
              width: 'min(640px, 100%)',
              padding: '26px',
              background: colors.bgCard,
              border: `2px solid ${colors.primary}`,
              'border-radius': '12px',
              'box-shadow': '0 24px 64px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ color: colors.primary, 'font-size': '12px', 'font-weight': 800 }}>
              必须处理的紧急事件
            </div>
            <h2
              id="blocking-event-title"
              style={{ 'margin-top': '6px', 'font-family': font.title, 'font-size': '24px' }}
            >
              {event().snapshot.title}
            </h2>
            <p style={{ 'margin-top': '12px', 'line-height': '1.7', color: colors.textSecondary }}>
              {event().snapshot.description}
            </p>
            <div
              style={{
                display: 'flex',
                'flex-wrap': 'wrap',
                gap: '8px',
                'margin-top': '16px',
                color: colors.textMuted,
                'font-size': '12px',
              }}
            >
              <span>当前：{formatDate(state.time.year, state.time.month, state.time.day)}</span>
              <span>截止：{deadline()}</span>
            </div>
            <div style={{ display: 'grid', gap: '10px', 'margin-top': '22px' }}>
              <For each={event().snapshot.options}>
                {(option) => (
                  <button
                    onClick={() =>
                      dispatch({
                        type: 'CHOOSE_EVENT_OPTION',
                        eventInstanceId: event().instanceId,
                        optionId: option.id,
                      })
                    }
                    style={{
                      padding: '13px 15px',
                      border: `1px solid ${colors.border}`,
                      'border-radius': '7px',
                      background: '#fff',
                      color: colors.textPrimary,
                      cursor: 'pointer',
                      'text-align': 'left',
                    }}
                  >
                    <strong style={{ display: 'block' }}>{option.label}</strong>
                    <Show when={option.description}>
                      <span
                        style={{
                          display: 'block',
                          'margin-top': '4px',
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
            <p style={{ 'margin-top': '16px', color: colors.textMuted, 'font-size': '12px' }}>
              处理后，系统会继续结算本日尚未执行的时间轴节点。
            </p>
          </section>
        </div>
      )}
    </Show>
  );
}
