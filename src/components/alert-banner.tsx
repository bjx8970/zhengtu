/**
 * 通用信息提醒横幅
 *
 * 在工作台等页面展示分级提醒（公文批示样式）。
 * 支持 warning / danger / info 三种级别，可选跳转按钮。
 */

import { For, Show } from 'solid-js';
import { navigate } from '../router';
import type { AlertItem } from '../types/ui';

export type { AlertItem };

/** 级别到样式类的映射 */
const LEVEL_CLASS: Record<AlertItem['level'], string> = {
  warning: 'banner banner-warning',
  danger: 'banner banner-danger',
  info: 'banner',
};

/** 级别到前缀符号的映射 */
const LEVEL_MARK: Record<AlertItem['level'], string> = {
  warning: '\u26A0',
  danger: '\u26D4',
  info: '\u2139',
};

/**
 * 信息提醒横幅组件。
 *
 * @param props.alerts 当前需要展示的提醒列表
 * @returns 提醒横幅 JSX（列表为空时不渲染任何 DOM）
 */
export function AlertBanner(props: { alerts: AlertItem[] }) {
  return (
    <Show when={props.alerts.length > 0}>
      <div class="flex-col gap-sm">
        <For each={props.alerts}>
          {(alert) => (
            <div class={LEVEL_CLASS[alert.level]}>
              <span aria-hidden="true">{LEVEL_MARK[alert.level]}</span>
              <span class="flex-1">{alert.message}</span>
              <Show when={alert.action}>
                {(action) => (
                  <button class="btn btn-sm" onClick={() => navigate(action().route)}>
                    {action().label}
                  </button>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
