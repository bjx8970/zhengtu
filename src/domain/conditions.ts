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

/** 信号载荷字段白名单（从 DomainSignalSnapshot 载荷派生） */
export const SIGNAL_PAYLOAD_FIELDS = [
  'actionInstanceId',
  'actionId',
  'deptId',
  'regionId',
  'institutionId',
  'policyInstanceId',
  'policyId',
  'phaseId',
  'metricId',
  'value',
  'experienceId',
  'positionId',
  'previousPositionId',
  'year',
  'score',
  'tier',
  'eventInstanceId',
  'eventId',
  'optionId',
] as const;

/** 信号字段条件：检查触发信号的某个字段（仅允许白名单字段） */
export interface SignalFieldCondition {
  signalField: (typeof SIGNAL_PAYLOAD_FIELDS)[number];
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

/** 事件历史条件（按 check 类型判别） */
export type EventHistoryCondition =
  | { eventHistory: string; check: 'occurred' | 'not_occurred' }
  | { eventHistory: string; check: 'count_gte' | 'count_lte'; value: number };

/** 政策状态条件（按 check 类型判别，status_is 复用 PolicyStatus） */
export type PolicyStateCondition =
  | { policyState: string; check: 'status_is'; value: import('./governance/types').PolicyStatus }
  | { policyState: string; check: 'phase_is'; value: string }
  | { policyState: string; check: 'metric_gte' | 'metric_lte'; value: number };

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

/** 信号字段条件 Schema（仅允许白名单字段） */
const SignalFieldConditionSchema = z
  .object({
    signalField: z.enum(SIGNAL_PAYLOAD_FIELDS),
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

/** 政策状态条件 Schema（按 check 判别，status_is 复用 PolicyStatusSchema） */
const PolicyStateConditionSchema = z.union([
  z
    .object({
      policyState: z.string().min(1),
      check: z.literal('status_is'),
      value: PolicyStatusSchema,
    })
    .strict(),
  z
    .object({
      policyState: z.string().min(1),
      check: z.literal('phase_is'),
      value: z.string().min(1),
    })
    .strict(),
  z
    .object({
      policyState: z.string().min(1),
      check: z.enum(['metric_gte', 'metric_lte']),
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

/** 效果操作类型（仅保留当前支持的操作） */
export const EFFECT_OPERATIONS = ['add', 'multiply', 'set'] as const;

/** 效果操作类型 */
export type EffectOperation = (typeof EFFECT_OPERATIONS)[number];

/**
 * 统一效果定义（按目标类别判别联合）
 *
 * 按目标类别约束允许操作、值类型和 subjectId 必填性：
 * - 角色数值目标 (character.*): add/multiply/set + number
 * - 具名数值目标 (career.specialty, governance.*Metric, world.metric): add/set + number + subjectId 必填
 * - 世界事实目标 (world.fact): set + boolean/string/number
 * - 考核分数目标 (assessment.score): add + number
 */

/** 角色数值目标 */
const CHARACTER_NUMERIC_TARGETS = [
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
] as const;

/** 具名数值目标（需要 subjectId） */
const NAMED_METRIC_TARGETS = [
  'career.specialty',
  'governance.institutionMetric',
  'governance.regionMetric',
  'governance.policyMetric',
  'world.metric',
] as const;

export type EffectDefinition =
  | {
      target: (typeof CHARACTER_NUMERIC_TARGETS)[number];
      operation: 'add' | 'multiply' | 'set';
      value: number;
      subjectId?: string;
    }
  | {
      target: (typeof NAMED_METRIC_TARGETS)[number];
      operation: 'add' | 'set';
      value: number;
      subjectId: string;
    }
  | { target: 'world.fact'; operation: 'set'; value: boolean | string | number; subjectId: string }
  | { target: 'assessment.score'; operation: 'add'; value: number; subjectId?: string };

/** 效果定义 Zod Schema（按目标类别判别，拒绝无效组合） */
export const EffectDefinitionSchema = z.union([
  // 角色数值目标：add/multiply/set + number
  z
    .object({
      target: z.enum(CHARACTER_NUMERIC_TARGETS),
      operation: z.enum(['add', 'multiply', 'set']),
      value: z.number(),
      subjectId: z.string().optional(),
    })
    .strict(),
  // 具名数值目标：add/set + number + subjectId 必填
  z
    .object({
      target: z.enum(NAMED_METRIC_TARGETS),
      operation: z.enum(['add', 'set']),
      value: z.number(),
      subjectId: z.string().min(1),
    })
    .strict(),
  // 世界事实目标：set + scalar + subjectId 必填
  z
    .object({
      target: z.literal('world.fact'),
      operation: z.literal('set'),
      value: z.union([z.boolean(), z.string(), z.number()]),
      subjectId: z.string().min(1),
    })
    .strict(),
  // 考核分数目标：add + number
  z
    .object({
      target: z.literal('assessment.score'),
      operation: z.literal('add'),
      value: z.number(),
      subjectId: z.string().optional(),
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
