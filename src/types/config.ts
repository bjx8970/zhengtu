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
  /** 消耗槽位数 */
  slotCost: number;
  /** 冷却天数（按游戏内天数计算） */
  cooldownDays: number;
  /** 行动消耗预算（万元） */
  budgetDelta: number;
  /** 执行后对 KPI/属性的影响列表 */
  effects: ActionEffectDef[];
  /** 解锁所需玩家级别 */
  unlockLevel?: number;
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

/** 各粒度下的槽位上限 */
export interface SlotConfig {
  day: number;
  week: number;
  month: number;
}

/** 派系惩罚配置常量 */
export interface FactionPenaltyConfig {
  /** 声望差值归一化除数（max - second 除以该值得到差异比例） */
  reputationDivisor: number;
  /** 惩罚值上限（惩罚范围 0~maxPenalty） */
  maxPenalty: number;
}

/** 晋升引擎配置常量 */
export interface PromotionConfig {
  democraticVote: {
    passThreshold: number;
    connectionsBonus: number;
    connectionsRiskProbability: number;
    /** 考核得分的权重（各权重之和应为 1.0） */
    scoreWeight: number;
    /** 魅力的权重 */
    charismaWeight: number;
    /** 上司好感的权重 */
    superiorFavorWeight: number;
  };
  orgInspection: {
    excellentThreshold: number;
    qualifiedThreshold: number;
    suspendedThreshold: number;
    influencePoliticalCost: number;
    influenceScoreBonus: number;
    /** 政绩的权重 */
    performanceWeight: number;
    /** 能力的权重 */
    competenceWeight: number;
    /** 考核得分的权重 */
    scoreWeight: number;
    /** 廉洁的权重 */
    integrityWeight: number;
  };
  jointReview: {
    disciplineCorruptionThreshold: number;
    otherDepartmentsPassRate: number;
    /** 腐败风险归一化除数（将 0-100 的 corruptionRisk 映射为影响因子） */
    complaintNormalizer: number;
  };
  committeeVote: {
    minSize: number;
    maxSize: number;
    sizePerLevelInterval: number;
    /** 赞成率归一化除数（avgReputation + superiorFavor 各 0-100，除以此值归一化到 0-1） */
    approvalDivisor: number;
    /** 派系惩罚值归一化除数（除以该值转为对通过率的影响） */
    factionPenaltyDivisor: number;
    /** 常委会票决最低通过率保底值 */
    minApprovalRate: number;
  };
  publicNotice: {
    complaintProbPerRisk: number;
    sentimentProbPerRisk: number;
  };
  probation: {
    passThreshold: number;
    /** 试用期考核随机因素最大值（0~randomFactorMax 的均匀分布） */
    randomFactorMax: number;
  };
  progression: {
    demoralizationOnFail: number;
    demoralizationOnRejected: number;
    politicalCapitalBonusOnSuccess: number;
  };
  /** 派系惩罚参数 */
  factionPenalty: FactionPenaltyConfig;
}

/** 行政线专属配置常量 */
export interface AdminLineConfig {
  /** 招商引资的标准收益率 */
  investmentYieldRate: number;
  /** 项目完��的基础推进率 */
  projectCompletionBaseRate: number;
  /** 土地出让收入的倍率系数 */
  landRevenueMultiplier: number;
  /** 产业园区的增长速率 */
  parkGrowthRate: number;
  /** 财政收支平衡的达标阈值 */
  fiscalBalanceThreshold: number;
  /** 项目审批充分完成的基准天数（审批超过此天数视为审批充分） */
  projectApprovalBaselineDays: number;
  /** 烂尾判定：资金到位率低于此值且进度不足一半视为资金链断裂 */
  abandonedBudgetThreshold: number;
  /** 烂尾判定：资金链断裂/政策搁置进度参考阈值 */
  abandonedProgressThreshold: number;
  /** 烂尾判定：政策搁置停滞超过此天数视为烂尾 */
  abandonedStagnationDays: number;
  /** 财政支出估算系数（支出 = 收入 × 此系数，略 >1 表示赤字倾向） */
  expenditureEstimateRatio: number;
}

/** 全局游戏配置常量（从 constants.json 读取） */
export interface GameConfig {
  slotLimits: SlotConfig;
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
  /** 每槽位对应的天数折算系数 */
  daysPerSlotUnit: number;
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
  /** KPI 等次对应的 UI 颜色 */
  kpiTierColors: Record<string, string>;
  /** 进度条颜色阈值 */
  completionBarThresholds: { excellent: number; good: number };
  /** 晋升引擎阈值配置 */
  promotion: PromotionConfig;
  /** 行政线专属配置 */
  adminLine: AdminLineConfig;
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
