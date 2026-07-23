/**
 * 统一条件解释器
 *
 * 纯函数 evaluateCondition：在给定上下文下评估 ConditionExpression。
 * 支持逻辑组合、信号字段、职业状态、世界指标、事件历史、政策状态、履历、世界事实。
 *
 * 设计要点：
 * - 领导职务/职级比较使用领域排序（数组序数），不使用字符串字典序；
 * - 世界指标缺失时统一默认为 0；
 * - 信号字段缺失或类型不匹配返回 false（不抛错）；
 * - 政策实例未找到时返回 false（明确语义）。
 */

import type { ConditionExpression } from '../../domain/conditions';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { PlayerSave } from '../../types/player';
import {
  INSTITUTION_LEVELS,
  LEADERSHIP_RANKS,
  CIVIL_SERVICE_RANKS,
} from '../../domain/career/types';

/** 条件评估上下文 */
export interface ConditionEvaluationContext {
  /** 触发信号快照 */
  signal: DomainSignalSnapshot;
  /** 当前游戏状态（只读） */
  state: Readonly<PlayerSave>;
  /** 当前绝对游戏日 */
  currentDay: number;
  /** 每年游戏日数（由调用方从配置 daysPerMonth × monthsPerYear 提供，项目为 360） */
  daysPerYear: number;
}

/**
 * 比较两个序数（用于有序枚举）。
 *
 * @param actualIndex 实际值序数
 * @param targetIndex 目标值序数
 * @param op 比较操作符
 * @returns 比较结果
 */
function compareOrdinal(actualIndex: number, targetIndex: number, op: string): boolean {
  switch (op) {
    case 'eq':
      return actualIndex === targetIndex;
    case 'neq':
      return actualIndex !== targetIndex;
    case 'gt':
      return actualIndex > targetIndex;
    case 'gte':
      return actualIndex >= targetIndex;
    case 'lt':
      return actualIndex < targetIndex;
    case 'lte':
      return actualIndex <= targetIndex;
    default:
      return false;
  }
}

/**
 * 比较两个数值。
 *
 * @param actual 实际值
 * @param target 目标值
 * @param op 比较操作符
 * @returns 比较结果
 */
function compareNumber(actual: number, target: number, op: string): boolean {
  switch (op) {
    case 'eq':
      return actual === target;
    case 'neq':
      return actual !== target;
    case 'gt':
      return actual > target;
    case 'gte':
      return actual >= target;
    case 'lt':
      return actual < target;
    case 'lte':
      return actual <= target;
    default:
      return false;
  }
}

/**
 * 评估信号字段条件。
 *
 * @param cond 信号字段条件
 * @param ctx 评估上下文
 * @returns 是否满足
 */
function evaluateSignalField(
  cond: Extract<ConditionExpression, { signalField: string }>,
  ctx: ConditionEvaluationContext,
): boolean {
  const data = ctx.signal.data as Record<string, unknown>;
  const actual = data[cond.signalField];
  // 字段不存在明确返回 false
  if (actual === undefined) return false;
  const op = cond.op;
  if (typeof cond.value === 'number' && typeof actual === 'number') {
    return compareNumber(actual, cond.value, op);
  }
  // 字符串/null 仅支持 eq/neq
  if (op === 'eq') return actual === cond.value;
  if (op === 'neq') return actual !== cond.value;
  return false;
}

/**
 * 评估职业条件。
 *
 * @param cond 职业条件
 * @param ctx 评估上下文
 * @returns 是否满足
 */
function evaluateCareer(
  cond: Extract<ConditionExpression, { careerCheck: string }>,
  ctx: ConditionEvaluationContext,
): boolean {
  const career = ctx.state.career;
  const appt = career.appointment;
  switch (cond.careerCheck) {
    case 'institution_level': {
      const actual = INSTITUTION_LEVELS.indexOf(appt.institutionLevel);
      const target = INSTITUTION_LEVELS.indexOf(cond.value);
      return compareOrdinal(actual, target, cond.op ?? 'eq');
    }
    case 'position_domain': {
      const op = cond.op ?? 'eq';
      return op === 'neq' ? appt.positionDomain !== cond.value : appt.positionDomain === cond.value;
    }
    case 'leadership_rank': {
      const actual = LEADERSHIP_RANKS.indexOf(appt.leadershipRank);
      const target = LEADERSHIP_RANKS.indexOf(cond.value);
      return compareOrdinal(actual, target, cond.op ?? 'eq');
    }
    case 'civil_service_rank': {
      const actual = CIVIL_SERVICE_RANKS.indexOf(career.civilServiceRank);
      const target = CIVIL_SERVICE_RANKS.indexOf(cond.value);
      return compareOrdinal(actual, target, cond.op ?? 'eq');
    }
    case 'years_in_position': {
      const years = (ctx.currentDay - appt.startedAtDay) / ctx.daysPerYear;
      return compareNumber(years, cond.value, cond.op);
    }
    case 'has_experience': {
      // 履历中存在匹配机构 ID 或职位 ID 的记录
      return career.experiences.some(
        (exp) => exp.institutionId === cond.value || exp.positionId === cond.value,
      );
    }
    default:
      return false;
  }
}

/**
 * 评估事件历史条件。
 *
 * @param cond 事件历史条件
 * @param ctx 评估上下文
 * @returns 是否满足
 */
function evaluateEventHistory(
  cond: Extract<ConditionExpression, { eventHistory: string }>,
  ctx: ConditionEvaluationContext,
): boolean {
  const count = ctx.state.events.history.filter((h) => h.eventId === cond.eventHistory).length;
  switch (cond.check) {
    case 'occurred':
      return count > 0;
    case 'not_occurred':
      return count === 0;
    case 'count_gte':
      return count >= cond.value;
    case 'count_lte':
      return count <= cond.value;
    default:
      return false;
  }
}

/**
 * 评估政策状态条件。
 *
 * @param cond 政策状态条件
 * @param ctx 评估上下文
 * @returns 是否满足
 */
function evaluatePolicyState(
  cond: Extract<ConditionExpression, { policyRef: unknown }>,
  ctx: ConditionEvaluationContext,
): boolean {
  // 通过 policyRef 隔离具体政策实例（不再按 policyId 模糊匹配首个）
  const ref = cond.policyRef as
    { source: 'signal' } | { source: 'fixed'; policyInstanceId: string };
  let instanceId: string | undefined;
  if (ref.source === 'signal') {
    const data = ctx.signal.data as Record<string, unknown>;
    instanceId =
      typeof data['policyInstanceId'] === 'string'
        ? (data['policyInstanceId'] as string)
        : undefined;
  } else {
    instanceId = ref.policyInstanceId;
  }
  if (!instanceId) return false;
  const policy = ctx.state.governance.policies.find((p) => p.instanceId === instanceId);
  // 未找到政策实例明确返回 false
  if (!policy) return false;
  switch (cond.check) {
    case 'status_is':
      return policy.status === cond.value;
    case 'phase_is':
      return policy.currentPhaseId === cond.value;
    case 'metric_gte':
      return (policy.metrics[cond.metricId] ?? 0) >= cond.value;
    case 'metric_lte':
      return (policy.metrics[cond.metricId] ?? 0) <= cond.value;
    default:
      return false;
  }
}

/**
 * 评估履历条件。
 *
 * @param cond 履历条件
 * @param ctx 评估上下文
 * @returns 是否满足
 */
function evaluateExperience(
  cond: Extract<ConditionExpression, { experience: string }>,
  ctx: ConditionEvaluationContext,
): boolean {
  const experiences = ctx.state.career.experiences;
  switch (cond.experience) {
    case 'region_count': {
      const count = new Set(experiences.map((e) => e.regionId)).size;
      return compareNumber(count, cond.value, cond.op);
    }
    case 'domain_count': {
      const count = new Set(experiences.map((e) => e.positionDomain)).size;
      return compareNumber(count, cond.value, cond.op);
    }
    case 'level_count': {
      const count = new Set(experiences.map((e) => e.institutionLevel)).size;
      return compareNumber(count, cond.value, cond.op);
    }
    case 'has_institution':
      return experiences.some((e) => e.institutionId === cond.value);
    default:
      return false;
  }
}

/**
 * 评估世界事实条件。
 *
 * @param cond 世界事实条件
 * @param ctx 评估上下文
 * @returns 是否满足
 */
function evaluateFact(
  cond: Extract<ConditionExpression, { fact: string }>,
  ctx: ConditionEvaluationContext,
): boolean {
  const facts = ctx.state.world.facts;
  const actual = facts[cond.fact];
  switch (cond.op) {
    case 'is_true':
      return actual === true;
    case 'is_false':
      return actual === false || actual === undefined;
    case 'eq':
      return actual === cond.value;
    case 'neq':
      return actual !== cond.value;
    default:
      return false;
  }
}

/**
 * 评估世界指标条件。
 *
 * @param cond 世界指标条件
 * @param ctx 评估上下文
 * @returns 是否满足
 */
function evaluateWorldMetric(
  cond: Extract<ConditionExpression, { worldMetric: string }>,
  ctx: ConditionEvaluationContext,
): boolean {
  // 缺失指标统一默认为 0
  const actual = ctx.state.world.metrics[cond.worldMetric] ?? 0;
  return compareNumber(actual, cond.value, cond.op);
}

/**
 * 评估条件表达式（纯函数）。
 *
 * @param condition 条件表达式
 * @param context 评估上下文
 * @returns 是否满足
 */
export function evaluateCondition(
  condition: ConditionExpression,
  context: ConditionEvaluationContext,
): boolean {
  // 逻辑组合
  if ('all' in condition) {
    return condition.all.every((c) => evaluateCondition(c, context));
  }
  if ('any' in condition) {
    return condition.any.some((c) => evaluateCondition(c, context));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, context);
  }
  // 信号字段
  if ('signalField' in condition) {
    return evaluateSignalField(condition, context);
  }
  // 职业状态
  if ('careerCheck' in condition) {
    return evaluateCareer(condition, context);
  }
  // 世界指标
  if ('worldMetric' in condition) {
    return evaluateWorldMetric(condition, context);
  }
  // 事件历史
  if ('eventHistory' in condition) {
    return evaluateEventHistory(condition, context);
  }
  // 政策状态
  if ('policyRef' in condition) {
    return evaluatePolicyState(condition, context);
  }
  // 履历
  if ('experience' in condition) {
    return evaluateExperience(condition, context);
  }
  // 世界事实
  if ('fact' in condition) {
    return evaluateFact(condition, context);
  }
  // 未知条件类型明确返回 false
  return false;
}
