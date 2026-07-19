/**
 * UI 展示模型。
 *
 * 描述功能入口的交付状态和共享组件属性类型，
 * 避免接口定义散落在业务代码中。
 */

export interface FeatureEntry {
  /** 稳定标识，后续注册路由时保持不变。 */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly status: 'available' | 'planned';
  readonly route?: string;
  readonly phase: string;
}

/**
 * 状态摘要计量条组件属性。
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
 * 底部 Tab 导航项定义。
 */
export interface TabDef {
  label: string;
  icon: string;
  route: string;
}
