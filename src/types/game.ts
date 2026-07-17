/**
 * 游戏运行时类型定义
 *
 * 这些类型不持久化到存档，而是作为引擎函数的参数/返回值使用。
 * 与 player.ts 的区别：
 * - player.ts：存档中存储的持久状态（PlayerSave）
 * - game.ts：引擎计算过程中的中间数据结构
 */

import type {
  FileType,
  FileCategory,
  SentimentType,
  OrgInspectResult,
  PromotionStage,
  Faction,
  InvestigationEvidence,
} from './enums';
import type { KPITier } from './enums';
import type { SlotTierKey, SlotOccupant } from './player';

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

/** 行动启动结果（放入槽位时的校验结果） */
export type StartActionResult =
  { success: false; error: string } | { success: true; tierKey: SlotTierKey; slotIndex: number };

/** 槽位完成结果：已到期的行动记录 */
export interface CompletedSlotAction {
  tierKey: SlotTierKey;
  slotIndex: number;
  occupant: SlotOccupant;
}

/** 随机事件的触发条件 */
export interface EventCondition {
  minLevel?: number;
  maxLevel?: number;
  careerLines?: string[];
  minScore?: number;
  requiredFlag?: string;
}

/** 随机事件的可选应对选项 */
export interface EventOption {
  label: string;
  description: string;
  effects: { target: string; value: number }[];
  risk?: { type: string; probability: number };
}

/** 随机事件定义 */
export interface GameEvent {
  id: string;
  title: string;
  description: string;
  triggerCondition: EventCondition;
  options: EventOption[];
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

/** 事件选项选择后的结算结果 */
export interface EventResolveResult {
  effects: Record<string, number>;
  riskTriggered: boolean;
  detail: string;
}

/** 晋升流程的上下文数据（传入各阶段计算函数） */
export interface PromotionContext {
  playerLevel: number;
  playerScore: number;
  yearsInPosition: number;
  politicalCapital: number;
  corruptionRisk: number;
  factionReputation: Record<Faction, number>;
  relations: { colleagues: Record<string, number> };
  assessmentHistory: { score: number; tier: string }[];
  hasDisciplinaryRecord: boolean;
  hasGrassrootsExperience: boolean;
  hasMultiRegionExperience: boolean;
  charisma: number;
  superiorFavor: number;
  performance: number;
  competence: number;
  integrity: number;
}

/** 晋升流程的阶段性结果 */
export interface PromotionResult {
  stage: PromotionStage;
  passed: boolean;
  details: string;
  voteCount?: number;
  inspectionResult?: OrgInspectResult;
  reviewOpinions?: Record<string, 'pass' | 'fail'>;
  committeeVotes?: { for: number; against: number };
  complaints?: boolean;
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
  factionReputation: Record<Faction, number>;
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
