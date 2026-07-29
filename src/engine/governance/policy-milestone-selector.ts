/**
 * 到期政策选择与稳定排序。
 *
 * 时间轴只选择事实，不直接修改政策；转换仍由政策生命周期引擎负责。
 */

import type { PolicyInstance } from '../../domain/governance/state';

/**
 * 选择当前日应自动生效的已批准政策。
 *
 * @param policies 政策实例集合
 * @param currentDay 当前绝对日
 * @returns 按生效日、实例 ID 稳定排序的政策
 */
export function selectDuePolicyActivations(
  policies: readonly PolicyInstance[],
  currentDay: number,
): PolicyInstance[] {
  return policies
    .filter(
      (policy) =>
        policy.status === 'approved' &&
        policy.effectiveAtDay !== null &&
        policy.effectiveAtDay <= currentDay,
    )
    .sort(
      (left, right) =>
        (left.effectiveAtDay ?? 0) - (right.effectiveAtDay ?? 0) ||
        left.instanceId.localeCompare(right.instanceId),
    );
}

/**
 * 选择当前日应推进一个阶段的实施中政策。
 *
 * @param policies 政策实例集合
 * @param currentDay 当前绝对日
 * @returns 按里程碑日、实例 ID 稳定排序的政策
 */
export function selectDuePolicyMilestones(
  policies: readonly PolicyInstance[],
  currentDay: number,
): PolicyInstance[] {
  return policies
    .filter(
      (policy) =>
        policy.status === 'implementing' &&
        policy.nextMilestoneAtDay !== null &&
        policy.nextMilestoneAtDay <= currentDay,
    )
    .sort(
      (left, right) =>
        (left.nextMilestoneAtDay ?? 0) - (right.nextMilestoneAtDay ?? 0) ||
        left.instanceId.localeCompare(right.instanceId),
    );
}
