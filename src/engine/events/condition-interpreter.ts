/** 统一条件表达式的递归纯函数解释入口。 */

import type { ConditionExpression } from '../../domain/conditions';
import type { ConditionEvaluationContext } from '../../types/condition';
import { evaluateCareerCondition } from './career-condition-evaluator';
import { compareNumber } from './condition-comparison';
import {
  evaluateEventHistoryCondition,
  evaluateExperienceCondition,
  evaluateFactCondition,
  evaluatePolicyStateCondition,
  evaluateWorldMetricCondition,
} from './state-condition-evaluators';

export type { ConditionEvaluationContext } from '../../types/condition';

function evaluateSignalField(
  condition: Extract<ConditionExpression, { signalField: string }>,
  context: ConditionEvaluationContext,
): boolean {
  const actual = (context.signal.data as Record<string, unknown>)[condition.signalField];
  if (actual === undefined) return false;
  if (typeof condition.value === 'number' && typeof actual === 'number')
    return compareNumber(actual, condition.value, condition.op);
  if (condition.op === 'eq') return actual === condition.value;
  return condition.op === 'neq' && actual !== condition.value;
}

/**
 * 评估条件表达式。
 *
 * @param condition 条件表达式
 * @param context 只读评估上下文
 * @returns 是否满足条件
 */
export function evaluateCondition(
  condition: ConditionExpression,
  context: ConditionEvaluationContext,
): boolean {
  if ('all' in condition) return condition.all.every((item) => evaluateCondition(item, context));
  if ('any' in condition) return condition.any.some((item) => evaluateCondition(item, context));
  if ('not' in condition) return !evaluateCondition(condition.not, context);
  if ('signalField' in condition) return evaluateSignalField(condition, context);
  if ('careerCheck' in condition) return evaluateCareerCondition(condition, context);
  if ('worldMetric' in condition) return evaluateWorldMetricCondition(condition, context);
  if ('eventHistory' in condition) return evaluateEventHistoryCondition(condition, context);
  if ('policyRef' in condition) return evaluatePolicyStateCondition(condition, context);
  if ('experience' in condition) return evaluateExperienceCondition(condition, context);
  if ('fact' in condition) return evaluateFactCondition(condition, context);
  return false;
}
