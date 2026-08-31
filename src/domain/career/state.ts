/**
 * 职业持久化状态
 *
 * 定义 CareerState 及其子结构：
 * - CurrentAppointment：当前或刚结束的任职事实
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
import type { EffectDefinition } from '../conditions';
import type { DomainSignalSnapshot } from '../governance/types';

/** 当前或刚结束的任职事实。 */
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
  /** 任职是否仍在持续；ended 是职业阶段终局，不再存在开放履历。 */
  status: 'active' | 'ended';
  /** 任职结束的绝对游戏日；仅 ended 状态有值。 */
  endedAtDay: number | null;
  /** 任职结束原因；仅 ended 状态有值。 */
  endReason: AppointmentEndReason | null;
  /** 本次任职的试用期事实；非试用任职为 null。 */
  probation: AppointmentProbation | null;
}

/** 试用期评估的可审计结果。 */
export interface ProbationEvaluationRecord {
  evaluatedAtDay: number;
  outcome: 'passed' | 'extended' | 'failed';
  score: number;
  completedActionCount: number;
  unmetRequirements: string[];
  previousEndsAtDay: number;
  nextEndsAtDay: number | null;
}

/** 当前任职的试用期生命周期。 */
export interface AppointmentProbation {
  status: 'active' | 'passed' | 'failed';
  startedAtDay: number;
  endsAtDay: number;
  extensionCount: number;
  completedActionCount: number;
  resolvedAtDay: number | null;
  outcomeReason: string | null;
  evaluations: ProbationEvaluationRecord[];
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
  /** 与当前/历史任职实例一一对应的稳定 ID。 */
  appointmentId: string;
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
  /** 任职类型。 */
  appointmentType: AppointmentType;
  /** 产生任职的机会；初始任职为 null。 */
  sourceOpportunityId: string | null;
  /** 结束原因；开放履历必须为 null。 */
  endReason: AppointmentEndReason | null;
  /** 该任期内的考核记录 */
  assessmentResults: CareerAssessmentRecord[];
}

/** 任职区间结束原因。 */
export type AppointmentEndReason =
  | Exclude<AppointmentReason, 'initial_assignment'>
  | 'retirement'
  | 'disciplinary_exit'
  | 'probation_failed';

/** 职业机会共享字段。 */
export interface CareerOpportunityBase {
  /** 唯一 ID */
  id: string;
  /** 配置定义 ID，用于来源去重和历史审计。 */
  definitionId: string;
  /** 机会类型 */
  type: CareerOpportunityType;
  /** 机会状态 */
  status: CareerOpportunityStatus;
  source: CareerOpportunitySource;
  /** 关联的真实组织 Vacancy；非 Vacancy 机会为 null。 */
  vacancyId: string | null;
  /**
   * 创建机会时冻结的完整触发信号。后续资格复核和培训效果必须使用此快照，
   * 而不能从可变的当前状态推断一个信号。
   *
   * 旧存档在该字段加入前创建的机会没有可恢复的载荷，因此保留 null。
   */
  sourceSignal: DomainSignalSnapshot | null;
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
  finalOutcome:
    | 'appointed'
    | 'continued_observation'
    | 'not_selected'
    | 'training_completed'
    | 'withdrawn'
    | null;
  /** 产生原因描述 */
  reason: string;
}

/** 需要任职结算的职业机会。 */
export interface AppointmentCareerOpportunity extends CareerOpportunityBase {
  type: Exclude<CareerOpportunityType, 'training'>;
  target: CareerOpportunityTargetSnapshot;
  appointmentType: AppointmentType;
  appointmentReason: AppointmentReason;
}

/** 不产生任职变化的培训机会。 */
export interface TrainingCareerOpportunity extends CareerOpportunityBase {
  type: 'training';
  target: null;
  appointmentType: null;
  appointmentReason: null;
  trainingDefinitionId: string;
  effects: EffectDefinition[];
}

/** 职业机会判别联合。 */
export type CareerOpportunity = AppointmentCareerOpportunity | TrainingCareerOpportunity;

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

/** Relative selection's immutable six-stage order. */
export const RELATIVE_SELECTION_STAGES = [
  'eligibility_review',
  'democratic_recommendation',
  'organization_inspection',
  'collective_decision',
  'public_notice',
  'appointment',
] as const;

/** Stable stage key used by the relative selection contract. */
export type RelativeSelectionStage = (typeof RELATIVE_SELECTION_STAGES)[number];

/** A structured terminal reason for a selection which cannot appoint anyone. */
export interface SelectionFailure {
  code: 'no_qualified_candidates' | 'stage_no_survivors' | 'no_unique_winner';
  stage: RelativeSelectionStage | null;
  detail: string;
}

/** Frozen per-candidate audit for one relative-selection stage. */
export interface SelectionCandidateStageResult {
  candidateId: string;
  score: number;
  rank: number;
  eliminated: boolean;
}

/** Complete immutable audit result produced when a stage is resolved. */
export interface RelativeSelectionStageResult {
  stage: RelativeSelectionStage;
  resolvedAtDay: number;
  candidates: SelectionCandidateStageResult[];
  survivingCandidateIds: string[];
}
export interface CareerProcessStageResult {
  stage: CareerProcessStage;
  resolvedAtDay: number;
  outcome: 'passed' | 'failed' | 'continued' | 'cancelled';
  score: number | null;
  detail: string;
  /** Relative-selection candidate audit; absent for legacy non-selection processes. */
  candidateResults?: SelectionCandidateStageResult[];
  /** Stable IDs surviving this stage, copied from the Selection audit. */
  survivingCandidateIds?: string[];
}

/** 进行中的职业流程（如选拔、考察） */
export interface CareerProcess {
  id: string;
  type: CareerProcessType;
  status: CareerProcessStatus;
  /** 关联的机会 ID */
  opportunityId: string;
  /** Selection identity; required for relative-selection processes. */
  selectionId?: string;
  /** Vacancy identity; required for relative-selection processes. */
  vacancyId?: string;
  /** 当前阶段 */
  currentStage: CareerProcessStage;
  /** 开始日 */
  startedAtDay: number;
  completedAtDay: number | null;
  stageResults: CareerProcessStageResult[];
  /** Terminal winner or structured failure for relative-selection processes. */
  winnerId?: string | null;
  failure?: SelectionFailure | null;
}

/** 职业状态（PlayerSave 子状态） */
export interface CareerState {
  /** 当前或刚结束的任职事实；status=ended 时表示职业阶段终局。 */
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
  /** 已完成、落选或继续观察的流程，用于保存阶段审计记录。 */
  completedProcesses: CareerProcess[];
}
