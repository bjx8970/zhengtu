/**
 * 配置数据加载器（Schema 2）
 *
 * 核心职责：
 * 1. 加载新版职位配置（按稳定 ID 查询）
 * 2. 加载机构配置
 * 3. 展开部门/KPI 模板引用
 * 4. 全局单例模式
 *
 * 不再使用职业线、数字等级和职位数组索引作为主要查询接口。
 * 未知引用立即失败，不自动回退到首个职位。
 */
import type {
  DepartmentConfig,
  KPITemplate,
  GameConfig,
  RegionConfig,
  UniversityConfig,
  BackgroundConfig,
  ProvinceConfig,
  FamilyBackgroundItem,
  PromotionPathItem,
  DepartmentTemplate,
  LeadershipStyleConfig,
} from '../types/config';
import type { PositionConfigV2, InstitutionConfig } from '../types/position-v2';
import type { InstitutionLevel } from '../domain/career/types';
import deptTemplateData from './templates/departments.json' with { type: 'json' };
import deptExtraData from './templates/departments-extra.json' with { type: 'json' };
import kpiData from './templates/kpis.json' with { type: 'json' };
import positionsData from './positions/positions.json' with { type: 'json' };
import institutionsData from './institutions/institutions.json' with { type: 'json' };
import constantsData from './constants.json' with { type: 'json' };
import regionData from './templates/regions.json' with { type: 'json' };
import universityData from './templates/universities.json' with { type: 'json' };
import backgroundData from './templates/backgrounds.json' with { type: 'json' };
import leadershipStyleData from './templates/leadership-styles.json' with { type: 'json' };

type RawDeptMap = Record<string, DepartmentTemplate>;

const ALL_DEPT_TEMPLATES: RawDeptMap = {
  ...(deptTemplateData as RawDeptMap),
  ...(deptExtraData as RawDeptMap),
};

const ALL_KPI_TEMPLATES = kpiData as Record<string, KPITemplate>;
const ALL_POSITIONS = positionsData as PositionConfigV2[];
const ALL_INSTITUTIONS = institutionsData as Record<string, InstitutionConfig>;

/**
 * ConfigLoader 单例（Schema 2）
 *
 * 按稳定 positionId、institutionId、regionId 查询。
 */
class ConfigLoader {
  private deptTemplates: RawDeptMap;
  private kpiTemplates: Record<string, KPITemplate>;
  private positions: Map<string, PositionConfigV2>;
  private institutions: Map<string, InstitutionConfig>;
  private regionConfig: RegionConfig;
  private universityConfig: UniversityConfig;
  private backgroundConfig: BackgroundConfig;
  private leadershipStyleConfig: LeadershipStyleConfig;
  readonly gameConfig: GameConfig;

  constructor() {
    this.deptTemplates = ALL_DEPT_TEMPLATES;
    this.kpiTemplates = ALL_KPI_TEMPLATES;
    this.positions = new Map(ALL_POSITIONS.map((p) => [p.id, p]));
    this.institutions = new Map(Object.values(ALL_INSTITUTIONS).map((i) => [i.id, i]));
    this.gameConfig = constantsData as unknown as GameConfig;
    this.regionConfig = regionData as unknown as RegionConfig;
    this.universityConfig = universityData as unknown as UniversityConfig;
    this.backgroundConfig = backgroundData as unknown as BackgroundConfig;
    this.leadershipStyleConfig = leadershipStyleData as unknown as LeadershipStyleConfig;
  }

  /** 按稳定 ID 查询职位配置 */
  getPositionById(positionId: string): PositionConfigV2 | null {
    return this.positions.get(positionId) ?? null;
  }

  /** 获取全部职位配置 */
  getAllPositions(): PositionConfigV2[] {
    return ALL_POSITIONS;
  }

  /** 按机构层级查询职位 */
  getPositionsByLevel(level: InstitutionLevel): PositionConfigV2[] {
    return ALL_POSITIONS.filter((p) => p.institutionLevel === level);
  }

  /** 按稳定 ID 查询机构配置 */
  getInstitutionById(institutionId: string): InstitutionConfig | null {
    return this.institutions.get(institutionId) ?? null;
  }

  /** 获取全部机构配置 */
  getAllInstitutions(): InstitutionConfig[] {
    return Object.values(ALL_INSTITUTIONS);
  }

  /** 展开职位的部门配置 */
  resolvePositionDepartments(positionId: string): DepartmentConfig[] {
    const pos = this.positions.get(positionId);
    if (!pos) throw new Error(`Unknown position: ${positionId}`);
    return pos.departmentTemplateIds.map((tplName, i) =>
      this.resolveDepartment(positionId, tplName, i),
    );
  }

  /** 展开职位的 KPI 配置 */
  resolvePositionKpis(positionId: string): KPITemplate[] {
    const pos = this.positions.get(positionId);
    if (!pos) throw new Error(`Unknown position: ${positionId}`);
    return pos.kpiTemplateIds.map((kpiId) => {
      const kpi = this.kpiTemplates[kpiId];
      if (!kpi) throw new Error(`Unknown KPI template: ${kpiId}`);
      return { ...kpi };
    });
  }

  /** 按 ID 查询 KPI 模板 */
  getKpiTemplate(id: string): KPITemplate | null {
    return this.kpiTemplates[id] ?? null;
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

  /** 获取领导风格配置 */
  getLeadershipStyleConfig(): LeadershipStyleConfig {
    return this.leadershipStyleConfig;
  }

  /** 获取全局游戏常量 */
  getGameConfig(): GameConfig {
    return this.gameConfig;
  }

  /** 展开单个部门模板引用 → 完整 DepartmentConfig */
  private resolveDepartment(positionId: string, tplName: string, index: number): DepartmentConfig {
    const tpl = this.deptTemplates[tplName];
    if (!tpl) {
      throw new Error(`Unknown department template: ${tplName}`);
    }

    const deptId = `${positionId}_dept_${index}`;

    return {
      id: deptId,
      name: tpl.name,
      consumptionCoefficient: tpl.consumptionCoefficient,
      baseConsumption: tpl.baseConsumption,
      actions: tpl.actions.map((a) => ({ ...a })),
      kpiIndicators: tpl.kpiTemplateIds.map((kpiId) => {
        const kpi = this.kpiTemplates[kpiId];
        if (!kpi) throw new Error(`Unknown KPI template: ${kpiId}`);
        return { ...kpi };
      }),
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
