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
 * 递归计算条件表达式的适用来源集合。
 *
 * 语义：
 * - 独立于信号的原子条件：适用于所有来源
 * - signal 原子条件：适用于包含该字段的来源
 * - all：子节点适用来源交集
 * - any：子节点适用来源并集
 * - not：继承子节点适用来源
 *
 * @param cond 条件表达式
 * @param sourceFieldSets 每个触发来源的载荷字段集合
 * @returns 适用来源索引集合
 */
function computeApplicableSources(
  cond: ConditionExpression,
  sourceFieldSets: Set<string>[],
): Set<number> {
  const allIndices = () => new Set<number>(sourceFieldSets.map((_, i) => i));
  const fieldSources = (field: string) =>
    new Set<number>(sourceFieldSets.flatMap((fs, i) => (fs.has(field) ? [i] : [])));

  if ('all' in cond) {
    // all：子节点适用来源交集
    let result: Set<number> | null = null;
    for (const child of cond.all) {
      const childSources = computeApplicableSources(child, sourceFieldSets);
      if (result === null) {
        result = childSources;
      } else {
        const current: Set<number> = result;
        result = new Set([...current].filter((i) => childSources.has(i)));
      }
    }
    return result ?? allIndices();
  }
  if ('any' in cond) {
    // any：子节点适用来源并集
    const result = new Set<number>();
    for (const child of cond.any) {
      for (const i of computeApplicableSources(child, sourceFieldSets)) result.add(i);
    }
    return result;
  }
  if ('not' in cond) {
    // not：继承子节点适用来源
    return computeApplicableSources(cond.not, sourceFieldSets);
  }
  if ('signalField' in cond) {
    return fieldSources(cond.signalField);
  }
  if ('policyRef' in cond && cond.policyRef.source === 'signal') {
    return fieldSources('policyInstanceId');
  }
  // 独立于信号的原子条件：适用于所有来源
  return allIndices();
}

/**
 * 收集被 not 取反引用的信号字段。
 *
 * 被取反的字段若在某个来源缺失，会因 not(false)=true 错误触发，
 * 因此这些字段须在所有触发来源中都存在。
 *
 * @param cond 条件表达式
 * @param negated 是否处于奇数层 not 下
 * @param out 输出集合
 */
function collectNegatedSignalFields(
  cond: ConditionExpression,
  negated: boolean,
  out: Set<string>,
): void {
  if ('all' in cond) {
    cond.all.forEach((c) => collectNegatedSignalFields(c, negated, out));
    return;
  }
  if ('any' in cond) {
    cond.any.forEach((c) => collectNegatedSignalFields(c, negated, out));
    return;
  }
  if ('not' in cond) {
    collectNegatedSignalFields(cond.not, !negated, out);
    return;
  }
  if ('signalField' in cond) {
    if (negated) out.add(cond.signalField);
    return;
  }
  if ('policyRef' in cond && cond.policyRef.source === 'signal') {
    if (negated) out.add('policyInstanceId');
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

    // 来源兼容性：trigger.sources 的载荷字段并集（条件基本可达性）
    const sourceFieldSets = event.trigger.sources.map(
      (source) => new Set<string>(SIGNAL_TYPE_PAYLOAD_FIELDS[source] ?? []),
    );
    const conditionAvailableFields = new Set<string>();
    for (const fieldSet of sourceFieldSets) {
      for (const field of fieldSet) conditionAvailableFields.add(field);
    }
    // 所有声明来源的载荷字段交集：not 安全性须对每个声明来源保证
    // （not(缺失=false)=true 可对任意声明来源触发，不受触发条件限定）
    const allSourcesIntersection = new Set<string>();
    const firstSourceSet = sourceFieldSets[0];
    if (firstSourceSet) {
      for (const field of firstSourceSet) allSourcesIntersection.add(field);
      for (const fieldSet of sourceFieldSets) {
        for (const field of [...allSourcesIntersection]) {
          if (!fieldSet.has(field)) allSourcesIntersection.delete(field);
        }
      }
    }

    // 条件引用的信号字段（含触发条件与后续调度条件）
    const conditionSignalFields = new Set<string>();
    // 被 not 取反引用的信号字段（须在所有来源存在）
    const negatedSignalFields = new Set<string>();
    // 条件适用来源（递归计算，用于可达性判断）
    let conditionApplicableSources = new Set<number>(sourceFieldSets.map((_, i) => i));
    // 效果引用的信号字段
    const effectSignalFields = new Set<string>();
    const fixedInstitutions = new Set<string>();
    const fixedRegions = new Set<string>();

    if (event.trigger.condition) {
      collectConditionSignalFields(event.trigger.condition, conditionSignalFields);
      collectNegatedSignalFields(event.trigger.condition, false, negatedSignalFields);
      conditionApplicableSources = computeApplicableSources(
        event.trigger.condition,
        sourceFieldSets,
      );
    }

    // 触发条件适用来源的载荷字段交集：
    // 触发条件可能将实际触发来源限定到子集，效果与 not 安全性只需对这些来源保证。
    const applicableSourceFields = new Set<string>();
    const applicableFieldSets = [...conditionApplicableSources]
      .map((i) => sourceFieldSets[i])
      .filter((fs): fs is Set<string> => fs !== undefined);
    const firstApplicableSet = applicableFieldSets[0];
    if (firstApplicableSet) {
      for (const field of firstApplicableSet) applicableSourceFields.add(field);
      for (const fieldSet of applicableFieldSets) {
        for (const field of [...applicableSourceFields]) {
          if (!fieldSet.has(field)) applicableSourceFields.delete(field);
        }
      }
    }

    // 校验载荷（选项或 automaticOutcome）中的效果引用与后续/取消引用
    const validatePayload = (
      effects: readonly EffectDefinition[],
      schedule: EventOutcomePayload['schedule'],
      cancelScheduledEvents: EventOutcomePayload['cancelScheduledEvents'],
      scopeLabel: string,
    ): void => {
      collectEffectRefs(effects, effectSignalFields, fixedInstitutions, fixedRegions);
      for (const followup of schedule ?? []) {
        if (!eventIds.has(followup.eventId)) {
          errors.push(`事件 ${event.id} ${scopeLabel}: 后续事件 "${followup.eventId}" 不存在`);
        }
        // 后续调度条件使用父事件的触发信号上下文。
        // 不同选项/同一选项的多个 followup 是独立分支，不累计相交，
        // 每个后续条件独立验证：其适用来源与触发条件适用来源的交集须非空。
        if (followup.condition) {
          collectConditionSignalFields(followup.condition, conditionSignalFields);
          collectNegatedSignalFields(followup.condition, false, negatedSignalFields);
          const followupSources = computeApplicableSources(followup.condition, sourceFieldSets);
          const reachable = [...conditionApplicableSources].some((i) => followupSources.has(i));
          if (!reachable) {
            errors.push(
              `事件 ${event.id} ${scopeLabel}: 后续事件 "${followup.eventId}" 的条件引用的信号字段在可触发来源中不可达`,
            );
          }
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

    // 条件引用来源兼容性：字段须在任一触发来源载荷中有定义（并集）
    for (const field of conditionSignalFields) {
      if (!conditionAvailableFields.has(field)) {
        errors.push(
          `事件 ${event.id}: 条件引用信号字段 "${field}" 不在任何触发来源 [${event.trigger.sources.join(', ')}] 的载荷中，事件将不可达`,
        );
      }
    }

    // 条件可达性：递归计算的适用来源须非空（否则无任何来源能评估该条件）
    if (conditionSignalFields.size > 0 && conditionApplicableSources.size === 0) {
      errors.push(
        `事件 ${event.id}: 条件引用的信号字段组合不存在于任何单一触发来源，事件将永久不可达`,
      );
    }

    // not 安全性：被取反的字段须在每个声明来源中都存在
    // （not(缺失=false)=true 可对任意声明来源触发，不受触发条件限定）
    for (const field of negatedSignalFields) {
      if (!allSourcesIntersection.has(field)) {
        errors.push(
          `事件 ${event.id}: 条件中 not 取反引用信号字段 "${field}" 并非在所有触发来源 [${event.trigger.sources.join(', ')}] 中都存在，缺失来源将因 not(false) 错误触发`,
        );
      }
    }

    // 效果引用来源兼容性：字段须在每个可触发来源载荷中都可解析
    // （触发条件可能已将实际来源限定到子集，只需对该子集保证）
    for (const field of effectSignalFields) {
      if (!applicableSourceFields.has(field)) {
        errors.push(
          `事件 ${event.id}: 效果引用信号字段 "${field}" 并非在所有可触发来源的载荷中都存在，部分来源触发时结算将失败`,
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
