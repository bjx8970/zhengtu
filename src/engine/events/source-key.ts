/**
 * 事件来源键派生函数
 *
 * 根据触发信号的类型和载荷，派生统一的事件来源标识键（sourceKey）。
 * 不同信号类型使用不同的实例 ID 作为来源身份，用于 once_per_source
 * 重复检查、冷却作用域和事件链关联。
 */

import type { DomainSignalSnapshot } from '../../domain/governance/types';

/**
 * 根据信号派生统一的来源标识键。
 *
 * @param signal 触发信号快照
 * @returns 来源标识键（非空字符串）
 */
export function deriveEventSourceKey(signal: DomainSignalSnapshot): string {
  switch (signal.signalType) {
    case 'action.completed':
      return signal.data.actionInstanceId;
    case 'policy.approved':
    case 'policy.phase_changed':
    case 'policy.metric_changed':
      return signal.data.policyInstanceId;
    case 'appointment.changed':
      return signal.data.experienceId;
    case 'assessment.completed':
      return `assessment_${signal.data.year}_${signal.data.tier}`;
    case 'world.metric_changed':
      // 世界指标变化无固定实例 ID，使用 signalId 作为来源
      return signal.signalId;
    case 'event.resolved':
      return signal.data.eventInstanceId;
  }
}
