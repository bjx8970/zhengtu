/**
 * 事件领域契约
 *
 * 定义事件系统的稳定词汇：优先级、呈现方式、实例状态、事件链状态。
 */

import { z } from 'zod';

// ===== 事件优先级 =====

/** 事件优先级常量数组（从低到高） */
export const EVENT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/** 事件优先级类型 */
export type EventPriority = (typeof EVENT_PRIORITIES)[number];

/** 事件优先级中文标签 */
export const EVENT_PRIORITY_LABELS: Record<EventPriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
};

/** 事件优先级 Zod Schema */
export const EventPrioritySchema = z.enum(EVENT_PRIORITIES);

// ===== 事件呈现方式 =====

/** 事件呈现方式常量数组 */
export const EVENT_PRESENTATIONS = ['blocking', 'inbox', 'automatic'] as const;

/** 事件呈现方式类型 */
export type EventPresentation = (typeof EVENT_PRESENTATIONS)[number];

/** 事件呈现方式中文标签 */
export const EVENT_PRESENTATION_LABELS: Record<EventPresentation, string> = {
  blocking: '阻塞（必须立即处理）',
  inbox: '收件箱（可延迟处理）',
  automatic: '自动（无需玩家交互）',
};

/** 事件呈现方式 Zod Schema */
export const EventPresentationSchema = z.enum(EVENT_PRESENTATIONS);

// ===== 事件实例状态 =====

/** 事件实例状态常量数组 */
export const EVENT_INSTANCE_STATUSES = [
  'pending',
  'active',
  'resolved',
  'expired',
  'cancelled',
] as const;

/** 事件实例状态类型 */
export type EventInstanceStatus = (typeof EVENT_INSTANCE_STATUSES)[number];

/** 事件实例状态 Zod Schema */
export const EventInstanceStatusSchema = z.enum(EVENT_INSTANCE_STATUSES);

// ===== 事件链状态 =====

/** 事件链状态常量数组 */
export const EVENT_CHAIN_STATUSES = ['active', 'completed', 'failed', 'abandoned'] as const;

/** 事件链状态类型 */
export type EventChainStatus = (typeof EVENT_CHAIN_STATUSES)[number];

/** 事件链状态 Zod Schema */
export const EventChainStatusSchema = z.enum(EVENT_CHAIN_STATUSES);
