/**
 * 配置数据类型定义
 *
 * 分为两类：
 * - *Template：JSON 模板中的原始定义（如 ActionTemplate、KPITemplate）
 * - *Config：运行时经过 ConfigLoader 展开后的完整对象（如 DepartmentConfig、PositionConfig）
 * - *Raw：职业线 JSON 中的半展开结构（如 PositionRaw，只存储模板引用 ID）
 *
 * 数据流：JSON 模板 → [Template] → ConfigLoader → [Config] → Engine/UI
 */

import type { CareerLine } from './enums';
import type { SlotTierKey } from './player';
import type { ConditionExpression } from '../domain/conditions';
import type { EffectDefinition } from '../domain/conditions';
import type { PolicyCategory } from '../domain/governance/types';
import type { DomainSignal } from '../domain/governance/types';
import type {
  AppointmentReason,
  AppointmentType,
  CareerOpportunityType,
  CareerRestrictionType,
  CivilServiceRank,
  LeadershipRank,
} from '../domain/career/types';
import type { RelativeSelectionStage } from '../domain/career/state';

/** 单类任职可计入职业履历资格的配置规则。 */
export interface AppointmentTypeExperienceRule {
  appointmentType: AppointmentType;
  countsTowardRegionExperience: boolean;
  minDaysForRegionExperience: number | null;
  countsTowardInstitutionExperience: boolean;
  minDaysForInstitutionExperience: number | null;
  countsTowardDomainExperience: boolean;
  minDaysForDomainExperience: number | null;
  countsTowardLevelExperience: boolean;
  minDaysForLevelExperience: number | null;
}

/** 职业履历资格规则集合，必须为每种任职类型定义且仅定义一次。 */
export interface CareerExperienceQualificationRules {
  appointmentTypes: AppointmentTypeExperienceRule[];
}

/** 行动分类，决定行动冷却规则 */
export type ActionCategory = 'major' | 'minor' | 'routine';

/** 行动效果的单项定义：对某个目标属性施加的操作 */
export interface ActionEffectDef {
  /** 目标标识，格式 "dept.kpi.xxx" 或 "player.xxx" */
  target: string;
  /** 操作类型：加值 / 乘值 / 设为绝对值 */
  operation: 'add' | 'multiply' | 'set';
  /** 固定值（range 存在时此值作备选） */
  value: number;
  /** 可选随机范围，实际值在 [min, max] 间随机 */
  range?: { min: number; max: number };
}

/** 行动模板定义（JSON 中存储，运行时直接引用） */
export interface ActionTemplate {
  id: string;
  name: string;
  description?: string;
  /** 执行所需天数 */
  durationDays: number;
  /** 行动分类 */
  category: ActionCategory;
  /** 行动完成后的冷却天数 */
  cooldownDays: number;
  /** 行动消耗预算（万元） */
  budgetDelta: number;
  /** 执行后对 KPI/属性的影响列表 */
  effects: ActionEffectDef[];
  /** 解锁所需玩家级别 */
  unlockLevel?: number;
  /** 该行动倾向的领导风格 ID（Phase C 新增） */
  styleAlignment?: string;
}

// ===== 个人任务制（无领导职务阶段工作模型） =====

/** 个人任务类型常量数组 */
export const PERSONAL_TASK_TYPES = [
  'drafting', // 材料起草/综合文字
  'data_reporting', // 数据汇总/报表
  'research', // 调研走访
  'public_service', // 群众服务/窗口事项
  'assigned_project', // 上级交办专项
  'training', // 培训学习
] as const;

/** 个人任务类型 */
export type PersonalTaskType = (typeof PERSONAL_TASK_TYPES)[number];

/** 个人任务类型中文标签 */
export const PERSONAL_TASK_TYPE_LABELS: Record<PersonalTaskType, string> = {
  drafting: '材料起草',
  data_reporting: '数据汇总',
  research: '调研走访',
  public_service: '群众服务',
  assigned_project: '上级交办',
  training: '培训学习',
};

/** 个人任务对个人工作 KPI 台账的贡献 */
export interface PersonalTaskKpiEffect {
  /** KPI 指标 ID（须存在于科员岗位部门聚合的指标集内） */
  indicatorId: string;
  operation: 'add' | 'multiply' | 'set';
  value: number;
}

/**
 * 个人任务前置条件（轻量专用形状）。
 *
 * 不复用 ConditionExpression：其评估上下文强制要求触发信号，
 * 而任务承接时机没有信号语义。
 */
export interface PersonalTaskPrecondition {
  /** 允许承接的领导职务等级列表；缺省表示不限 */
  allowedLeadershipRanks?: LeadershipRank[];
  /** 最低公务员职级（按职级序数比较） */
  civilServiceRankMin?: CivilServiceRank;
  /** 累计完成任务数下限 */
  minCompletedTasks?: number;
  /** 必须为 true 的布尔世界事实 ID 列表；false/缺失/非布尔值均视为未满足 */
  requiredFacts?: string[];
}

/** 个人任务模板定义（JSON 中存储，冻结进可执行快照） */
export interface PersonalTaskTemplate {
  id: string;
  name: string;
  type: PersonalTaskType;
  description?: string;
  /** 执行所需天数 */
  durationDays: number;
  /** 任务分类，复用槽位调度规则 */
  category: ActionCategory;
  /** 完成后的冷却天数 */
  cooldownDays: number;
  /** 任务消耗预算（万元） */
  budgetDelta: number;
  /** 完成时经统一效果执行器原子应用的效果 */
  effects: EffectDefinition[];
  /** 完成时写入个人工作 KPI 台账的贡献（隐藏台账，随任命变更重置） */
  kpiEffects?: PersonalTaskKpiEffect[];
  /** 可选前置条件 */
  prerequisites?: PersonalTaskPrecondition;
  /** once = 整局仅可完成一次；repeatable = 受冷却与槽位约束可重复 */
  repeatPolicy: 'once' | 'repeatable';
  /**
   * 是否允许同 ID 实例并行（首份完成前再次承接）。
   * 缺省按分类推导：routine 可并行、major/minor 不可；
   * once 任务恒不允许并行（契约优先，配置该字段为 true 会被 Schema 拒绝）。
   */
  allowParallel?: boolean;
}

/** KPI 指标模板 */
export interface KPITemplate {
  id: string;
  name: string;
  /** 目标值 */
  targetValue: number;
  /** 权重（0~1），同组所有权重之和应 ≈ 1 */
  weight: number;
  /** 单位 */
  unit: '%' | '万元' | '分' | '次' | '个';
  /**
   * 计算类型：
   * - ratio：完成率 = current / target
   * - absolute：直接取值
   * - inverse：反向指标，完成率 = (target - current) / target
   */
  calcType: 'ratio' | 'absolute' | 'inverse';
}

/** 部门模板（JSON 定义，ConfigLoader 展开后生成 DepartmentConfig） */
export interface DepartmentTemplate {
  name: string;
  /** 资金消耗系数（相对基础消耗的倍数） */
  consumptionCoefficient: number;
  /** 基础月消耗（万元） */
  baseConsumption: number;
  actions: ActionTemplate[];
  /** 引用的 KPI 模板 ID 列表 */
  kpiTemplateIds: string[];
}

/** 部门运行时配置（展开了 kpiTemplateIds 为完整 KPIIndicator） */
export interface DepartmentConfig {
  id: string;
  name: string;
  consumptionCoefficient: number;
  baseConsumption: number;
  actions: ActionTemplate[];
  /** 展开后的完整 KPI 指标 */
  kpiIndicators: KPITemplate[];
}

/** 职位半展开定义（JSON 中存储，存储模板引用 ID 而非完整模板） */
export interface PositionRaw {
  id: string;
  name: string;
  /** 引用的部门模板 ID 列表 */
  departmentTemplateIds: string[];
  /** 引用的 KPI 模板 ID 列表 */
  kpiTemplateIds: string[];
  annualBudget: number;
  /** 按部门模板 ID 的覆盖配置 */
  deptOverrides?: Record<string, Partial<DepartmentConfig>>;
}

/** 晋升门槛条件 */
export interface PromotionRequirement {
  minYearsInService: number;
  minAssessmentPasses: number;
  politicalConditions: string[];
  specialConditions?: string[];
  canBreakRules?: boolean;
}

/** 级别半展开定义（JSON 中存储） */
export interface LevelRaw {
  level: number;
  label: string;
  positions: PositionRaw[];
  promotionRequirements: PromotionRequirement;
}

/** 职业线配置（JSON 中存储） */
export interface CareerLineConfig {
  id: CareerLine;
  name: string;
  color: string;
  description: string;
  privileges: string[];
  levels: LevelRaw[];
}

/** 职位完整配置（ConfigLoader 完全展开后使用） */
export interface PositionConfig {
  id: string;
  name: string;
  level: number;
  careerLine: CareerLine;
  departments: DepartmentConfig[];
  kpiIndicators: KPITemplate[];
  annualBudget: number;
}

/** 单个槽位等级配置 */
export interface SlotTierConfig {
  label: string;
  count: number;
  description: string;
}

/** 各等级槽位配置 */
export type SlotTiersConfig = Record<SlotTierKey, SlotTierConfig>;

/** 晋升引擎配置常量 */
export interface PromotionConfig {
  democraticVote: {
    passThreshold: number;
    connectionsBonus: number;
    connectionsRiskProbability: number;
  };
  orgInspection: {
    excellentThreshold: number;
    qualifiedThreshold: number;
    suspendedThreshold: number;
    influencePoliticalCost: number;
    influenceScoreBonus: number;
  };
  jointReview: {
    disciplineCorruptionThreshold: number;
    otherDepartmentsPassRate: number;
  };
  committeeVote: {
    minSize: number;
    maxSize: number;
    sizePerLevelInterval: number;
  };
  publicNotice: {
    complaintProbPerRisk: number;
    sentimentProbPerRisk: number;
  };
  probation: {
    passThreshold: number;
  };
  progression: {
    ambitionOnFail: number;
    ambitionOnRejected: number;
    politicalCapitalBonusOnSuccess: number;
  };
}

/** 新录用公务员试用期配置。 */
export interface ProbationConfig {
  durationDays: number;
  minimumCompletedActions: number;
  passScoreThreshold: number;
  extensionScoreThreshold: number;
  extensionDays: number;
  maxExtensions: number;
  attributeWeights: {
    competence: number;
    diligence: number;
    integrity: number;
    stability: number;
  };
  disqualifyingRestrictionTypes: CareerRestrictionType[];
}

/** NPC 年度生命周期配置。数值由内容包提供，Engine 不内置业务阈值。 */
export interface NpcLifecycleConfig {
  annualAssessment: {
    baseScore: number;
    specialtyWeight: number;
    tenureBonusPerYear: number;
    historyWeight: number;
    randomSpread: number;
    excellentThreshold: number;
    competentThreshold: number;
    basicThreshold: number;
  };
  rankProgression: {
    /** 同一 fromRank 每个年度允许晋升的 NPC 人数。 */
    maxAdvancementsPerRankPerYear: number;
    minAssessmentCount: number;
    minQualifiedAssessmentCount: number;
    minExcellentAssessmentCount: number;
    /** NPC 独立资格规则使用的在级和服务年限门槛。 */
    minDaysInRank: number;
    minServiceDays: number;
    /** NPC 不能在冻结或处分期间晋升。 */
    blockedRestrictionTypes: CareerRestrictionType[];
  };
  retirement: {
    minimumAge: number;
  };
  exit: {
    consecutiveFailureThreshold: number;
  };
}

/** 全局游戏配置常量（从 constants.json 读取） */
export interface GameConfig {
  slotTiers: SlotTiersConfig;
  reservePenalty: { vigor: number; ambition: number };
  daysPerMonth: number;
  monthsPerYear: number;
  retirementAge: number;
  startYear: number;
  /** 两会/党代会周期（每 N 年一次） */
  congressCycleYears: number;
  /** 非初始编制 Vacancy 在玩家机会缺位达到该天数后，由 NPC 自主补员 */
  npcStaffingDelayDays: number;
  /** NPC 自主补员失败后的重试间隔（无状态退避，自首次到期日起算） */
  npcStaffingRetryIntervalDays: number;
  /** 政治周期各阶段持续天数，合计应等于一个周期长度。 */
  politicalCyclePhaseDurations: {
    preparation: number;
    session: number;
    implementation: number;
    evaluation: number;
  };
  /** 各级别默认年度拨款（万元） */
  budgetByLevel: number[];
  /** 各职业线预算倍率 */
  budgetMultiplierByLine: Record<string, number>;
  initialTransferCount: number;
  /** 晋升到该级别后转移线路锁定 */
  lineLockLevel: number;
  /** 可转职的级别窗口 [from, to][] */
  transferWindowLevels: [number, number][];
  /** 各属性的合法边界 [min, max] */
  attributeBounds: Record<string, [number, number]>;
  /** KPI 等次阈值 */
  kpiTierThresholds: { excellent: number; competent: number; basic: number };
  /** 完成率上限（防止溢出） */
  completionRateCap: number;
  /** 触发舆情生成的最低级别 */
  sentimentMinLevel: number;
  /** 不称职处罚冻结届数 */
  incompetentFrozenPeriods: number;
  /** 连续不称职触发降级的次数阈值 */
  consecutiveFailureThreshold: number;
  /** 最大冻结届数上限 */
  maxFrozenPeriods: number;
  /** 角色默认起始年龄 */
  defaultStartingAge: number;
  /** 角色初始属性默认值 */
  initialAttributes: Record<string, number>;
  /** 初始职位 ID（新建游戏时的起始职位） */
  initialPositionId: string;
  /** KPI 等次对应的 UI 颜色 */
  kpiTierColors: Record<string, string>;
  /** 进度条颜色阈值 */
  completionBarThresholds: { excellent: number; good: number };
  /** 五维映射权重配置：玩家属性 → 五维分项得分的加权系数 */
  fiveDimMapping: {
    virtue: Record<string, number>;
    capacity: Record<string, number>;
    diligenceScore: Record<string, number>;
    honesty: Record<string, number>;
  };
  /** 五维到综合分的权重 */
  comprehensiveScoreWeights: {
    virtue: number;
    capacity: number;
    diligenceScore: number;
    achievement: number;
    honesty: number;
  };
  /** 晋升引擎阈值配置 */
  promotion: PromotionConfig;
  /** 新录用公务员试用期生命周期配置。 */
  probation: ProbationConfig;
  /** 有限 NPC 干部的年度生命周期规则。 */
  npcLifecycle: NpcLifecycleConfig;
  /** 月度防汛风险自动变化参数 */
  floodRiskByMonth: { rainyMonths: number[]; monthlyRise: number; monthlyFall: number };
}

/** 省份/地区配置（regions.json） */
export interface ProvinceConfig {
  name: string;
  type: 'province' | 'municipality' | 'autonomous';
  scoreDistribution: { mean: number; stddev: number; minScore: number; maxScore: number };
  gaokaoThresholds: { [tier: string]: number };
  ethnicBonus: number;
  hasPreparatoryProgram: boolean;
  cities: string[];
}

/** 地区配置容器 */
export interface RegionConfig {
  provinces: ProvinceConfig[];
}

/** 院校配置（universities.json） */
export interface UniversityConfig {
  tiers: Record<string, string[]>;
}

/** 家庭背景配置项 */
export interface FamilyBackgroundItem {
  id: string;
  name: string;
  bonuses: Record<string, number>;
}

/** 晋升通道配置项 */
export interface PromotionPathItem {
  id: string;
  name: string;
  bonuses: Record<string, number>;
}

/** 背景配置容器（backgrounds.json） */
export interface BackgroundConfig {
  familyBackgrounds: FamilyBackgroundItem[];
  promotionPaths: PromotionPathItem[];
}

// ===== Phase C: 领导风格系统配置类型 =====

/** 极端行动定义 */
export interface ExtremeActionConfig {
  id: string;
  name: string;
  description?: string;
  styleAlignment: string;
  requiredScore: number;
  durationDays: number;
  category: 'major' | 'minor' | 'routine';
  cooldownDays: number;
  budgetDelta: number;
  effects: ActionEffectDef[];
  riskDescription?: string;
  isExtreme: true;
}

/** 极端事件选项效果 */
export interface ExtremeEventOption {
  label: string;
  description: string;
  effects: Record<string, number>;
}

/** 极端事件定义 */
export interface ExtremeEventConfig {
  id: string;
  name: string;
  description: string;
  requiredScore: number;
  triggerProbability: number;
  options: ExtremeEventOption[];
}

/** 风格光谱配置 */
export interface StyleSpectrumConfig {
  id: string;
  name: string;
  description?: string;
  members: string[];
  sumCap: number;
  fuzzyThreshold: number;
  fuzzyPenalty: number;
  extremeThreshold: number;
  extremeHighThreshold: number;
  extremeActions: Record<string, ExtremeActionConfig[]>;
  extremeEvents: Record<string, ExtremeEventConfig[]>;
}

/** 独立风格配置 */
export interface IndependentStyleConfig {
  id: string;
  name: string;
  description?: string;
  max: number;
  defaultDecayRate: number;
  extremeActions: Record<string, ExtremeActionConfig[]>;
}

/** 偏离惩罚配置 */
export interface DeviationPenaltyConfig {
  effectivenessMultiplier: number;
  minStyleDiffForOpposition: number;
  styleConflictThreshold: number;
}

/** 领导风格系统完整配置 */
export interface LeadershipStyleConfig {
  version: number;
  styleSpectrums: StyleSpectrumConfig[];
  independentStyles: IndependentStyleConfig[];
  deviationPenalty: DeviationPenaltyConfig;
  styleDecayFactor: number;
  defaultStyleDecayRate: number;
}

/** 偏离惩罚计算结果 */
export interface DeviationResult {
  triggered: boolean;
  effectivenessMultiplier: number;
  styleConflictTriggered: boolean;
  conflictEventId?: string;
}

/** 极端解锁查询结果 */
export interface UnlockedExtremeContent {
  actions: ExtremeActionConfig[];
  events: ExtremeEventConfig[];
}

// ===== 政策配置类型 =====

/** 政策阶段定义（配置格式） */
export interface PolicyPhaseConfig {
  id: string;
  name: string;
  description: string;
  /** 阶段持续天数（正整数） */
  durationDays: number;
  /** 进入本阶段时应用的效果 */
  entryEffects: EffectDefinition[];
  /** 完成本阶段时应用的效果 */
  completionEffects: EffectDefinition[];
}

/** 政策定义配置 */
export interface PolicyDefinitionConfig {
  /** 政策配置 ID（全局唯一） */
  id: string;
  /** 政策名称 */
  name: string;
  /** 政策描述 */
  description: string;
  /** 政策分类 */
  category: PolicyCategory;
  /** 政策标签 */
  tags: string[];
  /** 可用性条件（提议前检查） */
  availabilityCondition?: ConditionExpression;
  /** 生效延迟天数（批准后到可实施） */
  effectiveDelayDays: number;
  /** 批准时立即应用的效果 */
  approvalEffects: EffectDefinition[];
  /** 阶段列表（按顺序线性推进，至少 1 个） */
  phases: PolicyPhaseConfig[];
}

/** 职业机会配置的共同字段。 */
export interface CareerOpportunityDefinitionBase {
  id: string;
  type: CareerOpportunityType;
  triggerSignals: DomainSignal[];
  /** 产生机会时必须满足，并冻结到机会实例中的条件。 */
  conditions: ConditionExpression[];
  /** 机会出现后、接受和最终任职时额外复核的条件。 */
  acceptanceConditions?: ConditionExpression[];
  expiresAfterDays: number | null;
  repeatPolicy: 'once' | 'once_per_source' | 'repeatable';
  cooldownDays: number;
  requiresSelection: boolean;
  reasonTemplate: string;
}

/** 任职类岗位机会定义。 */
export interface AppointmentCareerOpportunityDefinition extends CareerOpportunityDefinitionBase {
  type: Exclude<CareerOpportunityType, 'training'>;
  targetPositionId: string;
  appointmentType: AppointmentType;
  appointmentReason: AppointmentReason;
}

/** 培训机会定义。 */
export interface TrainingCareerOpportunityDefinition extends CareerOpportunityDefinitionBase {
  type: 'training';
  targetPositionId: null;
  trainingDefinitionId: string;
  effects: EffectDefinition[];
}

/** 由配置驱动的职业机会判别联合。 */
export type CareerOpportunityDefinition =
  AppointmentCareerOpportunityDefinition | TrainingCareerOpportunityDefinition;

/** One configurable relative-selection stage. */
export interface RelativeSelectionStageConfig {
  id: RelativeSelectionStage;
  label: string;
  scoreWeights: Record<string, number>;
  randomWeight: number;
  eliminationThreshold: number;
  /** Final-stage ties may be rejected instead of silently choosing by ID. */
  requiresUniqueWinner: boolean;
}

/** A vacancy-specific path and evidence threshold for relative selection. */
export interface RelativeSelectionVacancyScope {
  targetPositionId: string;
  allowedCurrentPositionIds: string[];
  requireSameInstitution: boolean;
  requireSameRegion: boolean;
  requireSamePositionDomain: boolean;
  minimumInstitutionExperienceDays: number;
  minimumRegionExperienceDays: number;
  minimumDomainExperienceDays: number;
  minimumQualifiedAssessmentCount: number;
  qualifiedAssessmentMinimumScore: number;
  minimumLatestAssessmentScore: number;
  requiredSpecialties: { specialtyId: string; minimumScore: number }[];
}

/** Immutable eligibility rules shared by player and NPC candidates. */
export interface RelativeSelectionEligibility {
  minimumCivilServiceRank: CivilServiceRank;
  allowedLeadershipRanks: LeadershipRank[];
  minimumServiceDays: number;
  excludedRestrictionTypes: string[];
  vacancyScopes: RelativeSelectionVacancyScope[];
}

/** Rules frozen into every Selection so future config edits cannot change it. */
export interface RelativeSelectionConfig {
  schemaVersion: 14;
  rulesVersion: string;
  eligibility: RelativeSelectionEligibility;
  stages: RelativeSelectionStageConfig[];
}
