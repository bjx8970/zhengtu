/**
 * 职业持久化状态
 *
 * 定义 CareerState 及其子结构：
 * - CurrentAppointment：当前任职
 * - CareerExperience：职业履历
 * - CareerOpportunity：职业机会
 * - CareerProcess：进行中的职业流程
 */

import type {
  InstitutionLevel,
  PositionDomain,
  LeadershipRank,
  CivilServiceRank,
  AppointmentType,
  AppointmentReason,
  CareerOpportunityType,
  CareerOpportunityStatus,
  CareerRestrictionType,
} from './types';
import type { ConditionExpression } from '../conditions';

/** 当前任职状态 */
export interface CurrentAppointment {
  /** 任职实例的稳定身份，不能用职位 ID 代替。 */
  appointmentId: string;
  /** 稳定职位 ID */
  positionId: string;
  /** 稳定机构 ID */
  institutionId: string;
  /** 稳定地区 ID */
  regionId: string;
  /** 机构层级 */
  institutionLevel: InstitutionLevel;
  /** 岗位领域 */
  positionDomain: PositionDomain;
  /** 领导职务层次 */
  leadershipRank: LeadershipRank;
  /** 任职开始的绝对游戏日 */
  startedAtDay: number;
  /** 任职类型 */
  appointmentType: AppointmentType;
  /** 本次任职的原因。 */
  appointmentReason: AppointmentReason;
  /** 产生本次任职的机会，初始任职为 null。 */
  sourceOpportunityId: string | null;
  /** 试用期结束的绝对游戏日（null 表示无试用期） */
  probationEndsAtDay: number | null;
}

/** 公务员职级变化历史。 */
export interface CivilServiceRankChangeRecord {
  id: string;
  previousRank: CivilServiceRank;
  currentRank: CivilServiceRank;
  changedAtDay: number;
  reason: 'regular_advancement' | 'exceptional_advancement' | 'demotion';
  sourceType: 'assessment' | 'event' | 'policy' | 'system';
  sourceId: string | null;
  sourceAssessmentYear: number | null;
}

/** 持久化职业限制，使用左闭右开有效期。 */
export interface CareerRestriction {
  id: string;
  type: CareerRestrictionType;
  startedAtDay: number;
  endsAtDay: number | null;
  reason: string;
  sourceType: 'assessment' | 'event' | 'policy' | 'system';
  sourceId: string | null;
}

/** 履历中的考核记录 */
export interface CareerAssessmentRecord {
  year: number;
  score: number;
  tier: string;
}

/** 职业履历记录 */
export interface CareerExperience {
  /** 唯一 ID */
  id: string;
  /** 稳定职位 ID */
  positionId: string;
  /** 职位名称快照 */
  positionNameSnapshot: string;
  /** 稳定机构 ID */
  institutionId: string;
  /** 机构名称快照 */
  institutionNameSnapshot: string;
  /** 机构层级 */
  institutionLevel: InstitutionLevel;
  /** 稳定地区 ID */
  regionId: string;
  /** 岗位领域 */
  positionDomain: PositionDomain;
  /** 领导职务层次 */
  leadershipRank: LeadershipRank;
  /** 任职开始的绝对游戏日 */
  startedAtDay: number;
  /** 任职结束的绝对游戏日（null 表示当前在职） */
  endedAtDay: number | null;
  /** 任职原因 */
  appointmentReason: AppointmentReason;
  /** 该任期内的考核记录 */
  assessmentResults: CareerAssessmentRecord[];
}

/** 职业机会 */
export interface CareerOpportunity {
  /** 唯一 ID */
  id: string;
  /** 机会类型 */
  type: CareerOpportunityType;
  /** 机会状态 */
  status: CareerOpportunityStatus;
  source: CareerOpportunitySource;
  target: CareerOpportunityTargetSnapshot;
  appointmentType: AppointmentType | null;
  appointmentReason: AppointmentReason | null;
  /** 产生原因的绝对游戏日 */
  appearedAtDay: number;
  /** 过期的绝对游戏日 */
  expiresAtDay: number | null;
  acceptedAtDay: number | null;
  rejectedAtDay: number | null;
  resolvedAtDay: number | null;
  cancelledAtDay: number | null;
  requiresSelection: boolean;
  eligibilityConditions: ConditionExpression[];
  finalOutcome: 'appointed' | 'continued_observation' | 'not_selected' | 'withdrawn' | null;
  /** 产生原因描述 */
  reason: string;
}

/** 职业机会来源。 */
export interface CareerOpportunitySource {
  sourceType: 'assessment' | 'political_cycle' | 'event' | 'policy' | 'vacancy' | 'system';
  sourceId: string;
  signalId: string | null;
  description: string;
}

/** 机会创建时冻结的目标职位快照。 */
export interface CareerOpportunityTargetSnapshot {
  positionId: string;
  positionName: string;
  institutionId: string;
  institutionName: string;
  regionId: string;
  institutionLevel: InstitutionLevel;
  positionDomain: PositionDomain;
  leadershipRank: LeadershipRank;
}

/** 职业流程阶段结果（明确结构，非开放 Record） */
export type CareerProcessType =
  'leadership_selection' | 'appointment_review' | 'probation' | 'temporary_assignment' | 'training';
export type CareerProcessStatus = 'active' | 'completed' | 'failed' | 'cancelled';
export type CareerProcessStage =
  | 'eligibility_review'
  | 'democratic_recommendation'
  | 'organization_inspection'
  | 'collective_decision'
  | 'public_notice'
  | 'appointment'
  | 'probation'
  | 'finalization';
export interface CareerProcessStageResult {
  stage: CareerProcessStage;
  resolvedAtDay: number;
  outcome: 'passed' | 'failed' | 'continued' | 'cancelled';
  score: number | null;
  detail: string;
}

/** 进行中的职业流程（如选拔、考察） */
export interface CareerProcess {
  id: string;
  type: CareerProcessType;
  status: CareerProcessStatus;
  /** 关联的机会 ID */
  opportunityId: string;
  /** 当前阶段 */
  currentStage: CareerProcessStage;
  /** 开始日 */
  startedAtDay: number;
  completedAtDay: number | null;
  stageResults: CareerProcessStageResult[];
}

/** 职业状态（PlayerSave 子状态） */
export interface CareerState {
  /** 当前任职 */
  appointment: CurrentAppointment;
  /** 公务员职级（属于人物，不随职位变化） */
  civilServiceRank: CivilServiceRank;
  /** 当前职级生效的绝对游戏日。 */
  civilServiceRankStartedAtDay: number;
  civilServiceRankHistory: CivilServiceRankChangeRecord[];
  restrictions: CareerRestriction[];
  /** 职业履历 */
  experiences: CareerExperience[];
  /** 专业能力（领域 ID → 熟练度） */
  specialties: Record<string, number>;
  /** 当前可用的职业机会 */
  opportunities: CareerOpportunity[];
  /** 进行中的职业流程 */
  activeProcess: CareerProcess | null;
}
