/**
 * 试用期条件进度投影。
 *
 * 将评估引擎输入转换为 UI 可直接展示的只读快照，页面无需重复业务判断。
 */

import type { CareerRestriction } from '../../domain/career/state';
import type { ProbationConfig } from '../../types/config';
import { calculateProbationScore, type ProbationEvaluationInput } from './probation-evaluation';

/** UI 可直接展示的试用期条件快照。 */
export interface ProbationProgress {
  score: number;
  remainingDays: number;
  completedActionCount: number;
  minimumCompletedActions: number;
  extensionCount: number;
  maxExtensions: number;
  requirements: Array<{
    id: 'minimum_completed_actions' | 'score_threshold' | 'career_restrictions';
    satisfied: boolean;
    detail: string;
  }>;
  ready: boolean;
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
 * 生成不含 UI 判断的试用期条件进度快照。
 *
 * @param input 当前日期、试用期事实、属性、限制与配置
 * @returns 条件完成情况；无试用期时返回 null
 */
export function inspectProbationProgress(
  input: ProbationEvaluationInput,
): ProbationProgress | null {
  const probation = input.probation;
  if (!probation) return null;
  const score = calculateProbationScore(input.attributes, input.config);
  const disqualifying = activeDisqualifyingRestrictions(
    input.restrictions,
    input.currentDay,
    input.config,
  );
  const requirements: ProbationProgress['requirements'] = [
    {
      id: 'minimum_completed_actions',
      satisfied: probation.completedActionCount >= input.config.minimumCompletedActions,
      detail: `完成行动 ${probation.completedActionCount}/${input.config.minimumCompletedActions}`,
    },
    {
      id: 'score_threshold',
      satisfied: score >= input.config.passScoreThreshold,
      detail: `评价分 ${score}/${input.config.passScoreThreshold}`,
    },
    {
      id: 'career_restrictions',
      satisfied: disqualifying.length === 0,
      detail:
        disqualifying.length === 0
          ? '无影响转正的职业限制'
          : `存在 ${disqualifying.length} 项影响转正的职业限制`,
    },
  ];
  return {
    score,
    remainingDays: Math.max(probation.endsAtDay - input.currentDay, 0),
    completedActionCount: probation.completedActionCount,
    minimumCompletedActions: input.config.minimumCompletedActions,
    extensionCount: probation.extensionCount,
    maxExtensions: input.config.maxExtensions,
    requirements,
    ready: requirements.every((requirement) => requirement.satisfied),
  };
}
