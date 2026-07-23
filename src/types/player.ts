/**
 * 玩家存档类型定义（Schema 2）
 *
 * PlayerSave 重构为正式子状态结构：
 * - character：角色基础信息和属性
 * - time：游戏时间
 * - career：职业与任职（新模型）
 * - governance：政策与治理
 * - events：事件运行时
 * - world：世界状态
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
import type { ActionCategory } from './config';
import type { CareerState } from '../domain/career/state';
import type { GovernanceState } from '../domain/governance/state';
import type { EventRuntimeState } from '../domain/events/state';
import type { WorldState } from '../domain/world-state';

// ===== 行动运行时（保留） =====

/** 槽位等级 key */
export type SlotTierKey = 'primary' | 'secondary' | 'reserve';

/** 槽位占用记录 */
export interface SlotOccupant {
  actionId: string;
  deptId: string;
  actionName: string;
  /** 启动时的行动分类快照 */
  category: ActionCategory;
  startedAtDay: number;
  durationDays: number;
  /** 启动时的冷却天数快照 */
  cooldownDays: number;
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

/** 行动运行时状态（PlayerSave 子状态） */
export interface ActionRuntimeState {
  slots: SlotState;
  departmentStates: Record<string, DepartmentState>;
  totalActions: number;
  lastCompletedActions: CompletedActionNotification[];
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
}

// ===== 新版 PlayerSave =====

/**
 * 玩家存档（Schema 2）
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
