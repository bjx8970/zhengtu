/**
 * 统一效果执行器
 *
 * 纯事务 applyEffects：将一组 EffectDefinition 原子地应用到状态草稿。
 *
 * 原子性：先解析并验证全部效果目标（resolve 阶段），只有全部可执行时
 * 才进入应用阶段修改状态。任一目标无法解析（缺失政策实例、引用无法解析等）
 * 立即抛错，不留下部分修改。
 *
 * 数值语义：add=加、multiply=乘、set=直接设置。角色属性使用 clampAttr 钳位。
 * 通用效果执行器不隐式读取理念偏离状态，不自动套用行动偏离倍率。
 */

import type {
  EffectDefinition,
  InstitutionRef,
  RegionRef,
  PolicyRef,
  CharacterNumericField,
} from '../../domain/conditions';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { PlayerSave } from '../../types/player';
import { clampAttr } from '../../utils/math';

/** 效果执行上下文 */
export interface EffectExecutionContext {
  /** 触发信号快照（用于 signal 引用解析） */
  signal: DomainSignalSnapshot;
  /** 当前绝对游戏日 */
  currentDay: number;
  /** 角色属性边界表（用于 clampAttr） */
  attributeBounds: Record<string, [number, number]>;
  /** 已知机构 ID 集合（校验 fixed 机构引用，避免幽灵机构） */
  knownInstitutionIds: ReadonlySet<string>;
  /** 已知地区 ID 集合（校验 fixed 地区引用，避免幽灵地区） */
  knownRegionIds: ReadonlySet<string>;
}

/** 单条效果应用记录 */
export interface AppliedEffectRecord {
  /** 效果定义 */
  effect: EffectDefinition;
  /** 目标描述（用于日志/UI） */
  targetDescription: string;
  /** 应用前的值（不存在为 null） */
  previousValue: boolean | number | string | null;
  /** 应用后的值 */
  newValue: boolean | number | string;
}

/** 效果执行结果 */
export interface EffectExecutionResult {
  /** 已应用的效果记录 */
  applied: AppliedEffectRecord[];
}

/** 解析后的效果地址（判别联合） */
type ResolvedEffect =
  | {
      kind: 'character';
      field: CharacterNumericField;
      operation: 'add' | 'multiply' | 'set';
      value: number;
    }
  | { kind: 'specialty'; specialtyId: string; operation: 'add' | 'set'; value: number }
  | {
      kind: 'institution_metric';
      institutionId: string;
      metricId: string;
      operation: 'add' | 'set';
      value: number;
    }
  | {
      kind: 'region_metric';
      regionId: string;
      metricId: string;
      operation: 'add' | 'set';
      value: number;
    }
  | {
      kind: 'policy_metric';
      policyInstanceId: string;
      metricId: string;
      operation: 'add' | 'set';
      value: number;
    }
  | { kind: 'world_metric'; metricId: string; operation: 'add' | 'set'; value: number }
  | { kind: 'world_fact'; factId: string; value: boolean | number | string }
  | { kind: 'assessment_score'; value: number };

/**
 * 从信号载荷读取字符串字段。
 *
 * @param signal 信号快照
 * @param field 字段名
 * @returns 字段值（无法解析时抛错）
 */
function resolveSignalStringField(signal: DomainSignalSnapshot, field: string): string {
  const data = signal.data as Record<string, unknown>;
  const value = data[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Signal field "${field}" cannot be resolved to a non-empty string`);
  }
  return value;
}

/**
 * 解析机构引用为具体机构 ID。
 *
 * @param ref 机构引用
 * @param draft 状态草稿
 * @param ctx 执行上下文
 * @returns 机构 ID
 */
function resolveInstitutionRef(
  ref: InstitutionRef,
  draft: PlayerSave,
  ctx: EffectExecutionContext,
): string {
  switch (ref.source) {
    case 'current_appointment':
      return draft.career.appointment.institutionId;
    case 'signal':
      return resolveSignalStringField(ctx.signal, ref.field);
    case 'fixed':
      // 校验 fixed 机构引用存在，避免静默创建幽灵机构
      if (!ctx.knownInstitutionIds.has(ref.institutionId)) {
        throw new Error(`Unknown institution "${ref.institutionId}" in fixed institutionRef`);
      }
      return ref.institutionId;
  }
}

/**
 * 解析地区引用为具体地区 ID。
 *
 * @param ref 地区引用
 * @param draft 状态草稿
 * @param ctx 执行上下文
 * @returns 地区 ID
 */
function resolveRegionRef(ref: RegionRef, draft: PlayerSave, ctx: EffectExecutionContext): string {
  switch (ref.source) {
    case 'current_appointment':
      return draft.career.appointment.regionId;
    case 'signal':
      return resolveSignalStringField(ctx.signal, ref.field);
    case 'fixed':
      // 校验 fixed 地区引用存在，避免静默创建幽灵地区
      if (!ctx.knownRegionIds.has(ref.regionId)) {
        throw new Error(`Unknown region "${ref.regionId}" in fixed regionRef`);
      }
      return ref.regionId;
  }
}

/**
 * 解析政策引用为具体政策实例 ID（并验证实例存在）。
 *
 * @param ref 政策引用
 * @param draft 状态草稿
 * @param ctx 执行上下文
 * @returns 政策实例 ID
 */
function resolvePolicyRef(ref: PolicyRef, draft: PlayerSave, ctx: EffectExecutionContext): string {
  const instanceId =
    ref.source === 'signal'
      ? resolveSignalStringField(ctx.signal, ref.field)
      : ref.policyInstanceId;
  const exists = draft.governance.policies.some((p) => p.instanceId === instanceId);
  if (!exists) {
    throw new Error(`Policy instance "${instanceId}" not found`);
  }
  return instanceId;
}

/**
 * 解析单个效果为目标地址（resolve 阶段，不修改状态）。
 *
 * @param effect 效果定义
 * @param draft 状态草稿
 * @param ctx 执行上下文
 * @returns 解析后的效果地址
 */
function resolveEffect(
  effect: EffectDefinition,
  draft: PlayerSave,
  ctx: EffectExecutionContext,
): ResolvedEffect {
  switch (effect.target) {
    case 'character':
      return {
        kind: 'character',
        field: effect.field,
        operation: effect.operation,
        value: effect.value,
      };
    case 'career_specialty':
      return {
        kind: 'specialty',
        specialtyId: effect.specialtyId,
        operation: effect.operation,
        value: effect.value,
      };
    case 'institution_metric':
      return {
        kind: 'institution_metric',
        institutionId: resolveInstitutionRef(effect.institutionRef, draft, ctx),
        metricId: effect.metricId,
        operation: effect.operation,
        value: effect.value,
      };
    case 'region_metric':
      return {
        kind: 'region_metric',
        regionId: resolveRegionRef(effect.regionRef, draft, ctx),
        metricId: effect.metricId,
        operation: effect.operation,
        value: effect.value,
      };
    case 'policy_metric':
      return {
        kind: 'policy_metric',
        policyInstanceId: resolvePolicyRef(effect.policyRef, draft, ctx),
        metricId: effect.metricId,
        operation: effect.operation,
        value: effect.value,
      };
    case 'world_metric':
      return {
        kind: 'world_metric',
        metricId: effect.metricId,
        operation: effect.operation,
        value: effect.value,
      };
    case 'world_fact':
      return { kind: 'world_fact', factId: effect.factId, value: effect.value };
    case 'assessment_score':
      return { kind: 'assessment_score', value: effect.value };
  }
}

/**
 * 计算数值操作结果。
 *
 * @param current 当前值
 * @param operation 操作
 * @param value 操作数
 * @returns 新值
 */
function computeNumeric(
  current: number,
  operation: 'add' | 'multiply' | 'set',
  value: number,
): number {
  switch (operation) {
    case 'add':
      return current + value;
    case 'multiply':
      return current * value;
    case 'set':
      return value;
  }
}

/**
 * 应用单个已解析效果（apply 阶段）。
 *
 * @param resolved 已解析效果地址
 * @param draft 状态草稿
 * @param ctx 执行上下文
 * @returns 应用记录
 */
function applyResolvedEffect(
  resolved: ResolvedEffect,
  draft: PlayerSave,
  ctx: EffectExecutionContext,
): AppliedEffectRecord {
  switch (resolved.kind) {
    case 'character': {
      const char = draft.character as unknown as Record<string, number>;
      const prev = char[resolved.field] ?? 0;
      const next = clampAttr(
        resolved.field,
        computeNumeric(prev, resolved.operation, resolved.value),
        ctx.attributeBounds,
      );
      char[resolved.field] = next;
      return {
        effect: {
          target: 'character',
          field: resolved.field,
          operation: resolved.operation,
          value: resolved.value,
        },
        targetDescription: `character.${resolved.field}`,
        previousValue: prev,
        newValue: next,
      };
    }
    case 'specialty': {
      const prev = draft.career.specialties[resolved.specialtyId] ?? 0;
      const next = resolved.operation === 'set' ? resolved.value : prev + resolved.value;
      draft.career.specialties[resolved.specialtyId] = next;
      return {
        effect: {
          target: 'career_specialty',
          specialtyId: resolved.specialtyId,
          operation: resolved.operation,
          value: resolved.value,
        },
        targetDescription: `career_specialty.${resolved.specialtyId}`,
        previousValue: prev,
        newValue: next,
      };
    }
    case 'institution_metric': {
      const collection = (draft.governance.institutionMetrics[resolved.institutionId] ??= {});
      const prev = collection[resolved.metricId] ?? 0;
      const next = computeNumeric(prev, resolved.operation, resolved.value);
      collection[resolved.metricId] = next;
      return {
        effect: {
          target: 'institution_metric',
          institutionRef: { source: 'fixed', institutionId: resolved.institutionId },
          metricId: resolved.metricId,
          operation: resolved.operation,
          value: resolved.value,
        },
        targetDescription: `institution_metric.${resolved.institutionId}.${resolved.metricId}`,
        previousValue: prev,
        newValue: next,
      };
    }
    case 'region_metric': {
      const collection = (draft.governance.regionMetrics[resolved.regionId] ??= {});
      const prev = collection[resolved.metricId] ?? 0;
      const next = computeNumeric(prev, resolved.operation, resolved.value);
      collection[resolved.metricId] = next;
      return {
        effect: {
          target: 'region_metric',
          regionRef: { source: 'fixed', regionId: resolved.regionId },
          metricId: resolved.metricId,
          operation: resolved.operation,
          value: resolved.value,
        },
        targetDescription: `region_metric.${resolved.regionId}.${resolved.metricId}`,
        previousValue: prev,
        newValue: next,
      };
    }
    case 'policy_metric': {
      const policy = draft.governance.policies.find(
        (p) => p.instanceId === resolved.policyInstanceId,
      );
      // resolve 阶段已验证实例存在，此处防御性检查
      if (!policy) {
        throw new Error(`Policy instance "${resolved.policyInstanceId}" not found`);
      }
      const prev = policy.metrics[resolved.metricId] ?? 0;
      const next = computeNumeric(prev, resolved.operation, resolved.value);
      policy.metrics[resolved.metricId] = next;
      return {
        effect: {
          target: 'policy_metric',
          policyRef: { source: 'fixed', policyInstanceId: resolved.policyInstanceId },
          metricId: resolved.metricId,
          operation: resolved.operation,
          value: resolved.value,
        },
        targetDescription: `policy_metric.${resolved.policyInstanceId}.${resolved.metricId}`,
        previousValue: prev,
        newValue: next,
      };
    }
    case 'world_metric': {
      const prev = draft.world.metrics[resolved.metricId] ?? 0;
      const next = computeNumeric(prev, resolved.operation, resolved.value);
      draft.world.metrics[resolved.metricId] = next;
      return {
        effect: {
          target: 'world_metric',
          metricId: resolved.metricId,
          operation: resolved.operation,
          value: resolved.value,
        },
        targetDescription: `world_metric.${resolved.metricId}`,
        previousValue: prev,
        newValue: next,
      };
    }
    case 'world_fact': {
      const prev = draft.world.facts[resolved.factId] ?? null;
      draft.world.facts[resolved.factId] = resolved.value;
      return {
        effect: {
          target: 'world_fact',
          factId: resolved.factId,
          operation: 'set',
          value: resolved.value,
        },
        targetDescription: `world_fact.${resolved.factId}`,
        previousValue: prev,
        newValue: resolved.value,
      };
    }
    case 'assessment_score': {
      const prev = draft.assessments.comprehensiveScore;
      const next = prev + resolved.value;
      draft.assessments.comprehensiveScore = next;
      return {
        effect: { target: 'assessment_score', operation: 'add', value: resolved.value },
        targetDescription: 'assessment_score',
        previousValue: prev,
        newValue: next,
      };
    }
  }
}

/**
 * 原子地应用一组效果到状态草稿。
 *
 * 先解析并验证全部效果目标，任一失败立即抛错且不修改状态；
 * 全部可执行时再依次应用。
 *
 * @param draft 状态草稿（可变）
 * @param effects 效果定义列表
 * @param context 执行上下文
 * @returns 执行结果（含每条应用记录）
 */
export function applyEffects(
  draft: PlayerSave,
  effects: readonly EffectDefinition[],
  context: EffectExecutionContext,
): EffectExecutionResult {
  // 阶段一：解析并验证全部目标（失败即抛错，不修改状态）
  const resolved = effects.map((effect) => resolveEffect(effect, draft, context));

  // 阶段二：依次应用
  const applied: AppliedEffectRecord[] = [];
  for (const r of resolved) {
    applied.push(applyResolvedEffect(r, draft, context));
  }

  return { applied };
}
