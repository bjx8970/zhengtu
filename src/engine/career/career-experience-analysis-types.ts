/** 职业履历分析器的稳定输入、输出及诊断类型。 */

import type { CareerExperience, CurrentAppointment } from '../../domain/career/state';
import type { AppointmentType, InstitutionLevel, PositionDomain } from '../../domain/career/types';
import type { CareerExperienceQualificationRules } from '../../types/config';

export type CareerExperienceDiagnosticCode =
  | 'no_open_experience'
  | 'multiple_open_experiences'
  | 'open_experience_mismatch'
  | 'duplicate_appointment_id'
  | 'negative_duration'
  | 'overlapping_experiences'
  | 'closed_experience_missing_end_reason'
  | 'open_experience_has_end_reason'
  | 'future_started_at_day'
  | 'future_ended_at_day'
  | 'unknown_appointment_type_rule';

export type CareerExperienceExclusionReason =
  | 'duration_below_region_minimum'
  | 'duration_below_institution_minimum'
  | 'duration_below_domain_minimum'
  | 'duration_below_level_minimum'
  | 'appointment_type_excluded_from_region'
  | 'appointment_type_excluded_from_institution'
  | 'appointment_type_excluded_from_domain'
  | 'appointment_type_excluded_from_level'
  | 'invalid_interval';

/** 履历完整性诊断，experienceIds 指向造成问题的稳定履历记录。 */
export interface CareerExperienceDiagnostic {
  code: CareerExperienceDiagnosticCode;
  experienceIds: string[];
}

/** 单条任职记录的派生资格结果。 */
export interface AnalyzedCareerExperience {
  experienceId: string;
  appointmentId: string;
  regionId: string;
  institutionId: string;
  institutionLevel: InstitutionLevel;
  positionDomain: PositionDomain;
  appointmentType: AppointmentType;
  effectiveStartedAtDay: number;
  effectiveEndedAtDay: number;
  durationDays: number;
  qualifiesForRegionExperience: boolean;
  qualifiesForInstitutionExperience: boolean;
  qualifiesForDomainExperience: boolean;
  qualifiesForLevelExperience: boolean;
  exclusionReasons: CareerExperienceExclusionReason[];
}

/** 统一履历分析的输入，所有依赖均由调用方显式提供。 */
export interface CareerExperienceAnalysisContext {
  experiences: readonly CareerExperience[];
  currentAppointment: Readonly<CurrentAppointment>;
  currentDay: number;
  rules: Readonly<CareerExperienceQualificationRules>;
}

/** 统一履历分析的确定性结果。 */
export interface CareerExperienceAnalysis {
  valid: boolean;
  diagnostics: CareerExperienceDiagnostic[];
  records: AnalyzedCareerExperience[];
  qualifiedRegionIds: string[];
  qualifiedInstitutionIds: string[];
  qualifiedDomains: PositionDomain[];
  qualifiedInstitutionLevels: InstitutionLevel[];
  regionCount: number;
  institutionCount: number;
  domainCount: number;
  levelCount: number;
  totalQualifiedDays: number;
}
