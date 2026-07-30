/**
 * 配置 Zod Schema（单一事实来源）
 *
 * ConfigLoader 和 validate-config 共同使用这些 Schema 解析和校验配置。
 * 不再在多处手工维护枚举数组和手写校验。
 */

import { z } from 'zod';
import {
  CIVIL_SERVICE_RANKS,
  INSTITUTION_LEVELS,
  POSITION_DOMAINS,
  LEADERSHIP_RANKS,
  APPOINTMENT_TYPES,
  APPOINTMENT_REASONS,
} from '../domain/career/types';
import { ConditionExpressionSchema } from '../domain/conditions';
import { EffectDefinitionSchema } from '../domain/conditions';
import { DomainSignalSchema, PolicyCategorySchema } from '../domain/governance/types';

/** 机构配置 Schema */
export const InstitutionConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    level: z.enum(INSTITUTION_LEVELS),
    regionId: z.string().min(1),
  })
  .strict();

/** 职位配置 Schema（Schema 2 原生格式） */
export const PositionConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    institutionId: z.string().min(1),
    regionId: z.string().min(1),
    institutionLevel: z.enum(INSTITUTION_LEVELS),
    positionDomain: z.enum(POSITION_DOMAINS),
    leadershipRank: z.enum(LEADERSHIP_RANKS),
    contentTier: z.number().int().min(0),
    vacancyCount: z.number().int().min(0),
    requirements: z.array(ConditionExpressionSchema),
    departmentTemplateIds: z.array(z.string().min(1)),
    kpiTemplateIds: z.array(z.string().min(1)),
    annualBudget: z.number().min(0),
  })
  .strict();

/** 职位配置数组 Schema */
export const PositionConfigArraySchema = z.array(PositionConfigSchema);

/** 机构配置字典 Schema */
export const InstitutionConfigMapSchema = z.record(InstitutionConfigSchema);

/**
 * 校验职位与机构的一致性。
 *
 * @param position 职位配置
 * @param institution 对应机构配置
 * @returns 错误列表（空数组表示通过）
 */
export function validatePositionInstitutionConsistency(
  position: z.infer<typeof PositionConfigSchema>,
  institution: z.infer<typeof InstitutionConfigSchema> | undefined,
): string[] {
  const errors: string[] = [];
  if (!institution) {
    errors.push(`职位 "${position.id}" 引用的机构 "${position.institutionId}" 不存在`);
    return errors;
  }
  if (position.institutionLevel !== institution.level) {
    errors.push(
      `职位 "${position.id}" institutionLevel "${position.institutionLevel}" 与机构 "${institution.id}" level "${institution.level}" 不一致`,
    );
  }
  if (position.regionId !== institution.regionId) {
    errors.push(
      `职位 "${position.id}" regionId "${position.regionId}" 与机构 "${institution.id}" regionId "${institution.regionId}" 不一致`,
    );
  }
  return errors;
}

// ===== 政策配置 Schema =====

/** 政策阶段配置 Schema */
export const PolicyPhaseConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    durationDays: z.number().int().positive(),
    entryEffects: z.array(EffectDefinitionSchema),
    completionEffects: z.array(EffectDefinitionSchema),
  })
  .strict();

/** 政策定义配置 Schema */
export const PolicyDefinitionConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    category: PolicyCategorySchema,
    tags: z.array(z.string().min(1)).min(1),
    availabilityCondition: ConditionExpressionSchema.optional(),
    effectiveDelayDays: z.number().int().min(0),
    approvalEffects: z.array(EffectDefinitionSchema),
    phases: z.array(PolicyPhaseConfigSchema).min(1),
  })
  .strict()
  .refine(
    (data) => {
      const phaseIds = data.phases.map((p) => p.id);
      return new Set(phaseIds).size === phaseIds.length;
    },
    { message: '政策阶段 ID 必须在单项政策内唯一' },
  );

/** 政策定义数组 Schema */
export const PolicyDefinitionArraySchema = z.array(PolicyDefinitionConfigSchema);

/** 公务员职级定义。 */
export const CivilServiceRankDefinitionSchema = z
  .object({
    id: z.enum(CIVIL_SERVICE_RANKS),
    name: z.string().min(1),
    order: z.number().int().positive(),
  })
  .strict();
export const RankQuotaRequirementSchema = z
  .object({
    metricId: z.string().min(1),
    requiredValue: z.number().nonnegative(),
    consumeValue: z.number().nonnegative(),
  })
  .strict()
  .refine((quota) => quota.consumeValue <= quota.requiredValue, {
    message: 'Quota consume value cannot exceed its required value',
  });
export const CivilServiceRankProgressionRuleSchema = z
  .object({
    id: z.string().min(1),
    fromRank: z.enum(CIVIL_SERVICE_RANKS),
    toRank: z.enum(CIVIL_SERVICE_RANKS),
    minDaysInRank: z.number().int().nonnegative(),
    minServiceDays: z.number().int().nonnegative(),
    minAssessmentCount: z.number().int().nonnegative(),
    minQualifiedAssessmentCount: z.number().int().nonnegative(),
    minExcellentAssessmentCount: z.number().int().nonnegative(),
    quotaRequirement: RankQuotaRequirementSchema.nullable(),
    additionalConditions: z.array(ConditionExpressionSchema),
  })
  .strict();

function hasSignalDependentCondition(
  condition: import('../domain/conditions').ConditionExpression,
): boolean {
  if ('signalField' in condition) return true;
  if ('policyRef' in condition && condition.policyRef.source === 'signal') return true;
  if ('all' in condition) return condition.all.some(hasSignalDependentCondition);
  if ('any' in condition) return condition.any.some(hasSignalDependentCondition);
  return 'not' in condition && hasSignalDependentCondition(condition.not);
}
export const CivilServiceRankConfigSchema = z
  .object({
    definitions: z.array(CivilServiceRankDefinitionSchema),
    progressionRules: z.array(CivilServiceRankProgressionRuleSchema),
  })
  .strict()
  .superRefine((data, ctx) => {
    const ids = data.definitions.map((item) => item.id);
    if (ids.length !== CIVIL_SERVICE_RANKS.length || new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'All civil-service ranks must be defined exactly once',
      });
    if (new Set(data.definitions.map((item) => item.order)).size !== data.definitions.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Rank orders must be unique' });
    for (const definition of data.definitions) {
      const expectedOrder = CIVIL_SERVICE_RANKS.indexOf(definition.id) + 1;
      if (definition.order !== expectedOrder)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rank ${definition.id} must use canonical order ${expectedOrder}`,
        });
    }
    const ruleIds = new Set<string>();
    const sourceRanks = new Set<string>();
    for (const rule of data.progressionRules) {
      if (sourceRanks.has(rule.fromRank) || ruleIds.has(rule.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Progression rule IDs and source ranks must be unique',
        });
      sourceRanks.add(rule.fromRank);
      ruleIds.add(rule.id);
      if (
        CIVIL_SERVICE_RANKS.indexOf(rule.toRank) !==
        CIVIL_SERVICE_RANKS.indexOf(rule.fromRank) + 1
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Progression must be to the adjacent rank',
        });
      if (rule.additionalConditions.some(hasSignalDependentCondition))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Rank progression additional conditions cannot depend on an event signal',
        });
    }
    const nonHighestRanks = CIVIL_SERVICE_RANKS.slice(0, -1);
    if (
      sourceRanks.size !== nonHighestRanks.length ||
      nonHighestRanks.some((rank) => !sourceRanks.has(rank))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Every non-highest civil-service rank must have one progression rule',
      });
  });
export type CivilServiceRankDefinition = z.infer<typeof CivilServiceRankDefinitionSchema>;
export type CivilServiceRankProgressionRule = z.infer<typeof CivilServiceRankProgressionRuleSchema>;

/** 任职类职业机会定义 Schema。 */
const AppointmentCareerOpportunityDefinitionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'leadership_vacancy',
      'lateral_transfer',
      'temporary_assignment',
      'secondment',
      'demotion',
      'retirement',
    ]),
    triggerSignals: z.array(DomainSignalSchema).min(1),
    conditions: z.array(ConditionExpressionSchema),
    expiresAfterDays: z.number().int().nonnegative().nullable(),
    repeatPolicy: z.enum(['once', 'once_per_source', 'repeatable']),
    cooldownDays: z.number().int().nonnegative(),
    requiresSelection: z.boolean(),
    reasonTemplate: z.string().min(1),
    targetPositionId: z.string().min(1),
    appointmentType: z.enum(APPOINTMENT_TYPES),
    appointmentReason: z.enum(APPOINTMENT_REASONS),
  })
  .strict();

/** 培训职业机会定义 Schema。 */
const TrainingCareerOpportunityDefinitionSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('training'),
    triggerSignals: z.array(DomainSignalSchema).min(1),
    conditions: z.array(ConditionExpressionSchema),
    expiresAfterDays: z.number().int().nonnegative().nullable(),
    repeatPolicy: z.enum(['once', 'once_per_source', 'repeatable']),
    cooldownDays: z.number().int().nonnegative(),
    requiresSelection: z.boolean(),
    reasonTemplate: z.string().min(1),
    targetPositionId: z.null(),
    trainingDefinitionId: z.string().min(1),
    effects: z.array(EffectDefinitionSchema).min(1),
  })
  .strict();

/** 职业机会定义数组 Schema。 */
export const CareerOpportunityDefinitionArraySchema = z
  .array(
    z.union([
      AppointmentCareerOpportunityDefinitionSchema,
      TrainingCareerOpportunityDefinitionSchema,
    ]),
  )
  .superRefine((definitions, ctx) => {
    const ids = new Set<string>();
    for (const definition of definitions) {
      if (ids.has(definition.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate career opportunity ID: ${definition.id}`,
        });
      ids.add(definition.id);
      if (definition.type === 'leadership_vacancy' && !definition.requiresSelection)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Leadership vacancy ${definition.id} must require selection`,
        });
    }
  });
