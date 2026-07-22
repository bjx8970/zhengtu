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

/** 领域信号快照（按信号类型判别联合，各类型有固定载荷 + 实例身份） */
export type DomainSignalSnapshot =
  | {
      signalType: 'action.completed';
      occurredAtDay: number;
      data: {
        actionInstanceId: string;
        actionId: string;
        deptId: string;
        regionId: string;
        institutionId: string;
      };
    }
  | {
      signalType: 'policy.approved';
      occurredAtDay: number;
      data: { policyInstanceId: string; policyId: string; regionId: string };
    }
  | {
      signalType: 'policy.phase_changed';
      occurredAtDay: number;
      data: { policyInstanceId: string; policyId: string; phaseId: string };
    }
  | {
      signalType: 'policy.metric_changed';
      occurredAtDay: number;
      data: { policyInstanceId: string; policyId: string; metricId: string; value: number };
    }
  | {
      signalType: 'appointment.changed';
      occurredAtDay: number;
      data: {
        experienceId: string;
        positionId: string;
        institutionId: string;
        regionId: string;
        previousPositionId: string | null;
      };
    }
  | {
      signalType: 'assessment.completed';
      occurredAtDay: number;
      data: { year: number; score: number; tier: string };
    }
  | {
      signalType: 'world.metric_changed';
      occurredAtDay: number;
      data: { metricId: string; value: number };
    }
  | {
      signalType: 'event.resolved';
      occurredAtDay: number;
      data: { eventInstanceId: string; eventId: string; optionId: string | null };
    };

/** 领域信号快照 Zod Schema（按 signalType 判别，含实例身份） */
export const DomainSignalSnapshotSchema = z.discriminatedUnion('signalType', [
  z
    .object({
      signalType: z.literal('action.completed'),
      occurredAtDay: z.number(),
      data: z
        .object({
          actionInstanceId: z.string(),
          actionId: z.string(),
          deptId: z.string(),
          regionId: z.string(),
          institutionId: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalType: z.literal('policy.approved'),
      occurredAtDay: z.number(),
      data: z
        .object({ policyInstanceId: z.string(), policyId: z.string(), regionId: z.string() })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalType: z.literal('policy.phase_changed'),
      occurredAtDay: z.number(),
      data: z
        .object({ policyInstanceId: z.string(), policyId: z.string(), phaseId: z.string() })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalType: z.literal('policy.metric_changed'),
      occurredAtDay: z.number(),
      data: z
        .object({
          policyInstanceId: z.string(),
          policyId: z.string(),
          metricId: z.string(),
          value: z.number(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalType: z.literal('appointment.changed'),
      occurredAtDay: z.number(),
      data: z
        .object({
          experienceId: z.string(),
          positionId: z.string(),
          institutionId: z.string(),
          regionId: z.string(),
          previousPositionId: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalType: z.literal('assessment.completed'),
      occurredAtDay: z.number(),
      data: z.object({ year: z.number(), score: z.number(), tier: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      signalType: z.literal('world.metric_changed'),
      occurredAtDay: z.number(),
      data: z.object({ metricId: z.string(), value: z.number() }).strict(),
    })
    .strict(),
  z
    .object({
      signalType: z.literal('event.resolved'),
      occurredAtDay: z.number(),
      data: z
        .object({
          eventInstanceId: z.string(),
          eventId: z.string(),
          optionId: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
]);
