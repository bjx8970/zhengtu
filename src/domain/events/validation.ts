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
 * - automatic 事件不得有玩家选项且须携带 automaticOutcome
 * - blocking/inbox 事件至少一个选项且不得有 automaticOutcome
 * - once_per_chain 必须携带 chainId
 * - 零延迟后续事件不得形成循环
 * - trigger.sources 与条件/效果的 signal 字段引用兼容（来源字段映射）
 * - fixed 机构/地区引用存在于已知实体集合（如提供）
 */

import type { EventDefinition, EventOutcomePayload } from './definition';
import type { ConditionExpression, EffectDefinition } from '../conditions';
import { SIGNAL_TYPE_PAYLOAD_FIELDS } from '../governance/types';

/** 已知实体 ID 集合（用于校验 fixed 机构/地区引用，可选） */
export interface EventValidationKnownIds {
  institutionIds: ReadonlySet<string>;
  regionIds: ReadonlySet<string>;
}

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
 * 收集条件表达式引用的信号字段。
 *
 * @param cond 条件表达式
 * @param out 输出集合（信号字段名）
 */
function collectConditionSignalFields(cond: ConditionExpression, out: Set<string>): void {
  if ('all' in cond) {
    cond.all.forEach((c) => collectConditionSignalFields(c, out));
    return;
  }
  if ('any' in cond) {
    cond.any.forEach((c) => collectConditionSignalFields(c, out));
    return;
  }
  if ('not' in cond) {
    collectConditionSignalFields(cond.not, out);
    return;
  }
  if ('signalField' in cond) {
    out.add(cond.signalField);
    return;
  }
  if ('policyRef' in cond) {
    // policyRef source='signal' 引用触发信号的 policyInstanceId
    if (cond.policyRef.source === 'signal') {
      out.add('policyInstanceId');
    }
  }
}

/**
 * 收集效果列表引用的信号字段与 fixed 机构/地区 ID。
 *
 * @param effects 效果定义列表
 * @param signalFields 输出集合（信号字段名）
 * @param fixedInstitutions 输出集合（fixed 机构 ID）
 * @param fixedRegions 输出集合（fixed 地区 ID）
 */
function collectEffectRefs(
  effects: readonly EffectDefinition[],
  signalFields: Set<string>,
  fixedInstitutions: Set<string>,
  fixedRegions: Set<string>,
): void {
  for (const eff of effects) {
    if (eff.target === 'institution_metric') {
      if (eff.institutionRef.source === 'signal') {
        signalFields.add(eff.institutionRef.field);
      } else if (eff.institutionRef.source === 'fixed') {
        fixedInstitutions.add(eff.institutionRef.institutionId);
      }
    } else if (eff.target === 'region_metric') {
      if (eff.regionRef.source === 'signal') {
        signalFields.add(eff.regionRef.field);
      } else if (eff.regionRef.source === 'fixed') {
        fixedRegions.add(eff.regionRef.regionId);
      }
    } else if (eff.target === 'policy_metric') {
      if (eff.policyRef.source === 'signal') {
        signalFields.add(eff.policyRef.field);
      }
    }
  }
}

/**
 * 验证事件定义集合。
 *
 * @param events 事件定义数组
 * @param knownIds 已知机构/地区 ID 集合（可选，用于校验 fixed 引用）
 * @returns 错误信息列表（空表示通过）
 */
export function validateEventDefinitions(
  events: readonly EventDefinition[],
  knownIds?: EventValidationKnownIds,
): string[] {
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

    // 9. automatic 事件不得有玩家选项，且须携带可执行载荷 automaticOutcome
    if (event.presentation === 'automatic') {
      if (event.options.length > 0) {
        errors.push(`事件 ${event.id}: automatic 事件不得有玩家选项`);
      }
      if (!event.automaticOutcome) {
        errors.push(`事件 ${event.id}: automatic 事件必须携带 automaticOutcome 可执行载荷`);
      }
    } else {
      // blocking/inbox 事件至少一个选项，且不得有 automaticOutcome
      if (event.options.length < 1) {
        errors.push(`事件 ${event.id}: ${event.presentation} 事件至少需要一个选项`);
      }
      if (event.automaticOutcome) {
        errors.push(`事件 ${event.id}: ${event.presentation} 事件不得有 automaticOutcome`);
      }
    }

    // 14. once_per_chain 必须有 chainId
    if (event.repeatPolicy.mode === 'once_per_chain' && event.chainId === null) {
      errors.push(`事件 ${event.id}: once_per_chain 模式必须携带 chainId`);
    }

    // 来源兼容性：trigger.sources 的载荷字段并集
    const availableFields = new Set<string>();
    for (const source of event.trigger.sources) {
      for (const field of SIGNAL_TYPE_PAYLOAD_FIELDS[source] ?? []) {
        availableFields.add(field);
      }
    }

    // 收集本事件引用的信号字段与 fixed 引用
    const referencedSignalFields = new Set<string>();
    const fixedInstitutions = new Set<string>();
    const fixedRegions = new Set<string>();

    if (event.trigger.condition) {
      collectConditionSignalFields(event.trigger.condition, referencedSignalFields);
    }

    // 校验载荷（选项或 automaticOutcome）中的效果引用与后续/取消引用
    const validatePayload = (
      effects: readonly EffectDefinition[],
      schedule: EventOutcomePayload['schedule'],
      cancelScheduledEvents: EventOutcomePayload['cancelScheduledEvents'],
      scopeLabel: string,
    ): void => {
      collectEffectRefs(effects, referencedSignalFields, fixedInstitutions, fixedRegions);
      for (const followup of schedule ?? []) {
        if (!eventIds.has(followup.eventId)) {
          errors.push(`事件 ${event.id} ${scopeLabel}: 后续事件 "${followup.eventId}" 不存在`);
        }
        if (followup.delayDays === 0) {
          const edges = zeroDelayGraph.get(event.id) ?? [];
          edges.push(followup.eventId);
          zeroDelayGraph.set(event.id, edges);
        }
      }
      for (const cancelId of cancelScheduledEvents ?? []) {
        if (!eventIds.has(cancelId)) {
          errors.push(`事件 ${event.id} ${scopeLabel}: 取消事件 "${cancelId}" 不存在`);
        }
      }
    };

    for (const option of event.options) {
      validatePayload(
        option.effects,
        option.schedule,
        option.cancelScheduledEvents,
        `选项 ${option.id}`,
      );
    }
    if (event.automaticOutcome) {
      validatePayload(
        event.automaticOutcome.effects,
        event.automaticOutcome.schedule,
        event.automaticOutcome.cancelScheduledEvents,
        'automaticOutcome',
      );
    }

    // 来源兼容性验证：引用的信号字段必须在可触发来源载荷中有定义
    for (const field of referencedSignalFields) {
      if (!availableFields.has(field)) {
        errors.push(
          `事件 ${event.id}: 引用信号字段 "${field}" 不在触发来源 [${event.trigger.sources.join(', ')}] 的载荷中，事件将不可达`,
        );
      }
    }

    // fixed 机构/地区引用校验（如提供已知 ID 集合）
    if (knownIds) {
      for (const instId of fixedInstitutions) {
        if (!knownIds.institutionIds.has(instId)) {
          errors.push(`事件 ${event.id}: fixed 机构引用 "${instId}" 不在已知机构集合中`);
        }
      }
      for (const regionId of fixedRegions) {
        if (!knownIds.regionIds.has(regionId)) {
          errors.push(`事件 ${event.id}: fixed 地区引用 "${regionId}" 不在已知地区集合中`);
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
