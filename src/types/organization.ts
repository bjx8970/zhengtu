/**
 * Phase 4 组织世界持久化类型。
 *
 * 组织状态只保存会影响任职、空缺、选拔和审计的干部事实；玩家自己的
 * 职业事实继续由 CareerState 持有，通过 Seat occupant 引用接入同一世界。
 */

import type {
  CareerAssessmentRecord,
  CareerExperience,
  CareerRestriction,
  CurrentAppointment,
} from '../domain/career/state';
import type {
  CivilServiceRank,
  InstitutionLevel,
  LeadershipRank,
  PositionDomain,
} from '../domain/career/types';
import type { InstitutionConfig, PositionConfigV2 } from './position-v2';

/** 组织席位的占用者引用。 */
export type SeatOccupantRef = { type: 'player'; id: 'player' } | { type: 'npc'; id: string };

/** NPC 干部的最小持久化职业档案。 */
export interface CadreProfile {
  cadreId: string;
  name: string;
  gender: '男' | '女';
  /** 出生年是年龄的稳定派生依据，年龄本身不重复持久化。 */
  birthYear: number;
  civilServiceRank: CivilServiceRank;
  civilServiceRankStartedAtDay: number;
  currentAppointment: CurrentAppointment | null;
  experiences: CareerExperience[];
  assessments: CareerAssessmentRecord[];
  specialties: Record<string, number>;
  restrictions: CareerRestriction[];
  status: 'active' | 'retired' | 'exited';
  exitedAtDay: number | null;
  exitReason: string | null;
}

/** 配置中用于确定性建立 NPC 干部池的模板。 */
export interface CadreTemplate {
  cadreId: string;
  name: string;
  gender: '男' | '女';
  birthYear: number;
  civilServiceRank: CivilServiceRank;
  /** 初始目标职位；若玩家已占据该职位，干部以未任职状态进入干部池。 */
  positionId: string;
  /** 为既有玩家纵向路径预留席位时，干部仅作为未任职候选进入生态。 */
  initiallyUnassigned?: boolean;
  specialties: Record<string, number>;
}

/** 实际岗位席位，而不是职位配置中的抽象空缺数量。 */
export interface OrganizationSeat {
  seatId: string;
  positionId: string;
  positionNameSnapshot: string;
  institutionId: string;
  institutionNameSnapshot: string;
  regionId: string;
  institutionLevel: InstitutionLevel;
  positionDomain: PositionDomain;
  leadershipRank: LeadershipRank;
  occupant: SeatOccupantRef | null;
  currentAppointmentId: string | null;
  occupiedAtDay: number | null;
  /** 最近一次改变占用事实的任职或流动事务；初始化时为 null。 */
  sourceTransitionId: string | null;
}

/** 动态岗位空缺的来源原因。 */
export type VacancyReason =
  | 'retirement'
  | 'promotion'
  | 'lateral_transfer'
  | 'rotation'
  | 'disciplinary_exit'
  | 'political_cycle'
  | 'organization_change';

/** 动态岗位空缺实例。 */
export interface VacancyInstance {
  vacancyId: string;
  seatId: string;
  positionId: string;
  positionNameSnapshot: string;
  institutionId: string;
  institutionNameSnapshot: string;
  regionId: string;
  institutionLevel: InstitutionLevel;
  positionDomain: PositionDomain;
  leadershipRank: LeadershipRank;
  openedAtDay: number;
  reason: VacancyReason;
  status: 'open' | 'selecting' | 'filled' | 'cancelled' | 'expired';
  sourceType: 'appointment' | 'cadre_lifecycle' | 'political_cycle' | 'event' | 'system';
  sourceId: string;
  closesAtDay: number | null;
  closedAtDay: number | null;
  selectionId: string | null;
}

/** NPC 离任事实账本；只追加、不回写，供后续 Vacancy producer 消费。 */
export interface CadreDepartureFact {
  departureId: string;
  cadreId: string;
  /** 未任职退出时为空；此事实不产生 Vacancy。 */
  appointmentId: string | null;
  /** 未任职退出时为空。 */
  experienceId: string | null;
  /** 未任职退出时为空；消费者必须以此字段区分是否释放 Seat。 */
  seatId: string | null;
  positionId: string | null;
  institutionId: string | null;
  regionId: string | null;
  occurredAtDay: number;
  reason: 'retirement' | 'disciplinary_exit';
  sourceType: 'cadre_lifecycle';
}

/** 选拔开始时冻结的玩家或 NPC 候选职业事实。 */
export interface SelectionCandidateSnapshot {
  candidateId: string;
  candidateType: 'player' | 'npc';
  currentPositionId: string | null;
  institutionId: string | null;
  regionId: string | null;
  leadershipRank: LeadershipRank;
  civilServiceRank: CivilServiceRank;
  appointmentStartedAtDay: number | null;
  serviceStartedAtDay: number;
  assessments: CareerAssessmentRecord[];
  specialties: Record<string, number>;
  restrictionTypes: string[];
  /** 后续相对竞争使用的可重放输入；本 Issue 仅冻结结构。 */
  scoringInputs: Record<string, number>;
}

/** 世界级选拔的阶段审计。 */
export interface StaffingSelectionStageAudit {
  stage:
    | 'eligibility_review'
    | 'democratic_recommendation'
    | 'organization_inspection'
    | 'collective_decision'
    | 'public_notice'
    | 'appointment';
  resolvedAtDay: number;
  survivingCandidateIds: string[];
  detail: string;
}

/** 一个 Vacancy 对应的世界级选拔状态。 */
export interface StaffingSelection {
  selectionId: string;
  vacancyId: string;
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'failed';
  currentStage: StaffingSelectionStageAudit['stage'];
  startedAtDay: number;
  completedAtDay: number | null;
  candidates: SelectionCandidateSnapshot[];
  stageAudits: StaffingSelectionStageAudit[];
  winner: SeatOccupantRef | null;
  /** 关联玩家可见 CareerProcess；纯 NPC 选拔为 null。 */
  playerCareerProcessId: string | null;
  /** 创建选拔时冻结的随机输入，刷新后不得重新抽取。 */
  randomDraws: number[];
}

/** PlayerSave 中独立于玩家 CareerState 的组织世界状态。 */
export interface OrganizationState {
  initializedAtDay: number;
  cadres: CadreProfile[];
  seats: OrganizationSeat[];
  vacancies: VacancyInstance[];
  selections: StaffingSelection[];
  /** 已结束任职的不可变事实；后续 Vacancy producer 以 departureId/appointmentId 去重。 */
  departures: CadreDepartureFact[];
  /** producer 幂等键；防止 continuation 或刷新后重复创建世界事实。 */
  processedProducerKeys: string[];
}

/** 创建组织世界所需的冻结配置与玩家事实。 */
export interface OrganizationInitializationInput {
  initializedAtDay: number;
  playerAppointment: CurrentAppointment;
  cadreTemplates: readonly CadreTemplate[];
  positions: readonly PositionConfigV2[];
  institutions: readonly InstitutionConfig[];
}
