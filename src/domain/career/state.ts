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
} from './types';

/** 当前任职状态 */
export interface CurrentAppointment {
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
  /** 试用期结束的绝对游戏日（null 表示无试用期） */
  probationEndsAtDay: number | null;
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
  /** 目标职位 ID */
  targetPositionId: string;
  /** 目标机构 ID */
  targetInstitutionId: string;
  /** 目标地区 ID */
  targetRegionId: string;
  /** 产生原因的绝对游戏日 */
  appearedAtDay: number;
  /** 过期的绝对游戏日 */
  expiresAtDay: number | null;
  /** 产生原因描述 */
  reason: string;
}

/** 职业流程阶段结果（明确结构，非开放 Record） */
export interface CareerProcessStageResults {
  voteFor?: number;
  voteAgainst?: number;
  inspectionResult?: string;
  passed?: boolean;
}

/** 进行中的职业流程（如选拔、考察） */
export interface CareerProcess {
  /** 流程类型 */
  type: 'selection' | 'inspection' | 'probation';
  /** 关联的机会 ID */
  opportunityId: string;
  /** 当前阶段 */
  currentStage: string;
  /** 开始日 */
  startedAtDay: number;
  /** 各阶段结果 */
  stageResults: CareerProcessStageResults;
}

/** 职业状态（PlayerSave 子状态） */
export interface CareerState {
  /** 当前任职 */
  appointment: CurrentAppointment;
  /** 公务员职级（属于人物，不随职位变化） */
  civilServiceRank: CivilServiceRank;
  /** 职业履历 */
  experiences: CareerExperience[];
  /** 专业能力（领域 ID → 熟练度） */
  specialties: Record<string, number>;
  /** 当前可用的职业机会 */
  opportunities: CareerOpportunity[];
  /** 进行中的职业流程 */
  activeProcess: CareerProcess | null;
}
