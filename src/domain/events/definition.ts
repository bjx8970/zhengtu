/**
 * 新版事件定义契约
 *
 * 定义可执行的事件配置结构 EventDefinition 及其子结构：
 * - 触发器（信号来源 + 统一条件 + 概率/权重/互斥）
 * - 重复策略（once/once_per_chain/once_per_source/repeatable）
 * - 激活定义（延迟/截止）
 * - 选项（统一效果 + 后续调度 + 事实变更）
 * - 自动事件载荷（automaticOutcome，无需玩家选项的可执行结果）
 *
 * TypeScript 类型与 Zod Schema 保持一致，配置不得执行任意脚本。
 * 本文件只定义与验证，运行时编排留给事件编排器。
 *
 * 注：信号发出（emitSignals）能力尚不可执行（需按 signalType 构造合法载荷），
 * 在本阶段移除，留给事件编排器 PR 重新设计。
 */

import { z } from 'zod';
import { DomainSignalSchema } from '../governance/types';
import { ConditionExpressionSchema, EffectDefinitionSchema } from '../conditions';
import {
  EventPrioritySchema,
  EventPresentationSchema,
  ScheduledEventCancellationSchema,
} from './types';

// ===== 事件分类 =====

/** 事件分类常量数组 */
export const EVENT_CATEGORIES = [
  'resident',
  'political',
  'economic',
  'emergency',
  'governance',
  'career',
  'story',
] as const;

/** 事件分类类型 */
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** 事件分类 Zod Schema */
export const EventCategorySchema = z.enum(EVENT_CATEGORIES);

// ===== 事实变更 =====

/** 事实变更定义：设置一个世界事实 */
export interface FactMutationDefinition {
  /** 事实 ID */
  factId: string;
  /** 事实值 */
  value: boolean | number | string;
}

// ===== 触发器 =====

/**
 * 事件触发定义。
 *
 * - sources 至少一个领域信号来源
 * - condition 使用统一 ConditionExpression
 * - probability 范围 [0,1]，weight 必须 > 0
 * - mutexGroup 如存在必须为非空稳定 ID
 */
export interface EventTriggerDefinition {
  /** 触发信号来源（至少一个） */
  sources: import('../governance/types').DomainSignal[];
  /** 触发条件（可选） */
  condition?: import('../conditions').ConditionExpression;
  /** 触发概率 [0,1]（可选） */
  probability?: number;
  /** 加权权重 > 0（可选） */
  weight?: number;
  /** 互斥组 ID（可选，非空） */
  mutexGroup?: string;
}

// ===== 重复策略 =====

/** 重复模式常量数组 */
export const EVENT_REPEAT_MODES = [
  'once',
  'once_per_chain',
  'once_per_source',
  'repeatable',
] as const;

/** 重复模式类型 */
export type EventRepeatMode = (typeof EVENT_REPEAT_MODES)[number];

/**
 * 事件重复策略。
 *
 * - cooldownDays 非负整数
 * - maxActivations 正整数
 * - once_per_chain 事件必须携带 chainId（由配置验证保证）
 */
export interface EventRepeatPolicy {
  /** 重复模式 */
  mode: EventRepeatMode;
  /** 冷却天数（非负整数，可选） */
  cooldownDays?: number;
  /** 最大触发次数（正整数，可选） */
  maxActivations?: number;
}

// ===== 激活定义 =====

/**
 * 事件激活定义。
 *
 * - delayDays 与 delayRange 不能同时出现
 * - 延迟为非负整数，delayRange.min <= delayRange.max
 * - deadlineDays 为正整数
 */
export interface EventActivationDefinition {
  /** 固定延迟天数（非负整数，可选） */
  delayDays?: number;
  /** 延迟范围（可选，与 delayDays 互斥） */
  delayRange?: { min: number; max: number };
  /** 截止天数（正整数，可选） */
  deadlineDays?: number;
}

// ===== 后续事件调度 =====

/**
 * 后续事件调度定义。
 *
 * 本次只定义和验证，不要求真正写入 EventRuntimeState.scheduled。
 */
export interface ScheduledFollowupDefinition {
  /** 后续事件 ID（必须存在） */
  eventId: string;
  /** 延迟天数（非负整数） */
  delayDays: number;
  /** 触发概率 [0,1]（可选） */
  probability?: number;
  /** 触发条件（可选） */
  condition?: import('../conditions').ConditionExpression;
}

// ===== 事件选项 =====

/**
 * 事件选项定义。
 *
 * - id 在单个事件内唯一
 * - effects 使用统一 EffectDefinition
 * - 选项不得直接执行任意脚本
 */
export interface EventOptionDefinition {
  /** 选项 ID（事件内唯一） */
  id: string;
  /** 选项标签 */
  label: string;
  /** 选项描述 */
  description: string;
  /** 效果列表 */
  effects: import('../conditions').EffectDefinition[];
  /** 调度的后续事件（可选） */
  schedule?: ScheduledFollowupDefinition[];
  /** 取消的计划事件 ID 列表（可选，旧格式） */
  cancelScheduledEvents?: string[];
  /** 选项冷却天数（可选） */
  cooldownDays?: number;
  /** 计划事件取消规范（按作用域，可选） */
  cancelScheduled?: import('./types').ScheduledEventCancellation[];
  /** 设置的世界事实（可选，已废弃，使用 world_fact effect 替代） */
  setFacts?: FactMutationDefinition[];
}

// ===== 自动事件载荷 =====

/**
 * 自动事件可执行载荷。
 *
 * automatic 事件没有玩家选项，其效果/调度/事实变更直接定义在事件级，
 * 由编排器在事件触发时自动结算。
 */
export interface EventOutcomePayload {
  /** 效果列表 */
  effects: import('../conditions').EffectDefinition[];
  /** 调度的后续事件（可选） */
  schedule?: ScheduledFollowupDefinition[];
  /** 取消的计划事件 ID 列表（可选，旧格式） */
  cancelScheduledEvents?: string[];
  /** 计划事件取消规范（按作用域，可选） */
  cancelScheduled?: import('./types').ScheduledEventCancellation[];
  /** 设置的世界事实（可选，已废弃） */
  setFacts?: FactMutationDefinition[];
}

// ===== 事件定义 =====

/**
 * 新版事件定义。
 *
 * - chainId/nodeId：事件链归属（独立事件为 null）
 * - presentation 为 automatic 时不得有玩家选项，须携带 automaticOutcome（由配置验证保证）
 * - presentation 为 blocking/inbox 时至少一个选项且不得有 automaticOutcome（由配置验证保证）
 */
export interface EventDefinition {
  /** 稳定事件 ID（全局唯一） */
  id: string;
  /** 所属事件链 ID（独立事件为 null） */
  chainId: string | null;
  /** 事件链节点 ID（独立事件为 null） */
  nodeId: string | null;
  /** 事件标题 */
  title: string;
  /** 事件描述 */
  description: string;
  /** 事件分类 */
  category: EventCategory;
  /** 优先级 */
  priority: import('./types').EventPriority;
  /** 呈现方式 */
  presentation: import('./types').EventPresentation;
  /** 触发定义 */
  trigger: EventTriggerDefinition;
  /** 重复策略 */
  repeatPolicy: EventRepeatPolicy;
  /** 激活定义 */
  activation: EventActivationDefinition;
  /** 互斥组 ID（可选，从 trigger.mutexGroup 复制） */
  mutexGroup?: string;
  /** 内容版本（用于快照标记） */
  contentVersion?: string;
  /** 选项列表（blocking/inbox 事件） */
  options: EventOptionDefinition[];
  /** 自动事件载荷（仅 automatic 事件，可选但验证要求存在） */
  automaticOutcome?: EventOutcomePayload;
}

// ===== Zod Schema =====

/** 事实变更定义 Schema */
const FactMutationDefinitionSchema = z
  .object({
    factId: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string()]),
  })
  .strict();

/** 触发定义 Schema */
const EventTriggerDefinitionSchema = z
  .object({
    sources: z.array(DomainSignalSchema).min(1),
    condition: ConditionExpressionSchema.optional(),
    probability: z.number().min(0).max(1).optional(),
    weight: z.number().positive().optional(),
    mutexGroup: z.string().min(1).optional(),
  })
  .strict();

/** 重复策略 Schema */
const EventRepeatPolicySchema = z
  .object({
    mode: z.enum(EVENT_REPEAT_MODES),
    cooldownDays: z.number().int().nonnegative().optional(),
    maxActivations: z.number().int().positive().optional(),
  })
  .strict();

/** 激活定义 Schema（delayDays 与 delayRange 互斥由 refine 保证） */
const EventActivationDefinitionSchema = z
  .object({
    delayDays: z.number().int().nonnegative().optional(),
    delayRange: z
      .object({
        min: z.number().int().nonnegative(),
        max: z.number().int().nonnegative(),
      })
      .strict()
      .refine((r) => r.min <= r.max, { message: 'delayRange.min must be <= delayRange.max' })
      .optional(),
    deadlineDays: z.number().int().positive().optional(),
  })
  .strict()
  .refine((a) => !(a.delayDays !== undefined && a.delayRange !== undefined), {
    message: 'delayDays and delayRange are mutually exclusive',
  });

/** 后续事件调度 Schema */
const ScheduledFollowupDefinitionSchema: z.ZodType<ScheduledFollowupDefinition> = z.lazy(() =>
  z
    .object({
      eventId: z.string().min(1),
      delayDays: z.number().int().nonnegative(),
      probability: z.number().min(0).max(1).optional(),
      condition: ConditionExpressionSchema.optional(),
    })
    .strict(),
);

/** 事件选项 Schema */
export const EventOptionDefinitionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string(),
    effects: z.array(EffectDefinitionSchema),
    schedule: z.array(ScheduledFollowupDefinitionSchema).optional(),
    cancelScheduledEvents: z.array(z.string().min(1)).optional(),
    cooldownDays: z.number().int().nonnegative().optional(),
    cancelScheduled: z.array(ScheduledEventCancellationSchema).optional(),
    setFacts: z.array(FactMutationDefinitionSchema).optional(),
  })
  .strict();

/** 自动事件载荷 Schema */
export const EventOutcomePayloadSchema = z
  .object({
    effects: z.array(EffectDefinitionSchema),
    schedule: z.array(ScheduledFollowupDefinitionSchema).optional(),
    cancelScheduledEvents: z.array(z.string().min(1)).optional(),
    cancelScheduled: z.array(ScheduledEventCancellationSchema).optional(),
    setFacts: z.array(FactMutationDefinitionSchema).optional(),
  })
  .strict();

/** 事件定义 Schema */
export const EventDefinitionSchema = z
  .object({
    id: z.string().min(1),
    chainId: z.string().min(1).nullable(),
    nodeId: z.string().min(1).nullable(),
    title: z.string().min(1),
    description: z.string(),
    category: EventCategorySchema,
    priority: EventPrioritySchema,
    presentation: EventPresentationSchema,
    trigger: EventTriggerDefinitionSchema,
    repeatPolicy: EventRepeatPolicySchema,
    activation: EventActivationDefinitionSchema,
    mutexGroup: z.string().min(1).optional(),
    contentVersion: z.string().optional(),
    options: z.array(EventOptionDefinitionSchema),
    automaticOutcome: EventOutcomePayloadSchema.optional(),
  })
  .strict();

/** 事件定义数组 Schema（用于配置加载） */
export const EventDefinitionArraySchema = z.array(EventDefinitionSchema);
