/** 配置驱动的职业机会准备度诊断，供 UI 与测试共用。 */

import type { ConditionExpression } from '../../domain/conditions';
import { CIVIL_SERVICE_RANK_LABELS, LEADERSHIP_RANK_LABELS } from '../../domain/career/types';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type {
  CareerOpportunityDefinitionReadiness,
  CareerOpportunityDefinitionReadinessInput,
} from '../../types/career';
import { evaluateCondition } from '../events/condition-interpreter';

const RESTRICTION_LABELS = {
  rank_advancement_freeze: '职级晋升冻结',
  appointment_selection_freeze: '任职选拔冻结',
  disciplinary_action: '处分限制',
} as const;

const EVENT_HISTORY_LABELS: Record<string, string> = {
  flood_preparation_metrics: '防汛准备度量',
  industrial_park_progress_crisis: '产业园进度危机',
};

function comparisonLabel(op: string): string {
  return (
    { eq: '等于', neq: '不等于', gt: '高于', gte: '不少于', lt: '低于', lte: '不多于' }[op] ?? op
  );
}

function describeCondition(condition: ConditionExpression): string {
  if ('all' in condition) return `全部满足：${condition.all.map(describeCondition).join('；')}`;
  if ('any' in condition) return `满足任一：${condition.any.map(describeCondition).join('；')}`;
  if ('not' in condition) return `不满足：${describeCondition(condition.not)}`;
  if ('signalField' in condition)
    return `${condition.signalField === 'score' ? '最近一次考核分数' : condition.signalField} ${comparisonLabel(condition.op)} ${String(condition.value)}`;
  if ('fact' in condition)
    return condition.fact === 'assigned_project_delivered'
      ? '已完成上级交办专项攻坚'
      : `世界事实 ${condition.fact} ${condition.op}`;
  if ('careerCheck' in condition) {
    switch (condition.careerCheck) {
      case 'probation_status':
        return `试用状态${(condition.op ?? 'eq') === 'neq' ? '不是' : '为'}${{ active: '进行中', passed: '已通过', failed: '未通过', none: '无试用期' }[condition.value]}`;
      case 'leadership_rank':
        return `领导职务${comparisonLabel(condition.op ?? 'eq')}${LEADERSHIP_RANK_LABELS[condition.value]}`;
      case 'civil_service_rank':
        return `公务员职级${comparisonLabel(condition.op ?? 'eq')}${CIVIL_SERVICE_RANK_LABELS[condition.value]}`;
      case 'years_in_civil_service':
        return `累计服务年限${comparisonLabel(condition.op)} ${condition.value} 年`;
      case 'years_in_position':
        return `当前任职年限${comparisonLabel(condition.op)} ${condition.value} 年`;
      case 'days_in_civil_service_rank':
        return `当前职级天数${comparisonLabel(condition.op)} ${condition.value} 天`;
      case 'assessment_history': {
        const label = {
          total_count: '累计考核次数',
          qualified_count: '称职及以上考核次数',
          excellent_count: '优秀考核次数',
          current_appointment_qualified_count: '当前任职内称职及以上考核次数',
        }[condition.check];
        return `${label}${comparisonLabel(condition.op)} ${condition.value} 次`;
      }
      case 'active_restriction':
        return `${(condition.op ?? 'eq') === 'neq' ? '当前无' : '当前有'}${RESTRICTION_LABELS[condition.value]}`;
      case 'institution_level':
        return `机构层级${comparisonLabel(condition.op ?? 'eq')} ${condition.value}`;
      case 'position_domain':
        return `岗位领域${comparisonLabel(condition.op ?? 'eq')} ${condition.value}`;
    }
  }
  if ('worldMetric' in condition)
    return `世界指标 ${condition.worldMetric}${comparisonLabel(condition.op)} ${condition.value}`;
  if ('eventHistory' in condition)
    return `事件经历 ${EVENT_HISTORY_LABELS[condition.eventHistory] ?? condition.eventHistory}：${condition.check}`;
  if ('experience' in condition) return `履历 ${condition.experience}：${condition.op}`;
  if ('policyRef' in condition) return `政策状态：${condition.check}`;
  return '未识别条件';
}

/**
 * 按正式机会定义逐项评估当前准备度。
 *
 * @param input 机会定义、状态、时间与履历规则
 * @returns 生成/接受准备度及逐项配置诊断
 */
export function evaluateCareerOpportunityDefinitionReadiness(
  input: CareerOpportunityDefinitionReadinessInput,
): CareerOpportunityDefinitionReadiness {
  const latest = input.state.assessments.annualAssessments.at(-1);
  const signal: DomainSignalSnapshot = {
    signalId: 'career-readiness',
    signalType: 'assessment.completed',
    occurredAtDay: input.currentDay,
    data: { year: latest?.year ?? 0, score: latest?.score ?? 0, tier: latest?.tier ?? '' },
  };
  const evaluate = (condition: ConditionExpression) =>
    evaluateCondition(condition, {
      state: input.state,
      signal,
      currentDay: input.currentDay,
      daysPerYear: input.daysPerYear,
      careerExperienceQualificationRules: input.careerExperienceQualificationRules,
    });
  const generation = input.definition.conditions.map((condition) => ({
    phase: 'generation' as const,
    condition,
    satisfied: evaluate(condition),
    detail: describeCondition(condition),
  }));
  const acceptance = (input.definition.acceptanceConditions ?? []).map((condition) => ({
    phase: 'acceptance' as const,
    condition,
    satisfied: evaluate(condition),
    detail: describeCondition(condition),
  }));
  return {
    readyToGenerate: generation.every((item) => item.satisfied),
    readyToAccept: [...generation, ...acceptance].every((item) => item.satisfied),
    items: [...generation, ...acceptance],
  };
}
