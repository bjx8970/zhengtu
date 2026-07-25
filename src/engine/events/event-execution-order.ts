/**
 * 事件执行排序
 *
 * 为直接领域信号、显式后续和计划激活提供同一套稳定排序规则。
 * blocking 事件必须先于 automatic/inbox 进入执行批次，避免自动效果
 * 在必须先处理的玩家决策之前提交。
 */

import type { EventDefinition } from '../../domain/events/definition';
import type { EventInstance, ScheduledEventInstance } from '../../domain/events/state';
import type { EventPresentation, EventPriority } from '../../domain/events/types';

/** 可参与事件执行排序的最小信息。 */
interface EventExecutionOrderCandidate {
  presentation: EventPresentation;
  priority: EventPriority;
  stableId: string;
}

const presentationOrder: Record<EventPresentation, number> = {
  blocking: 0,
  automatic: 1,
  inbox: 2,
};

const priorityOrder: Record<EventPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * 比较两个事件的稳定执行顺序。
 *
 * @param left 左侧候选项
 * @param right 右侧候选项
 * @returns 负值表示左侧应先执行
 */
export function compareEventExecutionOrder(
  left: EventExecutionOrderCandidate,
  right: EventExecutionOrderCandidate,
): number {
  const presentationDifference =
    presentationOrder[left.presentation] - presentationOrder[right.presentation];
  if (presentationDifference !== 0) return presentationDifference;

  const priorityDifference = priorityOrder[left.priority] - priorityOrder[right.priority];
  if (priorityDifference !== 0) return priorityDifference;

  return left.stableId.localeCompare(right.stableId);
}

/**
 * 比较事件定义的执行顺序。
 *
 * @param left 左侧事件定义
 * @param right 右侧事件定义
 * @returns 负值表示左侧应先执行
 */
export function compareEventDefinitionExecutionOrder(
  left: EventDefinition,
  right: EventDefinition,
): number {
  return compareEventExecutionOrder(
    { presentation: left.presentation, priority: left.priority, stableId: left.id },
    { presentation: right.presentation, priority: right.priority, stableId: right.id },
  );
}

/**
 * 比较已创建事件实例的执行顺序。
 *
 * 以 eventId 决定内容级稳定顺序，再以 instanceId 消除同定义多实例的并列。
 *
 * @param left 左侧事件实例
 * @param right 右侧事件实例
 * @returns 负值表示左侧应先执行
 */
export function compareEventInstanceExecutionOrder(
  left: EventInstance,
  right: EventInstance,
): number {
  const definitionDifference = compareEventExecutionOrder(
    {
      presentation: left.snapshot.presentation,
      priority: left.snapshot.priority,
      stableId: left.eventId,
    },
    {
      presentation: right.snapshot.presentation,
      priority: right.snapshot.priority,
      stableId: right.eventId,
    },
  );
  if (definitionDifference !== 0) return definitionDifference;
  return left.instanceId.localeCompare(right.instanceId);
}

/**
 * 比较计划事件的激活执行顺序。
 *
 * @param left 左侧计划事件
 * @param right 右侧计划事件
 * @returns 负值表示左侧应先执行
 */
export function compareScheduledEventExecutionOrder(
  left: ScheduledEventInstance,
  right: ScheduledEventInstance,
): number {
  const definitionDifference = compareEventExecutionOrder(
    {
      presentation: left.snapshot.presentation,
      priority: left.snapshot.priority,
      stableId: left.eventId,
    },
    {
      presentation: right.snapshot.presentation,
      priority: right.snapshot.priority,
      stableId: right.eventId,
    },
  );
  if (definitionDifference !== 0) return definitionDifference;
  return left.instanceId.localeCompare(right.instanceId);
}
