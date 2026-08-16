/**
 * 全局阻塞事件弹窗
 *
 * 直接从 Store 读取当前阻塞事件：刷新后仍保持可见，玩家必须做出处置
 * 才能继续推进时间。语义保持 role="dialog" + aria-modal，选项按钮沿用
 * data-testid="blocking-event-option-{instanceId}-{optionId}" 契约。
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../store/game-store';
import { formatDate } from '../utils/format';

/**
 * 渲染当前阻塞事件的非关闭式弹窗。
 *
 * @returns 存在阻塞事件时渲染全屏弹窗，否则不渲染任何 DOM
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
          class="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="blocking-event-title"
        >
          <section class="modal-card">
            <div class="modal-kicker">紧急公文 · 必须处置</div>
            <h2 id="blocking-event-title" class="modal-title">
              {event().snapshot.title}
            </h2>
            <p class="modal-body">{event().snapshot.description}</p>
            <div class="flex gap-md text-xs muted" style={{ 'margin-top': 'var(--space-md)' }}>
              <span>当前：{formatDate(state.time.year, state.time.month, state.time.day)}</span>
              <span>截止：{deadline()}</span>
            </div>
            <div class="modal-actions">
              <For each={event().snapshot.options}>
                {(option) => (
                  <button
                    class="btn"
                    data-testid={`blocking-event-option-${event().instanceId}-${option.id}`}
                    onClick={() =>
                      dispatch({
                        type: 'CHOOSE_EVENT_OPTION',
                        eventInstanceId: event().instanceId,
                        optionId: option.id,
                      })
                    }
                    style={{
                      'flex-direction': 'column',
                      'align-items': 'flex-start',
                      gap: '0.2rem',
                    }}
                  >
                    <strong>{option.label}</strong>
                    <Show when={option.description}>
                      <span class="text-xs muted" style={{ 'font-weight': '400' }}>
                        {option.description}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <p class="text-xs muted" style={{ 'margin-top': 'var(--space-md)' }}>
              处置后，系统将继续结算本日尚未执行的时间轴节点。
            </p>
          </section>
        </div>
      )}
    </Show>
  );
}
