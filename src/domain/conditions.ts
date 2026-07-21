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

/** 职业条件：检查当前任职状态 */
export interface CareerCondition {
  careerCheck:
    | 'institution_level'
    | 'position_domain'
    | 'leadership_rank'
    | 'civil_service_rank'
    | 'years_in_position'
    | 'has_experience';
  value: string | number;
  op?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
}

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

// ===== 条件表达式 Zod Schema =====

/** 信号字段条件 Schema */
const SignalFieldConditionSchema = z.object({
  signalField: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
  value: z.union([z.number(), z.string(), z.boolean()]),
});

/** 职业条件 Schema */
const CareerConditionSchema = z.object({
  careerCheck: z.enum([
    'institution_level',
    'position_domain',
    'leadership_rank',
    'civil_service_rank',
    'years_in_position',
    'has_experience',
  ]),
  value: z.union([z.string(), z.number()]),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']).optional(),
});

/** 世界指标条件 Schema */
const WorldMetricConditionSchema = z.object({
  worldMetric: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
  value: z.number(),
});

/** 事件历史条件 Schema */
const EventHistoryConditionSchema = z.object({
  eventHistory: z.string(),
  check: z.enum(['occurred', 'not_occurred', 'count_gte', 'count_lte']),
  value: z.number().optional(),
});

/** 政策状态条件 Schema */
const PolicyStateConditionSchema = z.object({
  policyState: z.string(),
  check: z.enum(['status_is', 'phase_is', 'metric_gte', 'metric_lte']),
  value: z.union([z.string(), z.number()]),
});

/** 履历条件 Schema */
const ExperienceConditionSchema = z.object({
  experience: z.enum(['region_count', 'domain_count', 'level_count', 'has_institution']),
  op: z.enum(['gte', 'lte', 'eq']),
  value: z.union([z.number(), z.string()]),
});

/** 世界事实条件 Schema */
const FactConditionSchema = z.object({
  fact: z.string(),
  op: z.enum(['is_true', 'is_false', 'eq', 'neq']),
  value: z.union([z.boolean(), z.number(), z.string()]).optional(),
});

/** 条件表达式 Zod Schema（递归） */
export const ConditionExpressionSchema: z.ZodType<ConditionExpression> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionExpressionSchema) }),
    z.object({ any: z.array(ConditionExpressionSchema) }),
    z.object({ not: ConditionExpressionSchema }),
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
 * 统一效果定义
 *
 * 行动、政策、事件和职业机会复用同一效果执行器。
 * 效果目标由代码白名单控制，配置不能绕过状态机或删除存档字段。
 */
export interface EffectDefinition {
  target: EffectTarget;
  operation: EffectOperation;
  value: number | string | boolean;
  /** 可选：效果作用的具体对象 ID（如指标名、专长名） */
  subjectId?: string;
}

/** 效果定义 Zod Schema */
export const EffectDefinitionSchema = z.object({
  target: EffectTargetSchema,
  operation: z.enum(EFFECT_OPERATIONS),
  value: z.union([z.number(), z.string(), z.boolean()]),
  subjectId: z.string().optional(),
});

// 重新导出领域类型供条件 Schema 使用
export {
  InstitutionLevelSchema,
  PositionDomainSchema,
  LeadershipRankSchema,
  CivilServiceRankSchema,
  PolicyStatusSchema,
};
