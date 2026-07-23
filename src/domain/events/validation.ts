/**
 * 事件配置验证
 *
 * 纯函数 validateEventDefinitions：对一组 EventDefinition 执行引用完整性与
 * 约束验证，返回错误信息列表（空列表表示通过）。
 *
 * 验证项：
 * - 事件 ID 全局唯一
 * - 选项 ID 在事件内唯一
 * - chainId + nodeId 组合唯一
 * - 后续事件引用存在
 * - 取消事件引用存在
 * - automatic 事件不得有玩家选项
 * - blocking/inbox 事件至少一个选项
 * - once_per_chain 必须携带 chainId
 * - 零延迟后续事件不得形成循环
 */

import type { EventDefinition } from './definition';

/**
 * 检测零延迟后续事件图中的循环（DFS 三色标记）。
 *
 * @param graph 事件 ID → 零延迟后续事件 ID 列表
 * @returns 首个发现的循环路径（节点 ID 数组），无循环返回 null
 */
function detectZeroDelayCycle(graph: Map<string, string[]>): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);
  // 确保所有被引用的节点也在图中
  for (const edges of graph.values()) {
    for (const next of edges) {
      if (!color.has(next)) color.set(next, WHITE);
    }
  }

  const dfs = (node: string, stack: string[]): string[] | null => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (color.get(next) === GRAY) {
        return [...stack, next];
      }
      if (color.get(next) === WHITE) {
        const cycle = dfs(next, stack);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const id of color.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id, []);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * 验证事件定义集合。
 *
 * @param events 事件定义数组
 * @returns 错误信息列表（空表示通过）
 */
export function validateEventDefinitions(events: readonly EventDefinition[]): string[] {
  const errors: string[] = [];
  const eventIds = new Set(events.map((e) => e.id));

  // 1. 事件 ID 全局唯一
  if (eventIds.size !== events.length) {
    errors.push('存在重复的事件 ID');
  }

  // 3. chainId + nodeId 组合唯一
  const chainNodeKeys = new Set<string>();
  for (const event of events) {
    if (event.chainId !== null && event.nodeId !== null) {
      const key = `${event.chainId}::${event.nodeId}`;
      if (chainNodeKeys.has(key)) {
        errors.push(`事件 ${event.id}: chainId+nodeId 组合重复 (${key})`);
      }
      chainNodeKeys.add(key);
    }
  }

  // 零延迟后续事件图
  const zeroDelayGraph = new Map<string, string[]>();

  for (const event of events) {
    // 2. 选项 ID 在事件内唯一
    const optionIds = new Set(event.options.map((o) => o.id));
    if (optionIds.size !== event.options.length) {
      errors.push(`事件 ${event.id}: 存在重复的选项 ID`);
    }

    // 9. automatic 事件不得有玩家选项
    if (event.presentation === 'automatic' && event.options.length > 0) {
      errors.push(`事件 ${event.id}: automatic 事件不得有玩家选项`);
    }
    // 10. blocking/inbox 事件至少一个选项
    if (
      (event.presentation === 'blocking' || event.presentation === 'inbox') &&
      event.options.length < 1
    ) {
      errors.push(`事件 ${event.id}: ${event.presentation} 事件至少需要一个选项`);
    }

    // 14. once_per_chain 必须有 chainId
    if (event.repeatPolicy.mode === 'once_per_chain' && event.chainId === null) {
      errors.push(`事件 ${event.id}: once_per_chain 模式必须携带 chainId`);
    }

    // 选项级引用校验
    for (const option of event.options) {
      // 4. 后续事件引用存在
      for (const followup of option.schedule ?? []) {
        if (!eventIds.has(followup.eventId)) {
          errors.push(`事件 ${event.id} 选项 ${option.id}: 后续事件 "${followup.eventId}" 不存在`);
        }
        if (followup.delayDays === 0) {
          const edges = zeroDelayGraph.get(event.id) ?? [];
          edges.push(followup.eventId);
          zeroDelayGraph.set(event.id, edges);
        }
      }
      // 5. 取消事件引用存在
      for (const cancelId of option.cancelScheduledEvents ?? []) {
        if (!eventIds.has(cancelId)) {
          errors.push(`事件 ${event.id} 选项 ${option.id}: 取消事件 "${cancelId}" 不存在`);
        }
      }
    }
  }

  // 13. 零延迟后续事件循环检测
  const cycle = detectZeroDelayCycle(zeroDelayGraph);
  if (cycle) {
    errors.push(`零延迟事件循环: ${cycle.join(' → ')}`);
  }

  return errors;
}
