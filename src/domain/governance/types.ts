/**
 * 治理与政策领域契约
 *
 * 定义政策生命周期、治理项目和领域信号的稳定词汇。
 */

import { z } from 'zod';

// ===== 政策状态 =====

/** 政策状态常量数组（生命周期顺序） */
export const POLICY_STATUSES = [
  'proposed',
  'approved',
  'implementing',
  'suspended',
  'completed',
  'failed',
  'repealed',
] as const;

/** 政策状态类型 */
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/** 政策状态中文标签 */
export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  proposed: '提议',
  approved: '批准',
  implementing: '实施中',
  suspended: '暂停',
  completed: '完成',
  failed: '失败',
  repealed: '废止',
};

/** 政策状态 Zod Schema */
export const PolicyStatusSchema = z.enum(POLICY_STATUSES);

// ===== 领域信号类型 =====

/** 领域信号类型常量数组 */
export const DOMAIN_SIGNALS = [
  'action.completed',
  'policy.approved',
  'policy.phase_changed',
  'policy.metric_changed',
  'appointment.changed',
  'assessment.completed',
  'world.metric_changed',
  'event.resolved',
] as const;

/** 领域信号类型 */
export type DomainSignal = (typeof DOMAIN_SIGNALS)[number];

/** 领域信号 Zod Schema */
export const DomainSignalSchema = z.enum(DOMAIN_SIGNALS);

/** 领域信号快照（事件触发时持久化的上下文） */
export interface DomainSignalSnapshot {
  /** 信号类型 */
  signalType: DomainSignal;
  /** 发生的绝对游戏日 */
  occurredAtDay: number;
  /** 信号携带的数据 */
  data: Record<string, number | string | boolean>;
}

/** 领域信号快照 Zod Schema */
export const DomainSignalSnapshotSchema = z
  .object({
    signalType: DomainSignalSchema,
    occurredAtDay: z.number(),
    data: z.record(z.union([z.number(), z.string(), z.boolean()])),
  })
  .strict();
