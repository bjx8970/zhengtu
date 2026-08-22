/**
 * 行动效果显示格式化工具
 *
 * 将 ActionEffectDef 中的英文 target key 转为中文显示名，
 * 并根据操作类型格式化数值前缀（+/-/×/=）。
 * 同时为个人任务的统一效果定义（EffectDefinition）与 KPI 台账贡献提供格式化。
 */

import { ATTR_LABELS } from './theme';
import { getConfigLoader } from '../config/loader';
import type { ActionEffectDef, PersonalTaskKpiEffect } from '../types/config';
import type { EffectDefinition } from '../domain/conditions';

const KPI_PREFIX = 'dept.kpi.';
const PLAYER_PREFIX = 'player.';

/** 数值操作的中缀格式（+/-/×/=） */
function formatOperationSuffix(operation: 'add' | 'multiply' | 'set', value: number): string {
  if (operation === 'multiply') return `×${value}`;
  if (operation === 'set') return `=${value}`;
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * 将 ActionEffectDef 格式化为中文显示字符串。
 *
 * @param eff - 行动效果定义
 * @returns 中文显示字符串，如 "办公效率+5"、"能力+1"
 */
export function formatEffectLabel(eff: ActionEffectDef): string {
  let label: string;

  if (eff.target.startsWith(KPI_PREFIX)) {
    const kpiId = eff.target.slice(KPI_PREFIX.length);
    const tpl = getConfigLoader().getKpiTemplate(kpiId);
    label = tpl?.name ?? kpiId;
  } else if (eff.target.startsWith(PLAYER_PREFIX)) {
    const attrKey = eff.target.slice(PLAYER_PREFIX.length);
    label = ATTR_LABELS[attrKey] ?? attrKey;
  } else {
    label = eff.target;
  }

  return `${label}${formatOperationSuffix(eff.operation, eff.value)}`;
}

/**
 * 将统一效果定义（EffectDefinition）格式化为中文显示字符串。
 *
 * @param eff - 统一效果定义（个人任务完成效果使用）
 * @returns 中文显示字符串，如 "能力+2"、"考核分+1"、"记录事实"
 */
export function formatEffectDefinitionLabel(eff: EffectDefinition): string {
  switch (eff.target) {
    case 'character':
      return `${ATTR_LABELS[eff.field] ?? eff.field}${formatOperationSuffix(eff.operation, eff.value)}`;
    case 'assessment_score':
      return `考核分${formatOperationSuffix('add', eff.value)}`;
    case 'career_specialty':
      return `专长(${eff.specialtyId})${formatOperationSuffix(eff.operation, eff.value)}`;
    case 'world_fact':
      return `记录「${eff.factId}」`;
    case 'world_metric':
      return `${eff.metricId}${formatOperationSuffix(eff.operation, eff.value)}`;
    case 'institution_metric':
      return `机构指标 ${eff.metricId}${formatOperationSuffix(eff.operation, eff.value)}`;
    case 'region_metric':
      return `地区指标 ${eff.metricId}${formatOperationSuffix(eff.operation, eff.value)}`;
    case 'policy_metric':
      return `政策指标 ${eff.metricId}${formatOperationSuffix(eff.operation, eff.value)}`;
    default: {
      // 穷举检查：新增效果目标时在此编译期报错
      const _exhaustive: never = eff;
      return JSON.stringify(_exhaustive);
    }
  }
}

/**
 * 将个人任务 KPI 台账贡献格式化为中文显示字符串。
 *
 * @param eff - KPI 台账贡献定义
 * @returns 中文显示字符串，如 "办公效率+6"
 */
export function formatKpiEffectLabel(eff: PersonalTaskKpiEffect): string {
  const tpl = getConfigLoader().getKpiTemplate(eff.indicatorId);
  const label = tpl?.name ?? eff.indicatorId;
  return `${label}${formatOperationSuffix(eff.operation, eff.value)}`;
}
