/**
 * 通用信息提醒横幅
 *
 * 在工作台时间推进模块上方展示可扩展的提醒列表。
 * 支持 warning / danger / info 三种级别，可选跳转按钮。
 * 后续可追加健康过低、紧急事件等提醒，只需扩展 alerts 数组。
 */

import { For, Show } from 'solid-js';
import { navigate } from '../router';
import { colors } from '../utils/theme';

/** 单条提醒项 */
export interface AlertItem {
  id: string;
  level: 'warning' | 'danger' | 'info';
  message: string;
  action?: { label: string; route: string };
}

const LEVEL_STYLE: Record<AlertItem['level'], { border: string; bg: string; text: string }> = {
  warning: { border: colors.gold, bg: 'rgba(183,131,36,0.06)', text: '#5e4825' },
  danger: { border: colors.danger, bg: 'rgba(196,77,77,0.06)', text: '#6b2020' },
  info: { border: colors.secondary, bg: 'rgba(40,75,112,0.06)', text: '#1e3a54' },
};

/**
 * 信息提醒横幅组件。
 *
 * @param props.alerts 当前需要展示的提醒列表
 * @returns 提醒横幅 JSX（列表为空时不渲染）
 */
export function AlertBanner(props: { alerts: AlertItem[] }) {
  return (
    <Show when={props.alerts.length > 0}>
      <div style={{ display: 'grid', gap: '8px', 'margin-top': '16px' }}>
        <For each={props.alerts}>
          {(alert) => {
            const style = LEVEL_STYLE[alert.level];
            return (
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'space-between',
                  gap: '12px',
                  padding: '12px 16px',
                  border: `1px solid ${colors.border}`,
                  'border-left': `3px solid ${style.border}`,
                  'border-radius': '4px',
                  background: style.bg,
                  'font-size': '12px',
                  color: style.text,
                  'line-height': '1.6',
                }}
              >
                <span>{alert.message}</span>
                <Show when={alert.action}>
                  {(action) => (
                    <button
                      onClick={() => navigate(action().route)}
                      style={{
                        'flex-shrink': 0,
                        padding: '4px 10px',
                        border: `1px solid ${style.border}`,
                        'border-radius': '4px',
                        background: 'transparent',
                        color: style.text,
                        'font-size': '11px',
                        'font-weight': 700,
                        cursor: 'pointer',
                        'white-space': 'nowrap',
                      }}
                    >
                      {action().label}
                    </button>
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
