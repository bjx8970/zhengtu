/** 职业履历分析器的单条记录资格派生。 */

import type { CareerExperience } from '../../domain/career/state';
import type { CareerExperienceQualificationRules } from '../../types/config';
import type {
  AnalyzedCareerExperience,
  CareerExperienceDiagnostic,
  CareerExperienceExclusionReason,
} from './career-experience-analysis-types';

function includesQualification(
  durationDays: number,
  counts: boolean,
  minimum: number | null,
  excludedReason: CareerExperienceExclusionReason,
  belowMinimumReason: CareerExperienceExclusionReason,
  exclusions: CareerExperienceExclusionReason[],
): boolean {
  if (!counts) {
    exclusions.push(excludedReason);
    return false;
  }
  if (minimum === null || durationDays < minimum) {
    exclusions.push(belowMinimumReason);
    return false;
  }
  return true;
}

/**
 * 逐条派生履历资格并记录无法静态修复的异常。
 *
 * @param experiences 已按稳定顺序排列的履历
 * @param currentDay 当前绝对游戏日
 * @param rules 配置化资格规则
 * @param diagnostics 分析器共享的诊断收集器
 * @returns 与输入一一对应的派生记录
 */
export function analyzeCareerExperienceRecords(
  experiences: readonly CareerExperience[],
  currentDay: number,
  rules: Readonly<CareerExperienceQualificationRules>,
  diagnostics: CareerExperienceDiagnostic[],
): AnalyzedCareerExperience[] {
  return experiences.map((experience) => {
    const effectiveEndedAtDay = experience.endedAtDay ?? currentDay;
    const invalidInterval = effectiveEndedAtDay < experience.startedAtDay;
    if (invalidInterval)
      diagnostics.push({ code: 'negative_duration', experienceIds: [experience.id] });
    if (experience.endedAtDay === null && experience.endReason !== null)
      diagnostics.push({ code: 'open_experience_has_end_reason', experienceIds: [experience.id] });
    if (experience.endedAtDay !== null && experience.endReason === null)
      diagnostics.push({
        code: 'closed_experience_missing_end_reason',
        experienceIds: [experience.id],
      });
    const exclusions: CareerExperienceExclusionReason[] = invalidInterval
      ? ['invalid_interval']
      : [];
    const rule = rules.appointmentTypes.find(
      (item) => item.appointmentType === experience.appointmentType,
    );
    const durationDays = invalidInterval ? 0 : effectiveEndedAtDay - experience.startedAtDay;
    if (!rule)
      diagnostics.push({ code: 'unknown_appointment_type_rule', experienceIds: [experience.id] });
    const qualify = (
      counts: boolean,
      minimum: number | null,
      excluded: CareerExperienceExclusionReason,
      below: CareerExperienceExclusionReason,
    ) =>
      !invalidInterval &&
      rule !== undefined &&
      includesQualification(durationDays, counts, minimum, excluded, below, exclusions);
    return {
      experienceId: experience.id,
      appointmentId: experience.appointmentId,
      regionId: experience.regionId,
      institutionId: experience.institutionId,
      institutionLevel: experience.institutionLevel,
      positionDomain: experience.positionDomain,
      appointmentType: experience.appointmentType,
      effectiveStartedAtDay: experience.startedAtDay,
      effectiveEndedAtDay,
      durationDays,
      qualifiesForRegionExperience: qualify(
        rule?.countsTowardRegionExperience ?? false,
        rule?.minDaysForRegionExperience ?? null,
        'appointment_type_excluded_from_region',
        'duration_below_region_minimum',
      ),
      qualifiesForInstitutionExperience: qualify(
        rule?.countsTowardInstitutionExperience ?? false,
        rule?.minDaysForInstitutionExperience ?? null,
        'appointment_type_excluded_from_institution',
        'duration_below_institution_minimum',
      ),
      qualifiesForDomainExperience: qualify(
        rule?.countsTowardDomainExperience ?? false,
        rule?.minDaysForDomainExperience ?? null,
        'appointment_type_excluded_from_domain',
        'duration_below_domain_minimum',
      ),
      qualifiesForLevelExperience: qualify(
        rule?.countsTowardLevelExperience ?? false,
        rule?.minDaysForLevelExperience ?? null,
        'appointment_type_excluded_from_level',
        'duration_below_level_minimum',
      ),
      exclusionReasons: exclusions,
    };
  });
}
