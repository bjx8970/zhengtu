/**
 * 单日可中断时间轴计划。
 *
 * 行动与政策事实在计划执行前统一提交；本计划保存其后的计划事件、
 * 截止处理和周期节点，使 blocking 后可以精确恢复同日剩余工作。
 */

import type { TimelineEvent } from '../../types/game';
import type { TimelineContinuationNode } from '../../types/player';

const NODE_PRIORITY: Record<TimelineContinuationNode['type'], number> = {
  career_opportunity_expiry: 0,
  scheduled_event_activation: 1,
  event_deadline: 2,
  monthly_settlement: 3,
  annual_assessment: 4,
  political_cycle: 5,
  retirement_check: 6,
};

/**
 * 返回持久化时间轴节点的固定同日优先级。
 *
 * @param node 时间轴 continuation 节点
 * @returns 越小越先执行的优先级
 */
export function getTimelineContinuationNodePriority(node: TimelineContinuationNode): number {
  return NODE_PRIORITY[node.type];
}

/**
 * 构建行动/政策事实之后应执行的同日节点。
 *
 * @param absoluteDay 当前绝对日
 * @param events 统一时间轴为该日生成的事件
 * @returns 固定顺序、可序列化的剩余节点
 */
export function buildDailyTimelinePlan(
  absoluteDay: number,
  events: readonly TimelineEvent[],
): TimelineContinuationNode[] {
  const nodes: TimelineContinuationNode[] = [
    { type: 'career_opportunity_expiry', absoluteDay },
    { type: 'scheduled_event_activation', absoluteDay },
    { type: 'event_deadline', absoluteDay },
  ];
  for (const event of events) {
    switch (event.type) {
      case 'monthly_settlement':
        nodes.push({
          type: event.type,
          absoluteDay,
          month: event.month,
          year: event.year,
        });
        break;
      case 'annual_assessment':
        nodes.push({ type: event.type, absoluteDay, year: event.year });
        break;
      case 'political_cycle':
        nodes.push({ type: event.type, absoluteDay, year: event.year });
        break;
      case 'retirement_check':
        nodes.push({ type: event.type, absoluteDay });
        break;
      case 'action_completion':
        break;
    }
  }
  return nodes.sort(
    (left, right) =>
      getTimelineContinuationNodePriority(left) - getTimelineContinuationNodePriority(right),
  );
}
