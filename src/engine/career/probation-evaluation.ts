/**
 * 新录用公务员试用期评估引擎。
 *
 * 只消费持久化任职事实、角色属性、职业限制与配置，返回新的试用期快照；
 * 不读取 Store、DOM 或运行时临时状态。
 */

import type {
  AppointmentProbation,
  CareerRestriction,
  ProbationEvaluationRecord,
} from '../../domain/career/state';
import type { ProbationConfig } from '../../types/config';

/** 试用期评估所需的角色属性。 */
export interface ProbationEvaluationAttributes {
  competence: number;
  diligence: number;
  integrity: number;
  stability: number;
}

/** 试用期评估输入。 */
export interface ProbationEvaluationInput {
  currentDay: number;
  probation: Readonly<AppointmentProbation> | null;
  attributes: Readonly<ProbationEvaluationAttributes>;
  restrictions: readonly CareerRestriction[];
  config: Readonly<ProbationConfig>;
}

/** 尚未产生评估结果的安全失败原因。 */
export type ProbationEvaluationFailure =
  'not_active' | 'not_due' | 'invalid_state' | 'invalid_config';

/** 试用期评估结果。 */
export type ProbationEvaluationResult =
  | { success: false; failure: ProbationEvaluationFailure }
  | {
      success: true;
      outcome: ProbationEvaluationRecord['outcome'];
      probation: AppointmentProbation;
      evaluation: ProbationEvaluationRecord;
    };

/**
 * 为新录用任职创建试用期事实。
 *
 * @param startedAtDay 任职开始绝对日
 * @param config 试用期配置
 * @returns 可直接持久化的活动试用期
 */
export function createAppointmentProbation(
  startedAtDay: number,
  config: Readonly<ProbationConfig>,
): AppointmentProbation {
  return {
    status: 'active',
    startedAtDay,
    endsAtDay: startedAtDay + config.durationDays,
    extensionCount: 0,
    completedActionCount: 0,
    resolvedAtDay: null,
    outcomeReason: null,
    evaluations: [],
  };
}

function isFiniteAttributes(attributes: Readonly<ProbationEvaluationAttributes>): boolean {
  return Object.values(attributes).every(Number.isFinite);
}

function isValidConfig(config: Readonly<ProbationConfig>): boolean {
  const weightSum = Object.values(config.attributeWeights).reduce((sum, value) => sum + value, 0);
  return (
    config.durationDays > 0 &&
    config.minimumCompletedActions >= 0 &&
    config.passScoreThreshold >= config.extensionScoreThreshold &&
    config.extensionScoreThreshold >= 0 &&
    config.passScoreThreshold <= 100 &&
    config.extensionDays > 0 &&
    config.maxExtensions >= 0 &&
    Math.abs(weightSum - 1) < 0.001
  );
}

function activeDisqualifyingRestrictions(
  restrictions: readonly CareerRestriction[],
  currentDay: number,
  config: Readonly<ProbationConfig>,
): CareerRestriction[] {
  return restrictions.filter(
    (restriction) =>
      restriction.startedAtDay <= currentDay &&
      (restriction.endsAtDay === null || currentDay < restriction.endsAtDay) &&
      config.disqualifyingRestrictionTypes.includes(restriction.type),
  );
}

/**
 * 计算当前试用期评价分。
 *
 * @param attributes 角色持久化属性
 * @param config 试用期配置
 * @returns 四项属性加权分，保留两位小数
 */
export function calculateProbationScore(
  attributes: Readonly<ProbationEvaluationAttributes>,
  config: Readonly<ProbationConfig>,
): number {
  const weights = config.attributeWeights;
  const score =
    attributes.competence * weights.competence +
    attributes.diligence * weights.diligence +
    attributes.integrity * weights.integrity +
    attributes.stability * weights.stability;
  return Math.round(score * 100) / 100;
}

/**
 * 在到期日评估并生成下一份试用期快照。
 *
 * @param input 当前日期、试用期事实、属性、限制与配置
 * @returns 通过、延期、不予转正，或不应结算的安全失败
 */
export function evaluateProbation(input: ProbationEvaluationInput): ProbationEvaluationResult {
  const { probation, currentDay, config } = input;
  if (!probation || probation.status !== 'active') return { success: false, failure: 'not_active' };
  if (currentDay < probation.endsAtDay) return { success: false, failure: 'not_due' };
  if (
    !Number.isInteger(currentDay) ||
    probation.endsAtDay < probation.startedAtDay ||
    probation.extensionCount < 0 ||
    probation.completedActionCount < 0 ||
    !isFiniteAttributes(input.attributes)
  )
    return { success: false, failure: 'invalid_state' };
  if (!isValidConfig(config)) return { success: false, failure: 'invalid_config' };

  const score = calculateProbationScore(input.attributes, config);
  const restrictions = activeDisqualifyingRestrictions(input.restrictions, currentDay, config);
  const unmetRequirements: string[] = [];
  if (probation.completedActionCount < config.minimumCompletedActions)
    unmetRequirements.push('minimum_completed_actions');
  if (restrictions.length > 0) unmetRequirements.push('disqualifying_restriction');
  if (score < config.passScoreThreshold) unmetRequirements.push('score_below_pass_threshold');

  const passed = unmetRequirements.length === 0;
  const canExtend =
    !passed &&
    probation.extensionCount < config.maxExtensions &&
    score >= config.extensionScoreThreshold;
  const outcome: ProbationEvaluationRecord['outcome'] = passed
    ? 'passed'
    : canExtend
      ? 'extended'
      : 'failed';
  const nextEndsAtDay = canExtend ? currentDay + config.extensionDays : null;
  const evaluation: ProbationEvaluationRecord = {
    evaluatedAtDay: currentDay,
    outcome,
    score,
    completedActionCount: probation.completedActionCount,
    unmetRequirements,
    previousEndsAtDay: probation.endsAtDay,
    nextEndsAtDay,
  };
  const next: AppointmentProbation = {
    ...structuredClone(probation),
    status: passed ? 'passed' : canExtend ? 'active' : 'failed',
    endsAtDay: nextEndsAtDay ?? probation.endsAtDay,
    extensionCount: probation.extensionCount + (canExtend ? 1 : 0),
    resolvedAtDay: passed || !canExtend ? currentDay : null,
    outcomeReason: passed
      ? '试用期评价合格，正式转正'
      : canExtend
        ? `未满足转正条件，试用期延长至第 ${nextEndsAtDay} 天`
        : '试用期评价不合格，不予转正并终止本次任职',
    evaluations: [...probation.evaluations, evaluation],
  };
  return { success: true, outcome, probation: next, evaluation };
}
