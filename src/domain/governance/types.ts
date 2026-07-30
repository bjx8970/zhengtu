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
  'policy.status_changed',
  'appointment.changed',
  'civil_service_rank.changed',
  'assessment.completed',
  'world.metric_changed',
  'event.resolved',
] as const;

/** 领域信号类型 */
export type DomainSignal = (typeof DOMAIN_SIGNALS)[number];

/** 领域信号 Zod Schema */
export const DomainSignalSchema = z.enum(DOMAIN_SIGNALS);

/**
 * 每种信号类型的载荷字段映射（从 DomainSignalSnapshot 派生）。
 *
 * 用于事件配置来源兼容性验证：条件/效果引用的 signal 字段必须在
 * 可触发来源的载荷中有定义，否则事件永久不可达。
 */
export const SIGNAL_TYPE_PAYLOAD_FIELDS: Record<DomainSignal, readonly string[]> = {
  'action.completed': ['actionInstanceId', 'actionId', 'deptId', 'regionId', 'institutionId'],
  'policy.approved': [
    'policyInstanceId',
    'policyId',
    'regionId',
    'institutionId',
    'originPositionId',
  ],
  'policy.phase_changed': [
    'policyInstanceId',
    'policyId',
    'regionId',
    'institutionId',
    'originPositionId',
    'previousPhaseId',
    'currentPhaseId',
  ],
  'policy.metric_changed': [
    'policyInstanceId',
    'policyId',
    'metricId',
    'value',
    'regionId',
    'institutionId',
    'originPositionId',
  ],
  'policy.status_changed': [
    'policyInstanceId',
    'policyId',
    'previousStatus',
    'currentStatus',
    'regionId',
    'institutionId',
    'originPositionId',
  ],
  'appointment.changed': [
    'experienceId',
    'positionId',
    'institutionId',
    'regionId',
    'previousPositionId',
  ],
  'civil_service_rank.changed': [
    'rankChangeId',
    'previousRank',
    'currentRank',
    'reason',
    'sourceType',
    'sourceId',
  ],
  'assessment.completed': ['year', 'score', 'tier'],
  'world.metric_changed': ['metricId', 'value'],
  'event.resolved': ['eventInstanceId', 'eventId', 'optionId', 'occurredAtDay'],
};

/** 领域信号快照（按信号类型判别联合，各类型有固定载荷 + 实例身份 + 信号唯一ID） */
export type DomainSignalSnapshot =
  | {
      signalId: string;
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
      signalId: string;
      signalType: 'policy.approved';
      occurredAtDay: number;
      data: {
        policyInstanceId: string;
        policyId: string;
        regionId: string;
        institutionId: string;
        originPositionId: string;
      };
    }
  | {
      signalId: string;
      signalType: 'policy.phase_changed';
      occurredAtDay: number;
      data: {
        policyInstanceId: string;
        policyId: string;
        regionId: string;
        institutionId: string;
        originPositionId: string;
        previousPhaseId: string | null;
        currentPhaseId: string | null;
      };
    }
  | {
      signalId: string;
      signalType: 'policy.metric_changed';
      occurredAtDay: number;
      data: {
        policyInstanceId: string;
        policyId: string;
        metricId: string;
        value: number;
        regionId: string;
        institutionId: string;
        originPositionId: string;
      };
    }
  | {
      signalId: string;
      signalType: 'policy.status_changed';
      occurredAtDay: number;
      data: {
        policyInstanceId: string;
        policyId: string;
        previousStatus: PolicyStatus;
        currentStatus: PolicyStatus;
        regionId: string;
        institutionId: string;
        originPositionId: string;
      };
    }
  | {
      signalId: string;
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
      signalId: string;
      signalType: 'civil_service_rank.changed';
      occurredAtDay: number;
      data: {
        rankChangeId: string;
        previousRank: import('../career/types').CivilServiceRank;
        currentRank: import('../career/types').CivilServiceRank;
        reason: 'regular_advancement' | 'exceptional_advancement' | 'demotion';
        sourceType: 'assessment' | 'event' | 'policy' | 'system';
        sourceId: string | null;
      };
    }
  | {
      signalId: string;
      signalType: 'assessment.completed';
      occurredAtDay: number;
      data: { year: number; score: number; tier: string };
    }
  | {
      signalId: string;
      signalType: 'world.metric_changed';
      occurredAtDay: number;
      data: { metricId: string; value: number };
    }
  | {
      signalId: string;
      signalType: 'event.resolved';
      occurredAtDay: number;
      data: {
        eventInstanceId: string;
        eventId: string;
        optionId: string | null;
        occurredAtDay: number;
      };
    };

/** 领域信号快照 Zod Schema（按 signalType 判别，含实例身份） */
export const DomainSignalSnapshotSchema = z.discriminatedUnion('signalType', [
  z
    .object({
      signalId: z.string(),
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
      signalId: z.string(),
      signalType: z.literal('civil_service_rank.changed'),
      occurredAtDay: z.number(),
      data: z
        .object({
          rankChangeId: z.string(),
          previousRank: z.enum([
            'clerk_2',
            'clerk_1',
            'section_member_4',
            'section_member_3',
            'section_member_2',
            'section_member_1',
            'researcher_4',
            'researcher_3',
            'researcher_2',
            'researcher_1',
            'inspector_2',
            'inspector_1',
          ]),
          currentRank: z.enum([
            'clerk_2',
            'clerk_1',
            'section_member_4',
            'section_member_3',
            'section_member_2',
            'section_member_1',
            'researcher_4',
            'researcher_3',
            'researcher_2',
            'researcher_1',
            'inspector_2',
            'inspector_1',
          ]),
          reason: z.enum(['regular_advancement', 'exceptional_advancement', 'demotion']),
          sourceType: z.enum(['assessment', 'event', 'policy', 'system']),
          sourceId: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalId: z.string(),
      signalType: z.literal('policy.approved'),
      occurredAtDay: z.number(),
      data: z
        .object({
          policyInstanceId: z.string(),
          policyId: z.string(),
          regionId: z.string(),
          institutionId: z.string(),
          originPositionId: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalId: z.string(),
      signalType: z.literal('policy.phase_changed'),
      occurredAtDay: z.number(),
      data: z
        .object({
          policyInstanceId: z.string(),
          policyId: z.string(),
          regionId: z.string(),
          institutionId: z.string(),
          originPositionId: z.string(),
          previousPhaseId: z.string().nullable(),
          currentPhaseId: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalId: z.string(),
      signalType: z.literal('policy.metric_changed'),
      occurredAtDay: z.number(),
      data: z
        .object({
          policyInstanceId: z.string(),
          policyId: z.string(),
          metricId: z.string(),
          value: z.number(),
          regionId: z.string(),
          institutionId: z.string(),
          originPositionId: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalId: z.string(),
      signalType: z.literal('policy.status_changed'),
      occurredAtDay: z.number(),
      data: z
        .object({
          policyInstanceId: z.string(),
          policyId: z.string(),
          previousStatus: PolicyStatusSchema,
          currentStatus: PolicyStatusSchema,
          regionId: z.string(),
          institutionId: z.string(),
          originPositionId: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      signalId: z.string(),
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
      signalId: z.string(),
      signalType: z.literal('assessment.completed'),
      occurredAtDay: z.number(),
      data: z.object({ year: z.number(), score: z.number(), tier: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      signalId: z.string(),
      signalType: z.literal('world.metric_changed'),
      occurredAtDay: z.number(),
      data: z.object({ metricId: z.string(), value: z.number() }).strict(),
    })
    .strict(),
  z
    .object({
      signalId: z.string(),
      signalType: z.literal('event.resolved'),
      occurredAtDay: z.number(),
      data: z
        .object({
          eventInstanceId: z.string(),
          eventId: z.string(),
          optionId: z.string().nullable(),
          occurredAtDay: z.number(),
        })
        .strict(),
    })
    .strict(),
]);

// ===== 政策分类 =====

/** 政策分类常量数组 */
export const POLICY_CATEGORIES = [
  'economic',
  'social',
  'public_service',
  'public_safety',
  'environmental',
  'governance',
  'organization',
] as const;

/** 政策分类类型 */
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/** 政策分类中文标签 */
export const POLICY_CATEGORY_LABELS: Record<PolicyCategory, string> = {
  economic: '经济',
  social: '社会',
  public_service: '公共服务',
  public_safety: '公共安全',
  environmental: '环境',
  governance: '治理',
  organization: '组织',
};

/** 政策分类 Zod Schema */
export const PolicyCategorySchema = z.enum(POLICY_CATEGORIES);
