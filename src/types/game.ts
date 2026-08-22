/**
 * 游戏运行时类型定义
 *
 * 这些类型不持久化到存档，而是作为引擎函数的参数/返回值使用。
 * 与 player.ts 的区别：
 * - player.ts：存档中存储的持久状态（PlayerSave）
 * - game.ts：引擎计算过程中的中间数据结构
 */

import type { FileType, FileCategory, SentimentType, InvestigationEvidence } from './enums';
import type { KPITier } from './enums';
import type { PlayerSave, SlotTierKey, SlotOccupant, SlotState } from './player';
import type { ActionTemplate, PersonalTaskTemplate } from './config';

/** Store 可接受的全部游戏动作。 */
export type GameAction =
  | { type: 'NEW_GAME'; data: Record<string, unknown> }
  | { type: 'LOAD_SAVE'; save: PlayerSave }
  | {
      type: 'START_ACTION';
      deptId: string;
      actionId: string;
      tierKey: 'primary' | 'secondary' | 'reserve';
      _idFactory?: () => string;
    }
  | {
      type: 'START_PERSONAL_TASK';
      taskId: string;
      tierKey: 'primary' | 'secondary' | 'reserve';
      _idFactory?: () => string;
    }
  | {
      type: 'ADVANCE_TIME';
      granularity: 'day' | 'week' | 'month';
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'CHOOSE_EVENT_OPTION';
      eventInstanceId: string;
      optionId: string;
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'PROPOSE_POLICY';
      policyId: string;
      regionId?: string;
      institutionId?: string;
      _idFactory?: () => string;
    }
  | {
      type: 'APPROVE_POLICY';
      policyInstanceId: string;
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'ACTIVATE_POLICY';
      policyInstanceId: string;
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'SUSPEND_POLICY';
      policyInstanceId: string;
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'RESUME_POLICY';
      policyInstanceId: string;
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'FAIL_POLICY';
      policyInstanceId: string;
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'REPEAL_POLICY';
      policyInstanceId: string;
      _rng?: () => number;
      _idFactory?: () => string;
    }
  | {
      type: 'ADVANCE_CIVIL_SERVICE_RANK';
      sourceType?: 'assessment' | 'event' | 'policy' | 'system';
      sourceId?: string | null;
      sourceAssessmentYear?: number | null;
      _idFactory?: () => string;
      _rng?: () => number;
    }
  | {
      type: 'ACCEPT_CAREER_OPPORTUNITY';
      opportunityId: string;
      _idFactory?: () => string;
      _rng?: () => number;
    }
  | { type: 'REJECT_CAREER_OPPORTUNITY'; opportunityId: string }
  | { type: 'CANCEL_CAREER_OPPORTUNITY'; opportunityId: string }
  | {
      type: 'ADVANCE_CAREER_PROCESS';
      opportunityId: string;
      _idFactory?: () => string;
      _rng?: () => number;
    };

/** 时间推进后触发的周期事件 */
export interface TimeTrigger {
  type:
    | 'monthly_settlement' // 月度预算扣除
    | 'annual_assessment' // 年度考核
    | 'congress_cycle' // 两会/党代会
    | 'retirement_check' // 退休检测
    | 'random_event' // 随机事件
    | 'sentiment_generate'; // 舆情生成（rank4+）
  count?: number;
  year?: number;
  eventId?: string;
  month?: number;
}

/** 游戏内时间坐标（引擎函数使用的不变版本） */
export interface TimeState {
  year: number;
  month: number;
  day: number;
}

/** 时间推进的完整结果 */
export interface TimeAdvanceResult {
  newState: TimeState;
  triggers: TimeTrigger[];
}

/** 行动启动校验输入 */
export interface StartActionInput {
  action: ActionTemplate;
  slotState: SlotState;
  remainingBudget: number;
  currentDay: number;
  deptId: string;
  tierKey: SlotTierKey;
  /** 该部门中此行动当前的绝对冷却截止日，未设置时为 0 */
  cooldownUntilDay: number;
}

/** 行动启动失败结果 */
export interface StartActionFailure {
  success: false;
  error: string;
}

/** 行动启动结果（放入槽位时的校验结果） */
export type StartActionResult =
  StartActionFailure | { success: true; tierKey: SlotTierKey; slotIndex: number };

/** 个人任务启动校验输入 */
export interface PersonalTaskStartInput {
  task: PersonalTaskTemplate;
  slotState: SlotState;
  remainingBudget: number;
  currentDay: number;
  tierKey: SlotTierKey;
  /** 该任务当前的绝对冷却截止日，未设置时为 0 */
  cooldownUntilDay: number;
  /** 该任务已完成的次数（once 策略据此拒绝重复承接） */
  completedCount: number;
}

/** 槽位完成结果：已到期的行动记录 */
export interface CompletedSlotAction {
  tierKey: SlotTierKey;
  slotIndex: number;
  occupant: SlotOccupant;
}

/** 单个 KPI 指标的效果变更 */
export interface KPIEffectChange {
  indicatorId: string;
  operation: 'add' | 'multiply' | 'set';
  delta: number;
}

/** 单个玩家属性的效果变更 */
export interface PlayerEffectChange {
  attr: string;
  operation: 'add' | 'multiply' | 'set';
  delta: number;
}

/** 待处理的公文/文件 */
export interface PendingDocument {
  id: string;
  type: FileType;
  category: FileCategory;
  title: string;
  summary: string;
  /** 四种操作的各自效果 */
  effects: {
    approve: Record<string, number>;
    revise: Record<string, number>;
    reject: Record<string, number>;
    shelve: Record<string, number>;
  };
  /** 批准所需最低能力值 */
  abilityRequired?: number;
}

/** 舆情条目 */
export interface Sentiment {
  id: string;
  type: SentimentType;
  description: string;
  /** 热度指数（0~100） */
  heatIndex: number;
  remainingDays: number;
  resolved: boolean;
}

/** 单个 KPI 指标的计算结果 */
export interface KPIResult {
  indicatorId: string;
  name: string;
  currentValue: number;
  targetValue: number;
  /** 完成率（0~1.5） */
  completionRate: number;
  weight: number;
  /** 加权分 = completionRate × weight × 100 */
  weightedScore: number;
}

/** 德能勤绩廉五维分项得分 */
export interface FiveDimensionScore {
  virtue: number;
  capacity: number;
  diligenceScore: number;
  achievement: number;
  honesty: number;
}

/** 年度考核结果 */
export interface AssessmentResult {
  totalScore: number;
  tier: KPITier;
  indicators: KPIResult[];
}

/** 游戏内日历事件 */
export interface CalendarEvent {
  id: string;
  name: string;
  month: number;
  day: number;
  type: 'holiday' | 'political' | 'personal';
  effects: Record<string, number>;
  description: string;
}

/** 成就定义 */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  /** 判断条件：接受 PlayerSave，返回是否已达成 */
  condition: (save: Record<string, unknown>) => boolean;
}

/** 双规审查的证据强度评估 */
export interface EvidenceStrength {
  totalStrength: number;
  evidenceCount: number;
  /** 证据是否充分到足以定罪（强度 ≥ 70） */
  isOverwhelming: boolean;
}

/** 双规审查的上下文 */
export interface InvestigationContext {
  corruptionRisk: number;
  evidenceCollected: InvestigationEvidence[];
  playerIntegrity: number;
  playerPoliticalCapital: number;
  styleScores: Record<string, number>;
  hasLawyer: boolean;
}

/** 重大议案定义 */
export interface Proposal {
  id: string;
  title: string;
  description: string;
  politicalCapitalCost: number;
  votesNeeded: number;
  effects: Record<string, number>;
  policyUnlocked: string;
}

/** 历史评价结果 */
export interface HistoricalEvaluation {
  economyScore: number;
  livelihoodScore: number;
  integrityScore: number;
  reformScore: number;
  totalScore: number;
  designation: string;
}

/** 退休选项 */
export interface RetirementOption {
  id: string;
  label: string;
  description: string;
  risk?: string;
}

/** Phase C: 风格派生的年度行动记录 */
export interface AnnualActionRecord {
  actionName: string;
  styleAlignment?: string;
}

// ===== 统一时间轴 =====

/** 时间轴事件基础接口 */
interface TimelineEventBase {
  /** 事件发生的绝对游戏日（从游戏开始计算的天数） */
  absoluteDay: number;
}

/** 行动完成时间轴事件 */
export interface ActionCompletionTimelineEvent extends TimelineEventBase {
  type: 'action_completion';
  tierKey: import('./player').SlotTierKey;
  slotIndex: number;
  occupant: import('./player').SlotOccupant;
}

/** 月度结算时间轴事件 */
export interface MonthlySettlementTimelineEvent extends TimelineEventBase {
  type: 'monthly_settlement';
  month: number;
  year: number;
}

/** 年度考核时间轴事件 */
export interface AnnualAssessmentTimelineEvent extends TimelineEventBase {
  type: 'annual_assessment';
  year: number;
}

/** 政治周期时间轴事件（两会/党代会） */
export interface PoliticalCycleTimelineEvent extends TimelineEventBase {
  type: 'political_cycle';
  year: number;
}

/** 退休检测时间轴事件 */
export interface RetirementCheckTimelineEvent extends TimelineEventBase {
  type: 'retirement_check';
}

/** 统一时间轴事件联合类型 */
export type TimelineEvent =
  | ActionCompletionTimelineEvent
  | MonthlySettlementTimelineEvent
  | AnnualAssessmentTimelineEvent
  | PoliticalCycleTimelineEvent
  | RetirementCheckTimelineEvent;

/**
 * 行动运行时快照
 *
 * 在行动启动时计算并绑定到具体 SlotOccupant 实例，
 * 避免多行动并发时共享玩家级临时状态。
 */
export interface ActionRuntimeSnapshot {
  /** 理念偏离效果倍率（1 = 无偏离） */
  effectivenessMultiplier: number;
  /** 是否触发了风格冲突 */
  styleConflictTriggered: boolean;
  /** 行动对应的风格倾向 ID */
  styleAlignment?: string;
}
