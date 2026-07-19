/**
 * 状态摘要计量条组件
 *
 * 用于主页状态摘要区，每项显示标签、数值和 Meter 进度条。
 */

import { colors, meterContainer } from '../utils/theme';

/**
 * 计量条组件属性。
 */
export interface MetricsBarProps {
  /** 显示标签 */
  label: string;
  /** 显示数值 */
  value: string;
  /** 完成率（0~1） */
  pct: number;
  /** 进度条颜色，默认品牌绿 */
  barColor?: string;
}

/**
 * 渲染单个状态摘要计量条。
 *
 * @param props 计量条属性
 * @returns 计量条 JSX
 */
export function MetricsBar(props: MetricsBarProps) {
  return (
    <div
      style={{
        padding: '14px',
        border: `1px solid ${colors.border}`,
        'border-radius': '8px',
        background: '#fff',
      }}
    >
      <div style={{ 'font-size': '22px', 'font-weight': 800, 'line-height': '1.2' }}>
        {props.value}
      </div>
      <div style={{ 'margin-top': '6px', color: colors.textMuted, 'font-size': '12px' }}>
        {props.label}
      </div>
      <div style={{ ...meterContainer(), 'margin-top': '10px' }}>
        <div
          style={{
            height: '100%',
            'border-radius': 'inherit',
            background: props.barColor || colors.success,
            width: `${Math.min(props.pct * 100, 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
