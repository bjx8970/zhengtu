/**
 * 玩家存档类型定义
 *
 * PlayerSave 是整个游戏状态的完整快照，可序列化到 Supabase JSONB 列。
 * 其中包含：
 * - 基础角色信息（建档时确定，不变）
 * - 当前职位与资源
 * - 五大核心属性
 * - 派生系统状态（部门、秘书、人脉、派系……）
 * - 统计与元数据
 */

import type {
  CareerLine,
  PromotionStage,
  OrgInspectResult,
  ReserveCadreTier,
  SecretaryLevel,
  TimeGranularity,
} from './enums';
import type { FiveDimensionScore } from './game';
import type { ActionCategory } from './config';

/** 槽位等级 key */
export type SlotTierKey = 'primary' | 'secondary' | 'reserve';

/** 槽位占用记录 */
export interface SlotOccupant {
  actionId: string;
  deptId: string;
  actionName: string;
  /** 启动时的行动分类快照，避免执行期间配置变化影响结算 */
  category: ActionCategory;
  startedAtDay: number;
  durationDays: number;
  /** 启动时的冷却天数快照 */
  cooldownDays: number;
}

/** 单个槽位等级组 */
export interface SlotTierGroup {
  label: string;
  count: number;
  occupants: (SlotOccupant | null)[];
}

/** 行动槽位状态（三级：主要/次要/备用） */
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
  /** KPI 当前值：kpiId → 当前数值 */
  kpiValues: Record<string, number>;
  monthlyConsumption: number;
  cumulativeConsumption: number;
  /** 最近一次行动的日期（用于活跃度追踪，Phase 2 引入） */
  lastActionDay: number;
  /** 行动 ID → 可再次启动的绝对游戏日 */
  actionCooldownUntilDays: Record<string, number>;
}

/** 秘书运行时状态 */
export interface SecretaryState {
  id: string;
  name: string;
  experience: number;
  level: SecretaryLevel;
}

/** 职业履历中的一条记录 */
export interface CareerRecord {
  positionId: string;
  positionName: string;
  level: number;
  careerLine: CareerLine;
  startYear: number;
  /** null 表示当前在职 */
  endYear: number | null;
  assessmentResults: {
    year: number;
    score: number;
    tier: string;
    dimensions?: FiveDimensionScore;
  }[];
  /** 跨线转职后旧线索封存 */
  archived: boolean;
}

/** 六类人脉关系网络：NPC id → 关系值（0~100） */
export interface RelationState {
  classmates: Record<string, number>;
  colleagues: Record<string, number>;
  business: Record<string, number>;
  academic: Record<string, number>;
  media: Record<string, number>;
  central: Record<string, number>;
}

/** 从政理念风格评分 */
export interface LeadershipStyleState {
  /** 各风格评分值（0~100），非互斥非归属，仅反映数值倾向 */
  scores: Record<string, number>;
}

/** 接班人培养状态 */
export interface SuccessorState {
  id: string | null;
  name: string;
  /** 已投入的关注值 */
  investment: number;
  /** 接位准备度（0~100，≥70 为合格） */
  readiness: number;
}

/** 游戏内时间 */
export interface GameTime {
  year: number;
  /** 1~12 */
  month: number;
  /** 1~30（每月固定30天） */
  day: number;
  /** 当前选择的推进粒度 */
  granularity: TimeGranularity;
}

/** 晋升流程的跨阶段累积状态（非 null 时表示晋升进行中） */
export interface PromotionState {
  /** 目标职位 ID */
  targetPositionId: string;
  /** 目标级别 */
  targetLevel: number;
  /** 当前所处的晋升阶段 */
  currentStage: PromotionStage;
  /** 各阶段的中间结果 */
  stageResults: {
    democraticVotes?: number;
    inspectionResult?: OrgInspectResult;
    reviewPassedDepts?: string[];
    reviewFailedDepts?: string[];
    committeeForVotes?: number;
    committeeAgainstVotes?: number;
    hasComplaint?: boolean;
    sentimentEscalated?: boolean;
  };
  /** 民主推荐阶段触发的风险标记 */
  flaggedForRisk?: boolean;
}

/**
 * 玩家存档（完整游戏状态）
 *
 * 序列化：unwrap(state) → JSON → Supabase JSONB
 * 反序列化：JSON.parse → setState()
 */
export interface PlayerSave {
  // ===== 基础信息 =====
  saveId: string;
  userId: string;
  characterName: string;
  gender: '男' | '女';
  /** 出生地 */
  birthPlace: { province: string; city: string };
  /** 游戏内出生年份，用于计算年龄和退休 */
  birthYear: number;
  /** 高考分数（2008年） */
  gaokaoScore: number;
  /** 高考录取档次 */
  gaokaoTier: string;
  /** 毕业院校名称 */
  university: string;
  /** 院校档次选择 */
  universityTier: string;
  /** 家庭背景 */
  familyBackground: 'peasant' | 'worker' | 'merchant' | 'cadre' | 'academic';
  /** 晋升通道 */
  promotionPath: 'xuandiao' | 'gongwuyuan' | 'junzhuan' | 'guoqi';
  /** 是否为少数民族预科班 */
  isPreparatory: boolean;

  // ===== 当前职位 =====
  currentPositionId: string;
  currentLevel: number;
  currentCareerLine: CareerLine;
  yearsInCurrentPosition: number;

  // ===== 资源（行动队列 + 属性） =====
  slots: SlotState;
  /** 体魄（0~100），备用槽位扣减 */
  vigor: number;
  /** 政治资本（0~500） */
  politicalCapital: number;
  /** 剩余预算（万元） */
  remainingBudget: number;

  // ===== 考核 =====
  comprehensiveScore: number;
  annualAssessments: {
    year: number;
    score: number;
    tier: string;
    dimensions?: FiveDimensionScore;
  }[];

  // ===== 九大核心属性 =====
  integrity: number;
  stability: number;
  performance: number;
  charisma: number;
  competence: number;
  /** 人脉聚合值（0~100，由 relations 六类关系加权派生） */
  network: number;
  /** 勤勉（0~100），反映工作投入度 */
  diligence: number;

  // ===== 晋升 =====
  promotionStage: PromotionStage;
  promotionAttempts: number;
  /** 晋升冻结候选期数 */
  frozenPeriods: number;
  /** 当前晋升流程的跨阶段累积状态（null 表示无进行中的晋升） */
  promotionState: PromotionState | null;

  // ===== 转职 =====
  /** 剩余可用的跨线转职次数 */
  transferCount: number;
  /** 副厅级后锁定 */
  isLineLocked: boolean;

  // ===== 部门状态 =====
  departmentStates: Record<string, DepartmentState>;

  // ===== 职业履历 =====
  careerHistory: CareerRecord[];

  // ===== 秘书 =====
  secretary: SecretaryState | null;

  // ===== 人脉与从政理念 =====
  relations: RelationState;
  philosophy: LeadershipStyleState;
  reserveTier: ReserveCadreTier;
  /** 怀抱（0~100，进取心指标，旧档消沉值反转为 100-demoralization） */
  ambition: number;

  // ===== 风险 =====
  /** 贪腐风险值（0~100，越高越容易被双规） */
  corruptionRisk: number;
  isUnderInvestigation: boolean;

  // ===== 游戏时间 =====
  time: GameTime;

  // ===== 高级系统（级别 12+ 解锁） =====
  successor: SuccessorState | null;
  thinkTank: { science: string | null; economics: string | null; law: string | null };
  mentees: { id: string; progress: number }[];

  // ===== 成就与统计 =====
  achievements: string[];
  totalActions: number;
  totalDaysPlayed: number;
  /** 最近完成的行动通知列表（最多保留 5 条） */
  lastCompletedActions: CompletedActionNotification[];

  // ===== 终局状态 =====
  /** 终局状态（L11 达成后激活） */
  endgameReached: boolean;

  /** Phase C: 待处理的风格冲突标记（START_ACTION 设置，ADVANCE_TIME 消费后清除） */
  pendingStyleConflict?: boolean;

  /** Phase C: START_ACTION 阶段的偏离乘数，ADVANCE_TIME 中应用并清除 */
  _pendingDeviationMultiplier?: number;

  // ===== 元数据 =====
  /** Unix 时间戳，用于本地/远程存档仲裁 */
  updatedAt: number;
}
