/**
 * 玩家存档类型定义（Schema 11）
 *
 * PlayerSave 重构为正式子状态结构：
 * - character：角色基础信息和属性
 * - time：游戏时间
 * - career：职业与任职（新模型）
 * - governance：政策与治理
 * - events：事件运行时
 * - world：世界状态
 * - organization：NPC 干部、实际席位、动态空缺与世界级选拔
 * - actions：行动运行时（保留）
 * - assessments：考核（保留）
 *
 * 已删除的旧职业事实来源：
 * - currentPositionId / currentLevel / currentCareerLine
 * - yearsInCurrentPosition / promotionStage / promotionAttempts
 * - promotionState / transferCount / isLineLocked / endgameReached
 */

import type { TimeGranularity } from './enums';
import type { FiveDimensionScore, ActionRuntimeSnapshot } from './game';
import type { ActionCategory, ActionTemplate, GameConfig, PersonalTaskTemplate } from './config';
import type { CareerState } from '../domain/career/state';
import type { OrganizationState } from './organization';
import type { GovernanceState } from '../domain/governance/state';
import type { EventRuntimeState } from '../domain/events/state';
import type { WorldState } from '../domain/world-state';

// ===== 行动运行时（保留） =====

/** 槽位等级 key */
export type SlotTierKey = 'primary' | 'secondary' | 'reserve';

/**
 * 个人任务在槽位/快照中使用的保留部门 ID。
 *
 * 个人任务不属于任何真实部门：占用记录以它作为 deptId 哨兵，
 * KPI 贡献写入以它为键的隐藏台账（参与现有 KPI 聚合，不暴露治理 UI）。
 */
export const PERSONAL_TASK_LEDGER_ID = 'personal_work';

/** 部门行动启动时冻结的完整可执行快照。 */
export interface DepartmentActionExecutableSnapshot {
  /** 创建快照时的内容包版本。 */
  contentVersion: string;
  /** 部门显示与稳定标识快照。 */
  department: {
    id: string;
    name: string;
  };
  /** 完整行动定义；完成时不得重新读取当前内容配置。 */
  action: ActionTemplate;
  /** 行动效果结算使用的属性边界；防止内容版本变化改变钳制结果。 */
  attributeBounds: GameConfig['attributeBounds'];
}

/** 个人任务启动时冻结的完整可执行快照。 */
export interface PersonalTaskExecutableSnapshot {
  /** 创建快照时的内容包版本。 */
  contentVersion: string;
  /** 固定为个人任务台账哨兵 { id: PERSONAL_TASK_LEDGER_ID, name: '个人任务' }。 */
  department: {
    id: typeof PERSONAL_TASK_LEDGER_ID;
    name: string;
  };
  /** 完整任务定义；完成时不得重新读取当前内容配置。 */
  task: PersonalTaskTemplate;
  /** 任务效果结算使用的属性边界；防止内容版本变化改变钳制结果。 */
  attributeBounds: GameConfig['attributeBounds'];
}

/**
 * 行动可执行快照：按快照内是否携带 `task` 判别部门行动与个人任务。
 * 完成事务据此分流结算，两者共用槽位调度与时间轴。
 */
export type ActionExecutableSnapshot =
  DepartmentActionExecutableSnapshot | PersonalTaskExecutableSnapshot;

/** 槽位占用记录 */
export interface SlotOccupant {
  /** 稳定行动实例 ID */
  instanceId: string;
  actionId: string;
  deptId: string;
  actionName: string;
  /** 行动启动时冻结的职位 ID */
  originPositionId: string;
  /** 行动启动时冻结的机构 ID */
  originInstitutionId: string;
  /** 行动启动时冻结的地区 ID */
  originRegionId: string;
  /** 启动时的行动分类快照 */
  category: ActionCategory;
  startedAtDay: number;
  durationDays: number;
  /** 启动时的冷却天数快照 */
  cooldownDays: number;
  /** 启动时冻结的完整行动执行语义。 */
  executableSnapshot: ActionExecutableSnapshot;
  /** 行动启动时的理念偏离快照 */
  runtimeSnapshot?: ActionRuntimeSnapshot;
}

/** 单个槽位等级组 */
export interface SlotTierGroup {
  label: string;
  count: number;
  occupants: (SlotOccupant | null)[];
}

/** 行动槽位状态 */
export interface SlotState {
  primary: SlotTierGroup;
  secondary: SlotTierGroup;
  reserve: SlotTierGroup;
}

/** 行动完成通知 */
export interface CompletedActionNotification {
  actionName: string;
  deptName: string;
  effects: string[];
  completedAtDay: number;
}

/** 单个部门的运行时状态 */
export interface DepartmentState {
  id: string;
  kpiValues: Record<string, number>;
  monthlyConsumption: number;
  cumulativeConsumption: number;
  lastActionDay: number;
  actionCooldownUntilDays: Record<string, number>;
}

/** 个人任务运行时状态（冷却、完成计数；不占用真实部门状态） */
export interface PersonalTaskRuntimeState {
  /** 任务冷却截止绝对日，按任务 ID 记录 */
  cooldownUntilDays: Record<string, number>;
  /** 已完成任务计数，按任务 ID 记录（支撑 once 重复策略） */
  completedCounts: Record<string, number>;
  /** 累计完成任务总数 */
  totalCompleted: number;
}

/** 行动运行时状态（PlayerSave 子状态） */
export interface ActionRuntimeState {
  slots: SlotState;
  departmentStates: Record<string, DepartmentState>;
  totalActions: number;
  lastCompletedActions: CompletedActionNotification[];
  /** 个人任务制运行时状态 */
  personalTasks: PersonalTaskRuntimeState;
}

// ===== 考核状态（保留） =====

/** 年度考核记录 */
export interface AnnualAssessmentRecord {
  year: number;
  score: number;
  tier: string;
  dimensions?: FiveDimensionScore;
}

/** 考核状态（PlayerSave 子状态） */
export interface AssessmentState {
  comprehensiveScore: number;
  annualAssessments: AnnualAssessmentRecord[];
}

// ===== 角色状态 =====

/** 角色基础信息（建档时确定） */
export interface CharacterState {
  saveId: string;
  userId: string;
  characterName: string;
  gender: '男' | '女';
  birthPlace: { province: string; city: string };
  birthYear: number;
  gaokaoScore: number;
  gaokaoTier: string;
  university: string;
  universityTier: string;
  familyBackground: 'peasant' | 'worker' | 'merchant' | 'cadre' | 'academic';
  promotionPath: 'xuandiao' | 'gongwuyuan' | 'junzhuan' | 'guoqi';
  isPreparatory: boolean;

  // 核心属性
  vigor: number;
  /** 弃用属性，新模型不再依赖 */
  politicalCapital: number;
  integrity: number;
  stability: number;
  performance: number;
  charisma: number;
  competence: number;
  network: number;
  diligence: number;
  ambition: number;
  corruptionRisk: number;
  isUnderInvestigation: boolean;

  // 从政理念
  philosophy: { scores: Record<string, number> };

  // 人脉
  relations: {
    classmates: Record<string, number>;
    colleagues: Record<string, number>;
    business: Record<string, number>;
    academic: Record<string, number>;
    media: Record<string, number>;
    central: Record<string, number>;
  };
}

// ===== 游戏时间 =====

/** 游戏内时间 */
export interface GameTime {
  year: number;
  month: number;
  day: number;
  granularity: TimeGranularity;
}

/** 时间状态（PlayerSave 子状态） */
export interface GameTimeState extends GameTime {
  totalDaysPlayed: number;
  /** blocking 事件后尚未执行的同日时间轴工作 */
  pendingContinuation: TimelineContinuation | null;
}

/** 可持久化的同日时间轴节点。 */
export type TimelineContinuationNode =
  | { type: 'probation_evaluation'; absoluteDay: number }
  | { type: 'career_opportunity_expiry'; absoluteDay: number }
  | { type: 'scheduled_event_activation'; absoluteDay: number }
  | { type: 'event_deadline'; absoluteDay: number }
  | { type: 'monthly_settlement'; absoluteDay: number; month: number; year: number }
  | { type: 'annual_assessment'; absoluteDay: number; year: number }
  | { type: 'political_cycle'; absoluteDay: number; year: number }
  | { type: 'retirement_check'; absoluteDay: number };

/** blocking 事件暂停的同日时间轴工作。 */
export interface TimelineContinuation {
  /** continuation 所属绝对日，必须等于当前时间绝对日 */
  absoluteDay: number;
  /** 按固定同日优先级保存的尚未执行节点 */
  remainingNodes: TimelineContinuationNode[];
}

// ===== 新版 PlayerSave =====

/**
 * 玩家存档（Schema 11）
 *
 * 重构为正式子状态结构，删除旧职业事实来源。
 */
export interface PlayerSave {
  /** 角色基础信息和属性 */
  character: CharacterState;
  /** 游戏时间 */
  time: GameTimeState;
  /** 职业与任职 */
  career: CareerState;
  /** 政策与治理 */
  governance: GovernanceState;
  /** 事件运行时 */
  events: EventRuntimeState;
  /** 世界状态 */
  world: WorldState;
  /** NPC 干部、实际席位、动态空缺与世界级选拔。 */
  organization: OrganizationState;
  /** 行动运行时 */
  actions: ActionRuntimeState;
  /** 考核 */
  assessments: AssessmentState;

  // ===== 元数据 =====
  /** 剩余预算（万元） */
  remainingBudget: number;
  /** Unix 时间戳，用于存档仲裁 */
  updatedAt: number;
}
