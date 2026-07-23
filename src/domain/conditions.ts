/**
 * 统一条件表达式与效果定义
 *
 * 行动、政策、事件和职业机会复用同一条件/效果模型。
 * 配置不得执行任意 JavaScript，效果目标由代码白名单控制。
 */

import { z } from 'zod';
import {
  InstitutionLevelSchema,
  PositionDomainSchema,
  LeadershipRankSchema,
  CivilServiceRankSchema,
} from './career/types';
import { PolicyStatusSchema } from './governance/types';

// ===== 条件表达式 =====

/** 信号载荷字段分类（从 DomainSignalSnapshot 载荷派生，避免手工双份维护） */

/** 字符串 ID 字段（仅允许 eq/neq + string） */
export const SIGNAL_STRING_FIELDS = [
  'actionInstanceId',
  'actionId',
  'deptId',
  'regionId',
  'institutionId',
  'policyInstanceId',
  'policyId',
  'phaseId',
  'metricId',
  'experienceId',
  'positionId',
  'eventInstanceId',
  'eventId',
  'tier',
] as const;

/** 数值字段（允许数值比较 + number） */
export const SIGNAL_NUMERIC_FIELDS = ['value', 'year', 'score'] as const;

/** 可空字符串字段（允许 eq/neq + string|null，可表达 null 语义） */
export const SIGNAL_NULLABLE_FIELDS = ['previousPositionId', 'optionId'] as const;

/** 信号字段条件：按字段类别判别联合，约束操作符和值类型 */
export type SignalFieldCondition =
  | { signalField: (typeof SIGNAL_STRING_FIELDS)[number]; op: 'eq' | 'neq'; value: string }
  | {
      signalField: (typeof SIGNAL_NUMERIC_FIELDS)[number];
      op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      value: number;
    }
  | {
      signalField: (typeof SIGNAL_NULLABLE_FIELDS)[number];
      op: 'eq' | 'neq';
      value: string | null;
    };

/** 职业条件：按检查类型判别联合，复用领域枚举约束值类型 */
export type CareerCondition =
  | {
      careerCheck: 'institution_level';
      value: import('./career/types').InstitutionLevel;
      op?: 'eq' | 'neq';
    }
  | {
      careerCheck: 'position_domain';
      value: import('./career/types').PositionDomain;
      op?: 'eq' | 'neq';
    }
  | {
      careerCheck: 'leadership_rank';
      value: import('./career/types').LeadershipRank;
      op?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
    }
  | {
      careerCheck: 'civil_service_rank';
      value: import('./career/types').CivilServiceRank;
      op?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
    }
  | { careerCheck: 'years_in_position'; value: number; op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' }
  | { careerCheck: 'has_experience'; value: string; op?: 'eq' };

/** 世界指标条件 */
export interface WorldMetricCondition {
  worldMetric: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: number;
}

/** 事件历史条件（按 check 类型判别） */
export type EventHistoryCondition =
  | { eventHistory: string; check: 'occurred' | 'not_occurred' }
  | { eventHistory: string; check: 'count_gte' | 'count_lte'; value: number };

/**
 * 政策实例引用（条件用，隔离具体政策实例）。
 *
 * - signal：使用触发信号的 policyInstanceId（隔离触发实例）
 * - fixed：指定政策实例 ID
 * 不再使用 policyId 模糊匹配首个实例。
 */
export type PolicyConditionRef =
  { source: 'signal' } | { source: 'fixed'; policyInstanceId: string };

/** 政策状态条件（按 check 类型判别，status_is 复用 PolicyStatus，policyRef 隔离实例） */
export type PolicyStateCondition =
  | {
      policyRef: PolicyConditionRef;
      check: 'status_is';
      value: import('./governance/types').PolicyStatus;
    }
  | { policyRef: PolicyConditionRef; check: 'phase_is'; value: string }
  | {
      policyRef: PolicyConditionRef;
      check: 'metric_gte' | 'metric_lte';
      metricId: string;
      value: number;
    };

/** 履历条件（按 experience 类型判别） */
export type ExperienceCondition =
  | {
      experience: 'region_count' | 'domain_count' | 'level_count';
      op: 'gte' | 'lte' | 'eq';
      value: number;
    }
  | { experience: 'has_institution'; op: 'eq'; value: string };

/** 世界事实条件（按 op 类型判别） */
export type FactCondition =
  | { fact: string; op: 'is_true' | 'is_false' }
  | { fact: string; op: 'eq' | 'neq'; value: boolean | number | string };

/**
 * 条件表达式（有限联合类型）
 *
 * 支持逻辑组合（all/any/not）和具体领域条件。
 * 配置不得嵌入 JavaScript、任意公式字符串或任意属性路径。
 */
export type ConditionExpression =
  | { all: ConditionExpression[] }
  | { any: ConditionExpression[] }
  | { not: ConditionExpression }
  | SignalFieldCondition
  | CareerCondition
  | WorldMetricCondition
  | EventHistoryCondition
  | PolicyStateCondition
  | ExperienceCondition
  | FactCondition;

// ===== 条件表达式 Zod Schema（所有分支 .strict() 拒绝未知字段） =====

/** 信号字段条件 Schema（按字段类别判别，约束操作符和值类型） */
const SignalFieldConditionSchema = z.union([
  // 字符串 ID 字段：仅 eq/neq + string
  z
    .object({
      signalField: z.enum(SIGNAL_STRING_FIELDS),
      op: z.enum(['eq', 'neq']),
      value: z.string(),
    })
    .strict(),
  // 数值字段：数值比较 + number
  z
    .object({
      signalField: z.enum(SIGNAL_NUMERIC_FIELDS),
      op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
      value: z.number(),
    })
    .strict(),
  // 可空字符串字段：eq/neq + string|null（可表达 null 语义）
  z
    .object({
      signalField: z.enum(SIGNAL_NULLABLE_FIELDS),
      op: z.enum(['eq', 'neq']),
      value: z.union([z.string(), z.null()]),
    })
    .strict(),
]);

/** 职业条件 Schema（按检查类型判别联合，复用领域枚举） */
const CareerConditionSchema = z.union([
  z
    .object({
      careerCheck: z.literal('institution_level'),
      value: InstitutionLevelSchema,
      op: z.enum(['eq', 'neq']).optional(),
    })
    .strict(),
  z
    .object({
      careerCheck: z.literal('position_domain'),
      value: PositionDomainSchema,
      op: z.enum(['eq', 'neq']).optional(),
    })
    .strict(),
  z
    .object({
      careerCheck: z.literal('leadership_rank'),
      value: LeadershipRankSchema,
      op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']).optional(),
    })
    .strict(),
  z
    .object({
      careerCheck: z.literal('civil_service_rank'),
      value: CivilServiceRankSchema,
      op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']).optional(),
    })
    .strict(),
  z
    .object({
      careerCheck: z.literal('years_in_position'),
      value: z.number(),
      op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
    })
    .strict(),
  z
    .object({
      careerCheck: z.literal('has_experience'),
      value: z.string().min(1),
      op: z.literal('eq').optional(),
    })
    .strict(),
]);

/** 世界指标条件 Schema */
const WorldMetricConditionSchema = z
  .object({
    worldMetric: z.string().min(1),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
    value: z.number(),
  })
  .strict();

/** 事件历史条件 Schema（按 check 判别） */
const EventHistoryConditionSchema = z.union([
  z
    .object({
      eventHistory: z.string().min(1),
      check: z.enum(['occurred', 'not_occurred']),
    })
    .strict(),
  z
    .object({
      eventHistory: z.string().min(1),
      check: z.enum(['count_gte', 'count_lte']),
      value: z.number(),
    })
    .strict(),
]);

/** 政策实例引用 Schema（条件用） */
const PolicyConditionRefSchema = z.union([
  z.object({ source: z.literal('signal') }).strict(),
  z.object({ source: z.literal('fixed'), policyInstanceId: z.string().min(1) }).strict(),
]);

/** 政策状态条件 Schema（按 check 判别，status_is 复用 PolicyStatusSchema，policyRef 隔离实例） */
const PolicyStateConditionSchema = z.union([
  z
    .object({
      policyRef: PolicyConditionRefSchema,
      check: z.literal('status_is'),
      value: PolicyStatusSchema,
    })
    .strict(),
  z
    .object({
      policyRef: PolicyConditionRefSchema,
      check: z.literal('phase_is'),
      value: z.string().min(1),
    })
    .strict(),
  z
    .object({
      policyRef: PolicyConditionRefSchema,
      check: z.enum(['metric_gte', 'metric_lte']),
      metricId: z.string().min(1),
      value: z.number(),
    })
    .strict(),
]);

/** 履历条件 Schema（按 experience 判别） */
const ExperienceConditionSchema = z.union([
  z
    .object({
      experience: z.enum(['region_count', 'domain_count', 'level_count']),
      op: z.enum(['gte', 'lte', 'eq']),
      value: z.number(),
    })
    .strict(),
  z
    .object({
      experience: z.literal('has_institution'),
      op: z.literal('eq'),
      value: z.string().min(1),
    })
    .strict(),
]);

/** 世界事实条件 Schema（按 op 判别） */
const FactConditionSchema = z.union([
  z
    .object({
      fact: z.string().min(1),
      op: z.enum(['is_true', 'is_false']),
    })
    .strict(),
  z
    .object({
      fact: z.string().min(1),
      op: z.enum(['eq', 'neq']),
      value: z.union([z.boolean(), z.number(), z.string()]),
    })
    .strict(),
]);

/** 条件表达式 Zod Schema（递归，所有分支 .strict()） */
export const ConditionExpressionSchema: z.ZodType<ConditionExpression> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionExpressionSchema) }).strict(),
    z.object({ any: z.array(ConditionExpressionSchema) }).strict(),
    z.object({ not: ConditionExpressionSchema }).strict(),
    SignalFieldConditionSchema,
    CareerConditionSchema,
    WorldMetricConditionSchema,
    EventHistoryConditionSchema,
    PolicyStateConditionSchema,
    ExperienceConditionSchema,
    FactConditionSchema,
  ]),
);

// ===== 效果定义（按目标判别联合，显式地址） =====

/** 角色数值属性字段（不含 target 前缀） */
export const CHARACTER_NUMERIC_FIELDS = [
  'vigor',
  'ambition',
  'integrity',
  'stability',
  'performance',
  'charisma',
  'competence',
  'network',
  'diligence',
  'corruptionRisk',
] as const;

/** 角色数值属性字段类型 */
export type CharacterNumericField = (typeof CHARACTER_NUMERIC_FIELDS)[number];

/** 效果目标判别符（用于完整性校验） */
export const EFFECT_TARGET_DISCRIMINANTS = [
  'character',
  'career_specialty',
  'institution_metric',
  'region_metric',
  'policy_metric',
  'world_metric',
  'world_fact',
  'assessment_score',
] as const;

/** 效果目标判别符类型 */
export type EffectTargetDiscriminant = (typeof EFFECT_TARGET_DISCRIMINANTS)[number];

/**
 * 机构引用（判别联合）。
 * - current_appointment：从当前任职解析机构 ID
 * - signal：从触发信号的 institutionId 字段解析
 * - fixed：固定机构 ID
 */
export type InstitutionRef =
  | { source: 'current_appointment' }
  | { source: 'signal'; field: 'institutionId' }
  | { source: 'fixed'; institutionId: string };

/**
 * 地区引用（判别联合）。
 * - current_appointment：从当前任职解析地区 ID
 * - signal：从触发信号的 regionId 字段解析
 * - fixed：固定地区 ID
 */
export type RegionRef =
  | { source: 'current_appointment' }
  | { source: 'signal'; field: 'regionId' }
  | { source: 'fixed'; regionId: string };

/**
 * 政策引用（判别联合）。
 * - signal：从触发信号的 policyInstanceId 字段解析
 * - fixed：固定政策实例 ID
 */
export type PolicyRef =
  { source: 'signal'; field: 'policyInstanceId' } | { source: 'fixed'; policyInstanceId: string };

/** 角色属性效果 */
export interface CharacterEffect {
  target: 'character';
  field: CharacterNumericField;
  operation: 'add' | 'multiply' | 'set';
  value: number;
}

/** 职业专长效果 */
export interface CareerSpecialtyEffect {
  target: 'career_specialty';
  specialtyId: string;
  operation: 'add' | 'set';
  value: number;
}

/** 机构指标效果 */
export interface InstitutionMetricEffect {
  target: 'institution_metric';
  institutionRef: InstitutionRef;
  metricId: string;
  operation: 'add' | 'set';
  value: number;
}

/** 地区指标效果 */
export interface RegionMetricEffect {
  target: 'region_metric';
  regionRef: RegionRef;
  metricId: string;
  operation: 'add' | 'set';
  value: number;
}

/** 政策指标效果 */
export interface PolicyMetricEffect {
  target: 'policy_metric';
  policyRef: PolicyRef;
  metricId: string;
  operation: 'add' | 'set';
  value: number;
}

/** 世界指标效果 */
export interface WorldMetricEffect {
  target: 'world_metric';
  metricId: string;
  operation: 'add' | 'set';
  value: number;
}

/** 世界事实效果 */
export interface WorldFactEffect {
  target: 'world_fact';
  factId: string;
  operation: 'set';
  value: boolean | number | string;
}

/** 考核分数效果 */
export interface AssessmentScoreEffect {
  target: 'assessment_score';
  operation: 'add';
  value: number;
}

/**
 * 统一效果定义（按目标判别联合）。
 *
 * 每种效果地址语义唯一、必填字段明确、无法构造不可执行效果。
 * 运行时不解析拼接路径字符串，引用通过判别联合明确来源。
 */
export type EffectDefinition =
  | CharacterEffect
  | CareerSpecialtyEffect
  | InstitutionMetricEffect
  | RegionMetricEffect
  | PolicyMetricEffect
  | WorldMetricEffect
  | WorldFactEffect
  | AssessmentScoreEffect;

// ===== 效果定义 Zod Schema（按目标判别，所有分支 .strict()） =====

/** 机构引用 Schema */
const InstitutionRefSchema = z.union([
  z.object({ source: z.literal('current_appointment') }).strict(),
  z.object({ source: z.literal('signal'), field: z.literal('institutionId') }).strict(),
  z.object({ source: z.literal('fixed'), institutionId: z.string().min(1) }).strict(),
]);

/** 地区引用 Schema */
const RegionRefSchema = z.union([
  z.object({ source: z.literal('current_appointment') }).strict(),
  z.object({ source: z.literal('signal'), field: z.literal('regionId') }).strict(),
  z.object({ source: z.literal('fixed'), regionId: z.string().min(1) }).strict(),
]);

/** 政策引用 Schema */
const PolicyRefSchema = z.union([
  z.object({ source: z.literal('signal'), field: z.literal('policyInstanceId') }).strict(),
  z.object({ source: z.literal('fixed'), policyInstanceId: z.string().min(1) }).strict(),
]);

/** 效果定义 Zod Schema（按 target 判别联合） */
export const EffectDefinitionSchema = z.union([
  // 角色属性：add/multiply/set + number
  z
    .object({
      target: z.literal('character'),
      field: z.enum(CHARACTER_NUMERIC_FIELDS),
      operation: z.enum(['add', 'multiply', 'set']),
      value: z.number(),
    })
    .strict(),
  // 职业专长：add/set + number
  z
    .object({
      target: z.literal('career_specialty'),
      specialtyId: z.string().min(1),
      operation: z.enum(['add', 'set']),
      value: z.number(),
    })
    .strict(),
  // 机构指标：add/set + number + institutionRef
  z
    .object({
      target: z.literal('institution_metric'),
      institutionRef: InstitutionRefSchema,
      metricId: z.string().min(1),
      operation: z.enum(['add', 'set']),
      value: z.number(),
    })
    .strict(),
  // 地区指标：add/set + number + regionRef
  z
    .object({
      target: z.literal('region_metric'),
      regionRef: RegionRefSchema,
      metricId: z.string().min(1),
      operation: z.enum(['add', 'set']),
      value: z.number(),
    })
    .strict(),
  // 政策指标：add/set + number + policyRef
  z
    .object({
      target: z.literal('policy_metric'),
      policyRef: PolicyRefSchema,
      metricId: z.string().min(1),
      operation: z.enum(['add', 'set']),
      value: z.number(),
    })
    .strict(),
  // 世界指标：add/set + number
  z
    .object({
      target: z.literal('world_metric'),
      metricId: z.string().min(1),
      operation: z.enum(['add', 'set']),
      value: z.number(),
    })
    .strict(),
  // 世界事实：set + scalar
  z
    .object({
      target: z.literal('world_fact'),
      factId: z.string().min(1),
      operation: z.literal('set'),
      value: z.union([z.boolean(), z.number(), z.string()]),
    })
    .strict(),
  // 考核分数：add + number
  z
    .object({
      target: z.literal('assessment_score'),
      operation: z.literal('add'),
      value: z.number(),
    })
    .strict(),
]);

// 重新导出领域类型供条件 Schema 使用
export {
  InstitutionLevelSchema,
  PositionDomainSchema,
  LeadershipRankSchema,
  CivilServiceRankSchema,
  PolicyStatusSchema,
};
