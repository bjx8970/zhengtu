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
