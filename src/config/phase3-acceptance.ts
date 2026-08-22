/**
 * Phase 3 验收配置的严格解析与引用校验。
 *
 * 本模块只处理可枚举内容目录，不尝试求解任意条件表达式。
 */

import { z } from 'zod';
import type { EventDefinition } from '../domain/events/definition';
import type {
  CareerOpportunityDefinition,
  PersonalTaskTemplate,
  PolicyDefinitionConfig,
} from '../types/config';
import type { PositionConfigV2 } from '../types/position-v2';
import type { Phase3AcceptanceConfig } from '../types/phase3';
import acceptanceData from './phase3/acceptance.json' with { type: 'json' };

const DayRangeSchema = z
  .object({ minDay: z.number().int().nonnegative(), maxDay: z.number().int().nonnegative() })
  .strict()
  .refine((range) => range.maxDay >= range.minDay, {
    message: 'Milestone maxDay cannot be earlier than minDay',
  });

const EntrypointSchema = z
  .object({
    role: z.enum(['producer', 'consumer']),
    kind: z.enum([
      'personal_task',
      'career_opportunity',
      'event',
      'policy',
      'rank_progression',
      'timeline_node',
    ]),
    contentId: z.string().min(1),
    purpose: z.string().min(1),
  })
  .strict();

const KpiProducerRequirementSchema = z
  .object({
    positionId: z.string().min(1),
    kpiId: z.string().min(1),
    personalTaskIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

/** Phase 3 验收配置的严格 Schema。 */
export const Phase3AcceptanceConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    phaseId: z.literal('phase3_township_vertical_slice'),
    saveSchemaVersion: z.literal(10),
    targetContentVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
    stagePositionIds: z
      .object({
        clerk: z.string().min(1),
        townshipDeputy: z.string().min(1),
        townshipChief: z.string().min(1),
      })
      .strict(),
    milestones: z
      .object({
        probationPassed: DayRangeSchema,
        firstRankPromotion: DayRangeSchema,
        townshipDeputyAppointment: DayRangeSchema,
        sectionMember4Promotion: DayRangeSchema,
        townshipChiefOpportunity: DayRangeSchema,
      })
      .strict(),
    entrypoints: z.array(EntrypointSchema).min(1),
    requiredKpiProducers: z.array(KpiProducerRequirementSchema).min(1),
  })
  .strict()
  .superRefine((config, ctx) => {
    const entrypointKeys = config.entrypoints.map(
      (entrypoint) => `${entrypoint.role}:${entrypoint.kind}:${entrypoint.contentId}`,
    );
    if (new Set(entrypointKeys).size !== entrypointKeys.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phase 3 entrypoints must be unique' });
    const requirementKeys = config.requiredKpiProducers.map(
      (requirement) => `${requirement.positionId}:${requirement.kpiId}`,
    );
    if (new Set(requirementKeys).size !== requirementKeys.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Phase 3 KPI producer requirements must be unique',
      });
  });

/** 经过严格 Schema 解析的 Phase 3 验收配置。 */
export const PHASE3_ACCEPTANCE_CONFIG = Phase3AcceptanceConfigSchema.parse(
  acceptanceData,
) as Phase3AcceptanceConfig;

/** Phase 3 引用验证所需的可枚举内容目录。 */
export interface Phase3ReferenceCatalog {
  positions: readonly PositionConfigV2[];
  personalTasks: readonly PersonalTaskTemplate[];
  careerOpportunities: readonly CareerOpportunityDefinition[];
  events: readonly EventDefinition[];
  policies: readonly PolicyDefinitionConfig[];
  rankProgressionRuleIds: readonly string[];
}

const TIMELINE_NODE_IDS = new Set([
  'probation_evaluation',
  'career_opportunity_expiry',
  'scheduled_event_activation',
  'event_deadline',
  'monthly_settlement',
  'annual_assessment',
  'political_cycle',
  'retirement_check',
]);

/**
 * 校验 Phase 3 正式内容入口与 KPI producer 引用。
 *
 * @param config Phase 3 验收配置
 * @param catalog 当前正式内容目录
 * @returns 引用或 producer 缺失错误；空数组表示通过
 */
export function validatePhase3AcceptanceReferences(
  config: Phase3AcceptanceConfig,
  catalog: Phase3ReferenceCatalog,
): string[] {
  const errors: string[] = [];
  const positions = new Map(catalog.positions.map((item) => [item.id, item]));
  const tasks = new Map(catalog.personalTasks.map((item) => [item.id, item]));
  const idsByKind = {
    personal_task: new Set(tasks.keys()),
    career_opportunity: new Set(catalog.careerOpportunities.map((item) => item.id)),
    event: new Set(catalog.events.map((item) => item.id)),
    policy: new Set(catalog.policies.map((item) => item.id)),
    rank_progression: new Set(catalog.rankProgressionRuleIds),
    timeline_node: TIMELINE_NODE_IDS,
  };

  for (const [stage, positionId] of Object.entries(config.stagePositionIds))
    if (!positions.has(positionId))
      errors.push(`Phase 3 stage ${stage} references unknown position ${positionId}`);

  for (const entrypoint of config.entrypoints)
    if (!idsByKind[entrypoint.kind].has(entrypoint.contentId))
      errors.push(
        `Phase 3 ${entrypoint.role} entrypoint references unknown ${entrypoint.kind} ${entrypoint.contentId}`,
      );

  for (const requirement of config.requiredKpiProducers) {
    const position = positions.get(requirement.positionId);
    if (!position) {
      errors.push(`Phase 3 KPI producer references unknown position ${requirement.positionId}`);
      continue;
    }
    if (!position.kpiTemplateIds.includes(requirement.kpiId))
      errors.push(
        `Phase 3 KPI ${requirement.kpiId} is not assigned to position ${requirement.positionId}`,
      );
    for (const taskId of requirement.personalTaskIds) {
      const task = tasks.get(taskId);
      if (!task) {
        errors.push(`Phase 3 KPI ${requirement.kpiId} references unknown personal task ${taskId}`);
        continue;
      }
      const allowedRanks = task.prerequisites?.allowedLeadershipRanks;
      if (allowedRanks && !allowedRanks.includes('none'))
        errors.push(`Phase 3 KPI producer ${taskId} cannot be performed without a leadership rank`);
      if (!task.kpiEffects?.some((effect) => effect.indicatorId === requirement.kpiId))
        errors.push(`Phase 3 KPI producer ${taskId} does not produce ${requirement.kpiId}`);
    }
  }
  return errors;
}
