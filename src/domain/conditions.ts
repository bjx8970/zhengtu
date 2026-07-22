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

/** 信号字段条件：检查触发信号的某个字段 */
export interface SignalFieldCondition {
  signalField: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: number | string | boolean;
}

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

/** 事件历史条件 */
export interface EventHistoryCondition {
  eventHistory: string;
  check: 'occurred' | 'not_occurred' | 'count_gte' | 'count_lte';
  value?: number;
}

/** 政策状态条件 */
export interface PolicyStateCondition {
  policyState: string;
  check: 'status_is' | 'phase_is' | 'metric_gte' | 'metric_lte';
  value: string | number;
}

/** 履历条件：检查职业经历 */
export interface ExperienceCondition {
  experience: 'region_count' | 'domain_count' | 'level_count' | 'has_institution';
  op: 'gte' | 'lte' | 'eq';
  value: number | string;
}

/** 世界事实条件 */
export interface FactCondition {
  fact: string;
  op: 'is_true' | 'is_false' | 'eq' | 'neq';
  value?: boolean | number | string;
}

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

/** 信号字段条件 Schema */
const SignalFieldConditionSchema = z
  .object({
    signalField: z.string().min(1),
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
    value: z.union([z.number(), z.string(), z.boolean()]),
  })
  .strict();

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

/** 事件历史条件 Schema */
const EventHistoryConditionSchema = z
  .object({
    eventHistory: z.string().min(1),
    check: z.enum(['occurred', 'not_occurred', 'count_gte', 'count_lte']),
    value: z.number().optional(),
  })
  .strict();

/** 政策状态条件 Schema */
const PolicyStateConditionSchema = z
  .object({
    policyState: z.string().min(1),
    check: z.enum(['status_is', 'phase_is', 'metric_gte', 'metric_lte']),
    value: z.union([z.string(), z.number()]),
  })
  .strict();

/** 履历条件 Schema */
const ExperienceConditionSchema = z
  .object({
    experience: z.enum(['region_count', 'domain_count', 'level_count', 'has_institution']),
    op: z.enum(['gte', 'lte', 'eq']),
    value: z.union([z.number(), z.string()]),
  })
  .strict();

/** 世界事实条件 Schema */
const FactConditionSchema = z
  .object({
    fact: z.string().min(1),
    op: z.enum(['is_true', 'is_false', 'eq', 'neq']),
    value: z.union([z.boolean(), z.number(), z.string()]).optional(),
  })
  .strict();

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

// ===== 效果定义 =====

/** 效果目标白名单（由代码控制，配置不能绕过） */
export const EFFECT_TARGETS = [
  'character.vigor',
  'character.ambition',
  'character.integrity',
  'character.stability',
  'character.performance',
  'character.charisma',
  'character.competence',
  'character.network',
  'character.diligence',
  'character.corruptionRisk',
  'career.specialty',
  'governance.institutionMetric',
  'governance.regionMetric',
  'governance.policyMetric',
  'world.fact',
  'world.metric',
  'assessment.score',
] as const;

/** 效果目标类型 */
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

/** 效果目标 Zod Schema */
export const EffectTargetSchema = z.enum(EFFECT_TARGETS);

/** 效果操作类型 */
export const EFFECT_OPERATIONS = ['add', 'multiply', 'set', 'append', 'remove'] as const;

/** 效果操作类型 */
export type EffectOperation = (typeof EFFECT_OPERATIONS)[number];

/**
 * 统一效果定义（判别联合）
 *
 * 按操作类型区分：
 * - 数值效果（add/multiply）：value 必须为 number
 * - 设置效果（set）：value 可为 number/string/boolean
 * - 集合效果（append/remove）：value 必须为 string，需要 subjectId
 */
export type EffectDefinition =
  | { target: EffectTarget; operation: 'add' | 'multiply'; value: number; subjectId?: string }
  | { target: EffectTarget; operation: 'set'; value: number | string | boolean; subjectId?: string }
  | { target: EffectTarget; operation: 'append' | 'remove'; value: string; subjectId: string };

/** 效果定义 Zod Schema（判别联合，拒绝无效组合） */
export const EffectDefinitionSchema = z.union([
  // 数值效果：add/multiply + number
  z
    .object({
      target: EffectTargetSchema,
      operation: z.enum(['add', 'multiply']),
      value: z.number(),
      subjectId: z.string().optional(),
    })
    .strict(),
  // 设置效果：set + any scalar
  z
    .object({
      target: EffectTargetSchema,
      operation: z.literal('set'),
      value: z.union([z.number(), z.string(), z.boolean()]),
      subjectId: z.string().optional(),
    })
    .strict(),
  // 集合效果：append/remove + string + 必须 subjectId
  z
    .object({
      target: EffectTargetSchema,
      operation: z.enum(['append', 'remove']),
      value: z.string(),
      subjectId: z.string().min(1),
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
