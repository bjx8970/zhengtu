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
import type { RelativeSelectionConfig } from './config';
import type {
  CivilServiceRank,
  InstitutionLevel,
  LeadershipRank,
  PositionDomain,
} from '../domain/career/types';
import type {
  RelativeSelectionStage,
  RelativeSelectionStageResult,
  SelectionFailure,
  SelectionCandidateStageResult,
} from '../domain/career/state';
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
  | 'initial_opening'
  | 'retirement'
  | 'promotion'
  | 'lateral_transfer'
  | 'rotation'
  | 'disciplinary_exit'
  | 'political_cycle'
  | 'organization_change';

/** Vacancy 进入取消终态时的可审计原因。 */
export type VacancyCancellationReason =
  'organization_change' | 'selection_cancelled' | 'opportunity_withdrawn' | 'expired' | 'system';

/** Vacancy 生命周期状态。 */
export type VacancyStatus = 'open' | 'selecting' | 'filled' | 'cancelled' | 'expired';

/** 创建 Vacancy 的正式 producer 类型。 */
export type VacancySourceType =
  'appointment' | 'cadre_lifecycle' | 'political_cycle' | 'event' | 'system';

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
  status: VacancyStatus;
  sourceType: VacancySourceType;
  sourceId: string;
  closesAtDay: number | null;
  closedAtDay: number | null;
  selectionId: string | null;
  /** 进入 filled 终态时实际占用者；其他状态必须为空。 */
  filledBy: SeatOccupantRef | null;
  /** 进入 filled 终态时的任职实例；其他状态必须为空。 */
  filledAppointmentId: string | null;
  /** 取消/过期终态的原因；open/selecting/filled 必须为空。 */
  cancellationReason: VacancyCancellationReason | null;
}

/** Vacancy 生命周期操作的纯 Engine 输入。 */
export interface VacancyLifecycleInput {
  organization: Readonly<OrganizationState>;
  currentDay: number;
  idFactory: () => string;
}

/** 创建 Vacancy 的输入；producer 可提供固定 vacancyId 以保证重放稳定。 */
export interface OpenVacancyInput extends VacancyLifecycleInput {
  seatId: string;
  reason: VacancyReason;
  sourceType: VacancySourceType;
  sourceId: string;
  closesAtDay: number | null;
  vacancyId?: string;
}

/** 将 Vacancy 置为 selecting 的输入。 */
export interface BeginVacancySelectionInput extends VacancyLifecycleInput {
  vacancyId: string;
  selectionId: string;
}

/** 将 Vacancy 原子填补的输入。 */
export interface FillVacancyInput extends VacancyLifecycleInput {
  vacancyId: string;
  occupant: SeatOccupantRef;
  appointmentId: string;
  transitionId: string;
}

/** 将 Vacancy 取消的输入。 */
export interface CancelVacancyInput extends VacancyLifecycleInput {
  vacancyId: string;
  cancellationReason: VacancyCancellationReason;
}

/** 将到期 Vacancy 置为 expired 的输入。 */
export interface ExpireVacancyInput extends VacancyLifecycleInput {
  vacancyId: string;
}

/** Vacancy Engine 的可诊断业务失败。 */
export type VacancyLifecycleError =
  | 'seat_not_found'
  | 'seat_occupied'
  | 'active_vacancy_exists'
  | 'vacancy_not_found'
  | 'vacancy_terminal'
  | 'selection_not_found'
  | 'selection_mismatch'
  | 'selection_required'
  | 'occupant_missing'
  | 'appointment_missing'
  | 'occupant_appointment_mismatch'
  | 'vacancy_identity_conflict'
  | 'producer_conflict';

/** Vacancy Engine 的判别联合结果；业务失败不抛异常。 */
export type VacancyLifecycleResult =
  | {
      success: true;
      organization: OrganizationState;
      vacancy: VacancyInstance | null;
      emittedSignals: import('../domain/governance/types').DomainSignalSnapshot[];
    }
  | { success: false; error: VacancyLifecycleError; detail: string };

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
  /** Frozen career intervals used for vacancy-specific experience checks. */
  experiences: CareerExperience[];
  assessments: CareerAssessmentRecord[];
  specialties: Record<string, number>;
  restrictionTypes: string[];
  /** 后续相对竞争使用的可重放输入；本 Issue 仅冻结结构。 */
  scoringInputs: Record<string, number>;
}

/** Mutable-world input normalized into the same frozen candidate snapshot. */
export interface SelectionCandidateInput {
  candidateId: string;
  candidateType: 'player' | 'npc';
  currentPositionId: string | null;
  institutionId: string | null;
  regionId: string | null;
  leadershipRank: LeadershipRank;
  civilServiceRank: CivilServiceRank;
  appointmentStartedAtDay: number | null;
  serviceStartedAtDay: number;
  /** Career intervals captured before the selection starts. */
  experiences: CareerExperience[];
  assessments: CareerAssessmentRecord[];
  specialties: Record<string, number>;
  restrictionTypes: string[];
  scoringInputs: Record<string, number>;
}

/** Result of applying the shared candidate qualification rule. */
export interface CandidateEligibilityResult {
  eligible: boolean;
  reason: string | null;
}

/** Vacancy facts used by selection eligibility without retaining a mutable Vacancy. */
export interface SelectionVacancyEligibilityContext {
  vacancyId: string;
  positionId: string;
  institutionId: string;
  regionId: string;
  positionDomain: PositionDomain;
  sourceType: VacancySourceType;
  conflictingCandidateIds: readonly string[];
}

/** Inputs captured once when a Selection is created. */
export interface CreateRelativeSelectionInput {
  selectionId: string;
  vacancyId: string;
  startedAtDay: number;
  candidates: readonly SelectionCandidateInput[];
  rules: RelativeSelectionConfig;
  eligibilityContext: SelectionVacancyEligibilityContext;
  randomDraws: readonly number[];
  playerCareerProcessId?: string | null;
}

/** Input for one deterministic stage transition. */
export interface AdvanceRelativeSelectionInput {
  selection: RelativeStaffingSelection;
  resolvedAtDay: number;
  rules: RelativeSelectionConfig;
}

/** Discriminated result shared by creation and advancement. */
export type RelativeSelectionLifecycleResult =
  | { success: true; selection: RelativeStaffingSelection }
  | {
      success: false;
      error: 'invalid_stage' | 'rules_mismatch' | 'invalid_random_draws';
      detail: string;
    };

/** 世界级选拔的阶段审计。 */
export interface StaffingSelectionStageAudit {
  stage: RelativeSelectionStage;
  resolvedAtDay: number;
  survivingCandidateIds: string[];
  detail: string;
  candidates?: SelectionCandidateStageResult[];
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
  /** Frozen ruleset identity used to interpret every stage result. */
  rulesVersion?: string;
  /** Structured stage audit; present for selections created by the new Engine. */
  stageResults?: RelativeSelectionStageResult[];
  /** Stable winner ID, independent of occupant/appointment transactions. */
  winnerId?: string | null;
  /** Structured terminal failure when no winner exists. */
  failure?: SelectionFailure | null;
}

/** Strong Selection contract emitted and consumed by the relative-selection Engine. */
export interface RelativeStaffingSelection extends StaffingSelection {
  rulesVersion: string;
  stageResults: RelativeSelectionStageResult[];
  winnerId: string | null;
  failure: SelectionFailure | null;
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
