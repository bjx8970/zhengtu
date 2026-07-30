/**
 * 配置驱动的职业履历资格分析器。
 *
 * 以 career.experiences 为唯一事实来源，验证履历完整性并聚合有效资格。
 */

import type { CareerExperience, CurrentAppointment } from '../../domain/career/state';
import { analyzeCareerExperienceRecords } from './career-experience-record-analysis';
import type {
  CareerExperienceAnalysis,
  CareerExperienceAnalysisContext,
  CareerExperienceDiagnostic,
} from './career-experience-analysis-types';

export type {
  AnalyzedCareerExperience,
  CareerExperienceAnalysis,
  CareerExperienceAnalysisContext,
  CareerExperienceDiagnostic,
  CareerExperienceDiagnosticCode,
  CareerExperienceExclusionReason,
} from './career-experience-analysis-types';

function compareExperiences(left: CareerExperience, right: CareerExperience): number {
  return (
    left.startedAtDay - right.startedAtDay ||
    (left.endedAtDay ?? Number.MAX_SAFE_INTEGER) - (right.endedAtDay ?? Number.MAX_SAFE_INTEGER) ||
    left.appointmentId.localeCompare(right.appointmentId) ||
    left.id.localeCompare(right.id)
  );
}

function matchesCurrentAppointment(
  experience: CareerExperience,
  appointment: CurrentAppointment,
): boolean {
  return (
    experience.appointmentId === appointment.appointmentId &&
    experience.positionId === appointment.positionId &&
    experience.institutionId === appointment.institutionId &&
    experience.regionId === appointment.regionId &&
    experience.institutionLevel === appointment.institutionLevel &&
    experience.positionDomain === appointment.positionDomain &&
    experience.leadershipRank === appointment.leadershipRank &&
    experience.startedAtDay === appointment.startedAtDay &&
    experience.appointmentType === appointment.appointmentType &&
    experience.appointmentReason === appointment.appointmentReason &&
    experience.sourceOpportunityId === appointment.sourceOpportunityId
  );
}

function collectIntegrityDiagnostics(
  experiences: readonly CareerExperience[],
  appointment: CurrentAppointment,
  diagnostics: CareerExperienceDiagnostic[],
): void {
  const openExperiences = experiences.filter((experience) => experience.endedAtDay === null);
  if (openExperiences.length === 0)
    diagnostics.push({ code: 'no_open_experience', experienceIds: [] });
  if (openExperiences.length > 1)
    diagnostics.push({
      code: 'multiple_open_experiences',
      experienceIds: openExperiences.map((item) => item.id),
    });
  const openExperience = openExperiences[0];
  if (
    openExperiences.length === 1 &&
    openExperience &&
    !matchesCurrentAppointment(openExperience, appointment)
  )
    diagnostics.push({ code: 'open_experience_mismatch', experienceIds: [openExperience.id] });
  const ids = new Map<string, string[]>();
  for (const experience of experiences)
    ids.set(experience.appointmentId, [
      ...(ids.get(experience.appointmentId) ?? []),
      experience.id,
    ]);
  for (const experienceIds of ids.values())
    if (experienceIds.length > 1)
      diagnostics.push({ code: 'duplicate_appointment_id', experienceIds });
}

function hasOverlap(
  records: CareerExperienceAnalysis['records'],
  diagnostics: CareerExperienceDiagnostic[],
): void {
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const current = records[index];
    if (previous && current && current.effectiveStartedAtDay < previous.effectiveEndedAtDay)
      diagnostics.push({
        code: 'overlapping_experiences',
        experienceIds: [previous.experienceId, current.experienceId],
      });
  }
}

/**
 * 分析职业履历的资格及完整性。
 *
 * @param context 履历、当前任职、游戏日和资格规则
 * @returns 不修改输入的确定性资格与诊断结果
 */
export function analyzeCareerExperiences(
  context: CareerExperienceAnalysisContext,
): CareerExperienceAnalysis {
  const diagnostics: CareerExperienceDiagnostic[] = [];
  const experiences = [...context.experiences].sort(compareExperiences);
  collectIntegrityDiagnostics(experiences, context.currentAppointment, diagnostics);
  const records = analyzeCareerExperienceRecords(
    experiences,
    context.currentDay,
    context.rules,
    diagnostics,
  );
  hasOverlap(records, diagnostics);
  const unique = <T>(items: T[]): T[] => [...new Set(items)].sort();
  const qualifiedRegionIds = unique(
    records.filter((item) => item.qualifiesForRegionExperience).map((item) => item.regionId),
  );
  const qualifiedInstitutionIds = unique(
    records
      .filter((item) => item.qualifiesForInstitutionExperience)
      .map((item) => item.institutionId),
  );
  const qualifiedDomains = unique(
    records.filter((item) => item.qualifiesForDomainExperience).map((item) => item.positionDomain),
  );
  const qualifiedInstitutionLevels = unique(
    records.filter((item) => item.qualifiesForLevelExperience).map((item) => item.institutionLevel),
  );
  const totalQualifiedDays = records
    .filter(
      (item) =>
        item.qualifiesForRegionExperience ||
        item.qualifiesForInstitutionExperience ||
        item.qualifiesForDomainExperience ||
        item.qualifiesForLevelExperience,
    )
    .reduce((total, item) => total + item.durationDays, 0);
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    records,
    qualifiedRegionIds,
    qualifiedInstitutionIds,
    qualifiedDomains,
    qualifiedInstitutionLevels,
    regionCount: qualifiedRegionIds.length,
    institutionCount: qualifiedInstitutionIds.length,
    domainCount: qualifiedDomains.length,
    levelCount: qualifiedInstitutionLevels.length,
    totalQualifiedDays,
  };
}
