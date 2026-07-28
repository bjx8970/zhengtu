/**
 * 政策效果引用校验
 *
 * 在配置加载阶段检查固定机构和地区引用，避免不可执行的政策效果进入运行时。
 */

import type { EffectDefinition } from '../domain/conditions';
import type { PolicyDefinitionConfig } from '../types/config';

/** 政策效果引用校验所需的已知实体 ID。 */
export interface PolicyReferenceCatalog {
  institutionIds: ReadonlySet<string>;
  regionIds: ReadonlySet<string>;
}

/**
 * 验证政策效果中的固定机构和地区引用。
 *
 * @param policies 已通过结构 Schema 校验的政策定义
 * @param catalog 可引用的机构和地区 ID
 * @returns 每个不可解析的固定引用对应的一条错误信息
 */
export function validatePolicyEffectReferences(
  policies: readonly PolicyDefinitionConfig[],
  catalog: PolicyReferenceCatalog,
): string[] {
  const errors: string[] = [];
  for (const policy of policies) {
    const effectGroups: ReadonlyArray<readonly [string, readonly EffectDefinition[]]> = [
      ['approvalEffects', policy.approvalEffects],
      ...policy.phases.flatMap((phase) => [
        [`phases.${phase.id}.entryEffects`, phase.entryEffects] as const,
        [`phases.${phase.id}.completionEffects`, phase.completionEffects] as const,
      ]),
    ];
    for (const [location, effects] of effectGroups) {
      effects.forEach((effect, index) => {
        if (
          effect.target === 'institution_metric' &&
          effect.institutionRef.source === 'fixed' &&
          !catalog.institutionIds.has(effect.institutionRef.institutionId)
        ) {
          errors.push(
            `政策 "${policy.id}" ${location}[${index}] 引用的固定机构 "${effect.institutionRef.institutionId}" 不存在`,
          );
        }
        if (
          effect.target === 'region_metric' &&
          effect.regionRef.source === 'fixed' &&
          !catalog.regionIds.has(effect.regionRef.regionId)
        ) {
          errors.push(
            `政策 "${policy.id}" ${location}[${index}] 引用的固定地区 "${effect.regionRef.regionId}" 不存在`,
          );
        }
      });
    }
  }
  return errors;
}
