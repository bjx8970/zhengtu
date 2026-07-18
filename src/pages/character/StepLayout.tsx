/**
 * 建档向导的步骤布局组件
 *
 * 从 character-creation.tsx 提取的共享布局：
 * - 进度条 + 步骤标签
 * - 内容区（由父组件通过 children 传入）
 * - 底部导航（上一步/下一步/开始仕途）
 */

import type { JSX, Accessor } from 'solid-js';
import { Show, For } from 'solid-js';
import { colors, radius, font } from '../../utils/theme';

/** StepLayout 组件的属性 */
export interface StepLayoutProps {
  /** 当前步骤索引 (0-based) */
  step: Accessor<number>;
  /** 总步骤数 */
  total: number;
  /** 是否允许进入下一步 */
  canNext: Accessor<boolean>;
  /** 上一步回调 */
  onPrev: () => void;
  /** 下一步回调 */
  onNext: () => void;
  /** 完成回调 */
  onComplete: () => void;
  /** 步骤内容 */
  children: JSX.Element;
}

/**
 * 建档向导的共享步骤布局
 *
 * @param props 步骤布局属性
 * @returns 步骤布局 JSX
 */
export function StepLayout(props: StepLayoutProps): JSX.Element {
  const stepLabels = ['基本信息', '出生地', '高考成绩', '院校选择', '家庭背景'];

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', height: '100%' }}>
      {/* 进度条 */}
      <div style={{ padding: '1.5rem 1.5rem 0' }}>
        <div style={{ display: 'flex', gap: '0.3rem', 'margin-bottom': '0.5rem' }}>
          <For each={Array.from({ length: props.total }, (_, i) => i)}>
            {(i) => (
              <div
                style={{
                  flex: 1,
                  height: '3px',
                  'background-color': i <= props.step() ? colors.primary : colors.border,
                  'border-radius': radius.sm,
                  transition: 'background 0.3s',
                }}
              />
            )}
          </For>
        </div>
        <div style={{ 'font-size': '0.8rem', color: colors.textSecondary }}>
          第 {props.step() + 1}/{props.total} 步 — {stepLabels[props.step()]}
        </div>
      </div>

      {/* 内容区 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '1rem 1.5rem',
          overflow: 'hidden',
        }}
      >
        {props.children}
      </div>

      {/* 底部导航 */}
      <div style={{ display: 'flex', gap: '0.8rem', padding: '1rem 1.5rem 1.5rem' }}>
        <Show when={props.step() > 0}>
          <button
            onClick={props.onPrev}
            style={{
              flex: 1,
              padding: '0.8rem',
              'font-size': '1rem',
              'background-color': colors.bgCard,
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
              'border-radius': radius.md,
              cursor: 'pointer',
            }}
          >
            上一步
          </button>
        </Show>
        <Show when={props.step() < props.total - 1}>
          <button
            onClick={props.onNext}
            disabled={!props.canNext()}
            style={{
              flex: 1,
              padding: '0.8rem',
              'font-size': '1rem',
              'background-color': props.canNext() ? colors.primary : colors.border,
              color: props.canNext() ? colors.primaryText : colors.textMuted,
              border: 'none',
              'border-radius': radius.md,
              cursor: props.canNext() ? 'pointer' : 'not-allowed',
            }}
          >
            下一步
          </button>
        </Show>
        <Show when={props.step() === props.total - 1}>
          <button
            onClick={props.onComplete}
            disabled={!props.canNext()}
            style={{
              flex: 1,
              padding: '0.8rem',
              'font-size': '1rem',
              'background-color': props.canNext() ? colors.primary : colors.border,
              color: props.canNext() ? colors.primaryText : colors.textMuted,
              border: 'none',
              'border-radius': radius.md,
              cursor: props.canNext() ? 'pointer' : 'not-allowed',
              'font-family': font.title,
            }}
          >
            开始仕途
          </button>
        </Show>
      </div>
    </div>
  );
}
