/**
 * 职业领域契约
 *
 * 定义职业与任职系统的稳定领域词汇：
 * - 机构层级、岗位领域、领导职务层次、公务员职级
 * - 任职类型、任职原因、职业机会类型和状态
 *
 * 核心不变量：
 * - 机构层级 ≠ 领导职务层次 ≠ 公务员职级
 * - 岗位领域 ≠ 永久职业线
 * - 具体职位 ≠ 职务层次
 * - contentTier 只用于内容难度，不是职业事实
 */

import { z } from 'zod';

// ===== 机构层级 =====

/** 机构层级常量数组（按行政层级从低到高排序） */
export const INSTITUTION_LEVELS = [
  'township',
  'county',
  'prefecture',
  'province',
  'central',
] as const;

/** 机构层级类型 */
export type InstitutionLevel = (typeof INSTITUTION_LEVELS)[number];

/** 机构层级中文标签 */
export const INSTITUTION_LEVEL_LABELS: Record<InstitutionLevel, string> = {
  township: '乡镇街道',
  county: '县区',
  prefecture: '地级市',
  province: '省级',
  central: '中央',
};

/** 机构层级 Zod Schema */
export const InstitutionLevelSchema = z.enum(INSTITUTION_LEVELS);

// ===== 岗位领域 =====

/** 岗位领域常量数组 */
export const POSITION_DOMAINS = [
  'local_governance',
  'party_organs',
  'government_general',
  'government_specialized',
  'discipline_inspection',
  'congress',
  'cppcc',
  'mass_organs',
  'central_institutions',
  'national_security',
] as const;

/** 岗位领域类型 */
export type PositionDomain = (typeof POSITION_DOMAINS)[number];

/** 岗位领域中文标签 */
export const POSITION_DOMAIN_LABELS: Record<PositionDomain, string> = {
  local_governance: '地方综合治理',
  party_organs: '党委工作机关',
  government_general: '政府综合机关',
  government_specialized: '政府专业部门',
  discipline_inspection: '纪检监察',
  congress: '人大机关',
  cppcc: '政协机关',
  mass_organs: '群团机关',
  central_institutions: '中央综合机构',
  national_security: '国防和国家安全决策领域',
};

/** 岗位领域 Zod Schema */
export const PositionDomainSchema = z.enum(POSITION_DOMAINS);

// ===== 领导职务层次 =====

/** 领导职务层次常量数组（从低到高） */
export const LEADERSHIP_RANKS = [
  'none',
  'township_deputy',
  'township_chief',
  'county_deputy',
  'county_chief',
  'prefecture_deputy',
  'prefecture_chief',
  'province_deputy',
  'province_chief',
  'national_deputy',
  'national_chief',
] as const;

/** 领导职务层次类型 */
export type LeadershipRank = (typeof LEADERSHIP_RANKS)[number];

/** 领导职务层次中文标签 */
export const LEADERSHIP_RANK_LABELS: Record<LeadershipRank, string> = {
  none: '无领导职务',
  township_deputy: '乡科级副职',
  township_chief: '乡科级正职',
  county_deputy: '县处级副职',
  county_chief: '县处级正职',
  prefecture_deputy: '厅局级副职',
  prefecture_chief: '厅局级正职',
  province_deputy: '省部级副职',
  province_chief: '省部级正职',
  national_deputy: '国家级副职',
  national_chief: '国家级正职',
};

/** 领导职务层次 Zod Schema */
export const LeadershipRankSchema = z.enum(LEADERSHIP_RANKS);

// ===== 公务员职级 =====

/** 公务员职级常量数组（从低到高） */
export const CIVIL_SERVICE_RANKS = [
  'clerk_2',
  'clerk_1',
  'section_member_4',
  'section_member_3',
  'section_member_2',
  'section_member_1',
  'researcher_4',
  'researcher_3',
  'researcher_2',
  'researcher_1',
  'inspector_2',
  'inspector_1',
] as const;

/** 公务员职级类型 */
export type CivilServiceRank = (typeof CIVIL_SERVICE_RANKS)[number];

/** 公务员职级中文标签 */
export const CIVIL_SERVICE_RANK_LABELS: Record<CivilServiceRank, string> = {
  clerk_2: '二级科员',
  clerk_1: '一级科员',
  section_member_4: '四级主任科员',
  section_member_3: '三级主任科员',
  section_member_2: '二级主任科员',
  section_member_1: '一级主任科员',
  researcher_4: '四级调研员',
  researcher_3: '三级调研员',
  researcher_2: '二级调研员',
  researcher_1: '一级调研员',
  inspector_2: '二级巡视员',
  inspector_1: '一级巡视员',
};

/** 公务员职级 Zod Schema */
export const CivilServiceRankSchema = z.enum(CIVIL_SERVICE_RANKS);

// ===== 任职类型 =====

/** 任职类型常量数组 */
export const APPOINTMENT_TYPES = ['substantive', 'acting', 'temporary', 'secondment'] as const;

/** 任职类型 */
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

/** 任职类型中文标签 */
export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  substantive: '正式任职',
  acting: '代理',
  temporary: '临时',
  secondment: '挂职',
};

/** 任职类型 Zod Schema */
export const AppointmentTypeSchema = z.enum(APPOINTMENT_TYPES);

// ===== 任职原因 =====

/** 任职原因常量数组 */
export const APPOINTMENT_REASONS = [
  'initial_assignment',
  'promotion',
  'lateral_transfer',
  'rotation',
  'temporary_assignment',
  'secondment',
  'demotion',
] as const;

/** 任职原因类型 */
export type AppointmentReason = (typeof APPOINTMENT_REASONS)[number];

/** 任职原因中文标签 */
export const APPOINTMENT_REASON_LABELS: Record<AppointmentReason, string> = {
  initial_assignment: '初次分配',
  promotion: '晋升',
  lateral_transfer: '平级交流',
  rotation: '轮岗',
  temporary_assignment: '临时指派',
  secondment: '挂职锻炼',
  demotion: '降职',
};

/** 任职原因 Zod Schema */
export const AppointmentReasonSchema = z.enum(APPOINTMENT_REASONS);

// ===== 职业机会类型 =====

/** 职业机会类型常量数组 */
export const CAREER_OPPORTUNITY_TYPES = [
  'promotion',
  'lateral_transfer',
  'rotation',
  'secondment',
  'demotion',
  'retirement',
] as const;

/** 职业机会类型 */
export type CareerOpportunityType = (typeof CAREER_OPPORTUNITY_TYPES)[number];

/** 职业机会类型 Zod Schema */
export const CareerOpportunityTypeSchema = z.enum(CAREER_OPPORTUNITY_TYPES);

// ===== 职业机会状态 =====

/** 职业机会状态常量数组 */
export const CAREER_OPPORTUNITY_STATUSES = [
  'available',
  'applied',
  'under_review',
  'accepted',
  'rejected',
  'expired',
] as const;

/** 职业机会状态 */
export type CareerOpportunityStatus = (typeof CAREER_OPPORTUNITY_STATUSES)[number];

/** 职业机会状态 Zod Schema */
export const CareerOpportunityStatusSchema = z.enum(CAREER_OPPORTUNITY_STATUSES);
