/**
 * 行动效果显示格式化工具
 *
 * 将 ActionEffectDef 中的英文 target key 转为中文显示名，
 * 并根据操作类型格式化数值前缀（+/-/×/=）。
 */

import { ATTR_LABELS } from './theme';
import { getConfigLoader } from '../config/loader';
import type { ActionEffectDef } from '../types/config';

const KPI_PREFIX = 'dept.kpi.';
const PLAYER_PREFIX = 'player.';

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

  const val = eff.value;
  const suffix =
    eff.operation === 'multiply'
      ? `×${val}`
      : eff.operation === 'set'
        ? `=${val}`
        : val >= 0
          ? `+${val}`
          : `${val}`;

  return `${label}${suffix}`;
}
