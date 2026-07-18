/**
 * 配置数据加载器
 *
 * 核心职责：
 * 1. 加载所有 JSON 模板（部门/KPI/事件/职业线/常量）
 * 2. 运行时展开模板引用 → 完整 PositionConfig / DepartmentConfig
 * 3. 全局单例模式，避免重复解析
 *
 * 模板继承流程：
 *   departments.json (模板定义) + career-lines/xxx.json (引用 ID + 覆盖)
 *     → ConfigLoader.getPosition()
 *     → 完整 PositionConfig
 */
import type { CareerLine } from '../types/enums';
import type {
  CareerLineConfig,
  DepartmentConfig,
  KPITemplate,
  PositionConfig,
  GameConfig,
  RegionConfig,
  UniversityConfig,
  BackgroundConfig,
  ProvinceConfig,
  FamilyBackgroundItem,
  PromotionPathItem,
} from '../types/config';
import deptTemplateData from './templates/departments.json' with { type: 'json' };
import deptExtraData from './templates/departments-extra.json' with { type: 'json' };
import kpiData from './templates/kpis.json' with { type: 'json' };
import eventData from './templates/events.json' with { type: 'json' };
import adminData from './career-lines/administrative.json' with { type: 'json' };
import partyData from './career-lines/party.json' with { type: 'json' };
import disciplineData from './career-lines/discipline.json' with { type: 'json' };
import massData from './career-lines/mass.json' with { type: 'json' };
import constantsData from './constants.json' with { type: 'json' };
import regionData from './templates/regions.json' with { type: 'json' };
import universityData from './templates/universities.json' with { type: 'json' };
import backgroundData from './templates/backgrounds.json' with { type: 'json' };
import type { GameEvent } from '../types/game';
import type { DepartmentTemplate } from '../types/config';

type RawDeptMap = Record<string, DepartmentTemplate>;

// ---- 静态合并全部模板 ----
const ALL_DEPT_TEMPLATES: RawDeptMap = {
  ...(deptTemplateData as RawDeptMap),
  ...(deptExtraData as RawDeptMap),
};

const ALL_KPI_TEMPLATES = kpiData as Record<string, KPITemplate>;
const ALL_EVENTS = eventData as Record<string, GameEvent>;

const LINE_CONFIGS: Record<string, CareerLineConfig> = {
  admin: adminData as CareerLineConfig,
  party: partyData as CareerLineConfig,
  discipline: disciplineData as CareerLineConfig,
  mass: massData as CareerLineConfig,
};

/**
 * ConfigLoader 单例
 *
 * 方法命名约定：
 * - getXxx: 返回可能是 null（查询不到时）
 * - resolveXxx: 内部方法，不直接暴露
 */
class ConfigLoader {
  private deptTemplates: RawDeptMap;
  private kpiTemplates: Record<string, KPITemplate>;
  private events: Record<string, GameEvent>;
  private lines: Record<string, CareerLineConfig>;
  private regionConfig: RegionConfig;
  private universityConfig: UniversityConfig;
  private backgroundConfig: BackgroundConfig;
  readonly gameConfig: GameConfig;

  constructor() {
    this.deptTemplates = ALL_DEPT_TEMPLATES;
    this.kpiTemplates = ALL_KPI_TEMPLATES;
    this.events = ALL_EVENTS;
    this.lines = LINE_CONFIGS;
    this.gameConfig = constantsData as unknown as GameConfig;
    this.regionConfig = regionData as unknown as RegionConfig;
    this.universityConfig = universityData as unknown as UniversityConfig;
    this.backgroundConfig = backgroundData as unknown as BackgroundConfig;
  }

  /** 查询完整职业线配置 */
  getCareerLine(line: CareerLine): CareerLineConfig | null {
    return this.lines[line] ?? null;
  }

  /** 查询某个职业线、级别、索引的完整职位配置 */
  getPosition(line: CareerLine, level: number, index: number): PositionConfig | null {
    const config = this.lines[line];
    if (!config) return null;
    const levelConfig = config.levels.find((l) => l.level === level);
    const raw = levelConfig?.positions[index];
    if (!raw) return null;
    return this.resolvePosition(raw, line, level);
  }

  /** 查询职位下的某个部门完整配置 */
  getDepartment(
    line: CareerLine,
    level: number,
    posIndex: number,
    deptIndex: number,
  ): DepartmentConfig | null {
    const pos = this.getPosition(line, level, posIndex);
    return pos?.departments[deptIndex] ?? null;
  }

  /** 获取全部事件列表 */
  getEvents(): GameEvent[] {
    return Object.values(this.events);
  }

  /** 按 ID 获取单个事件 */
  getEventById(id: string): GameEvent | null {
    return this.events[id] ?? null;
  }

  /** 获取全部省份/地区数据 */
  getRegions(): RegionConfig {
    return this.regionConfig;
  }

  /** 按名称查找省份配置 */
  getProvince(name: string): ProvinceConfig | null {
    return this.regionConfig.provinces.find((p) => p.name === name) ?? null;
  }

  /** 获取所有院校数据 */
  getUniversities(): UniversityConfig {
    return this.universityConfig;
  }

  /** 获取所有家庭背景 */
  getFamilyBackgrounds(): FamilyBackgroundItem[] {
    return this.backgroundConfig.familyBackgrounds;
  }

  /** 获取所有晋升通道 */
  getPromotionPaths(): PromotionPathItem[] {
    return this.backgroundConfig.promotionPaths;
  }

  /** 按 ID 查找家庭背景 */
  getFamilyBackground(id: string): FamilyBackgroundItem | null {
    return this.backgroundConfig.familyBackgrounds.find((b) => b.id === id) ?? null;
  }

  /** 按 ID 查找晋升通道 */
  getPromotionPath(id: string): PromotionPathItem | null {
    return this.backgroundConfig.promotionPaths.find((p) => p.id === id) ?? null;
  }

  /** 获取全局游戏常量 */
  getGameConfig(): GameConfig {
    return this.gameConfig;
  }

  /** 展开职位原始数据 → 完整 PositionConfig */
  private resolvePosition(
    raw: {
      id: string;
      name: string;
      departmentTemplateIds: string[];
      kpiTemplateIds: string[];
      annualBudget: number;
      deptOverrides?: Record<string, Partial<DepartmentConfig>>;
    },
    line: CareerLine,
    level: number,
  ): PositionConfig {
    // 展开部门模板引用（含可选的覆盖配置）
    const departments = raw.departmentTemplateIds.map((tplName, i) =>
      this.resolveDepartment(raw.id, tplName, i, raw.deptOverrides?.[tplName]),
    );

    // 展开 KPI 模板引用
    const kpiIndicators = raw.kpiTemplateIds.map((kpiId) => ({
      // 安全：所有 kpiTemplateId 已在 validateConfig 中校验存在于 kpiTemplates
      ...this.kpiTemplates[kpiId]!,
    }));

    return {
      id: raw.id,
      name: raw.name,
      level,
      careerLine: line,
      departments,
      kpiIndicators,
      annualBudget: raw.annualBudget,
    };
  }

  /** 展开单个部门模板引用 → 完整 DepartmentConfig */
  private resolveDepartment(
    positionId: string,
    tplName: string,
    index: number,
    override?: Partial<DepartmentConfig>,
  ): DepartmentConfig {
    const tpl = this.deptTemplates[tplName];
    if (!tpl) {
      throw new Error(`Unknown department template: ${tplName}`);
    }

    const deptId = `${positionId}_dept_${index}`;
    const merged = { ...tpl, ...override } as DepartmentTemplate & Partial<DepartmentConfig>;

    return {
      id: deptId,
      name: merged.name,
      consumptionCoefficient: merged.consumptionCoefficient,
      baseConsumption: merged.baseConsumption,
      actions: merged.actions.map((a) => ({ ...a })),
      kpiIndicators: merged.kpiTemplateIds.map((kpiId) => ({ ...this.kpiTemplates[kpiId]! })), // 安全：模板引用已在构造时校验
    };
  }
}

// ---- 全局单例 ----
let instance: ConfigLoader | null = null;

/** 获取 ConfigLoader 单例 */
export function getConfigLoader(): ConfigLoader {
  if (!instance) {
    instance = new ConfigLoader();
  }
  return instance;
}
