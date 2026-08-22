/** 职业状态条件的纯函数解释器。 */

import type { ConditionExpression } from '../../domain/conditions';
import {
  CIVIL_SERVICE_RANKS,
  INSTITUTION_LEVELS,
  LEADERSHIP_RANKS,
} from '../../domain/career/types';
import type { ConditionEvaluationContext } from '../../types/condition';
import { calculateCareerServiceDays } from '../career/career-service';
import { compareNumber, compareOrdinal } from './condition-comparison';

/**
 * 评估职业状态条件。
 *
 * @param condition 职业状态条件
 * @param context 只读评估上下文
 * @returns 是否满足条件
 */
export function evaluateCareerCondition(
  condition: Extract<ConditionExpression, { careerCheck: string }>,
  context: ConditionEvaluationContext,
): boolean {
  const career = context.state.career;
  const appointment = career.appointment;
  switch (condition.careerCheck) {
    case 'institution_level':
      return compareOrdinal(
        INSTITUTION_LEVELS.indexOf(appointment.institutionLevel),
        INSTITUTION_LEVELS.indexOf(condition.value),
        condition.op ?? 'eq',
      );
    case 'position_domain':
      return (condition.op ?? 'eq') === 'neq'
        ? appointment.positionDomain !== condition.value
        : appointment.positionDomain === condition.value;
    case 'leadership_rank':
      return compareOrdinal(
        LEADERSHIP_RANKS.indexOf(appointment.leadershipRank),
        LEADERSHIP_RANKS.indexOf(condition.value),
        condition.op ?? 'eq',
      );
    case 'civil_service_rank':
      return compareOrdinal(
        CIVIL_SERVICE_RANKS.indexOf(career.civilServiceRank),
        CIVIL_SERVICE_RANKS.indexOf(condition.value),
        condition.op ?? 'eq',
      );
    case 'years_in_position':
      return compareNumber(
        (context.currentDay - appointment.startedAtDay) / context.daysPerYear,
        condition.value,
        condition.op,
      );
    case 'days_in_civil_service_rank':
      return compareNumber(
        context.currentDay - career.civilServiceRankStartedAtDay,
        condition.value,
        condition.op,
      );
    case 'years_in_civil_service':
      return compareNumber(
        calculateCareerServiceDays(appointment, career.experiences, context.currentDay) /
          context.daysPerYear,
        condition.value,
        condition.op,
      );
    case 'probation_status': {
      const status = appointment.probation?.status ?? 'none';
      return (condition.op ?? 'eq') === 'neq'
        ? status !== condition.value
        : status === condition.value;
    }
    case 'assessment_history': {
      const qualified = (tier: string) => tier === '优秀' || tier === '称职';
      const assessments = context.state.assessments.annualAssessments;
      const currentExperience = career.experiences.find(
        (item) => item.appointmentId === appointment.appointmentId && item.endedAtDay === null,
      );
      const actual =
        condition.check === 'total_count'
          ? assessments.length
          : condition.check === 'qualified_count'
            ? assessments.filter((item) => qualified(item.tier)).length
            : condition.check === 'excellent_count'
              ? assessments.filter((item) => item.tier === '优秀').length
              : (currentExperience?.assessmentResults.filter((item) => qualified(item.tier))
                  .length ?? 0);
      return compareNumber(actual, condition.value, condition.op);
    }
    case 'active_restriction': {
      const active = career.restrictions.some(
        (item) =>
          item.type === condition.value &&
          item.startedAtDay <= context.currentDay &&
          (item.endsAtDay === null || context.currentDay < item.endsAtDay),
      );
      return (condition.op ?? 'eq') === 'neq' ? !active : active;
    }
    default:
      return false;
  }
}
