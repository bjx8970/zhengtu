/**
 * 配置 Zod Schema（单一事实来源）
 *
 * ConfigLoader 和 validate-config 共同使用这些 Schema 解析和校验配置。
 * 不再在多处手工维护枚举数组和手写校验。
 */

import { z } from 'zod';
import { INSTITUTION_LEVELS, POSITION_DOMAINS, LEADERSHIP_RANKS } from '../domain/career/types';
import { ConditionExpressionSchema } from '../domain/conditions';

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
