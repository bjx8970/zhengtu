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
  CareerOpportunityDefinition,
  CareerExperienceQualificationRules,
  PersonalTaskTemplate,
  RelativeSelectionConfig,
} from '../types/config';
import type { PositionConfigV2, InstitutionConfig } from '../types/position-v2';
import type { Phase3AcceptanceConfig } from '../types/phase3';
import type { CadreTemplate } from '../types/organization';
import type { CivilServiceRank, InstitutionLevel } from '../domain/career/types';
import type { EventDefinition } from '../domain/events/definition';
import type { DomainSignal } from '../domain/governance/types';
import type { PolicyDefinitionConfig } from '../types/config';
import {
  PositionConfigArraySchema,
  InstitutionConfigMapSchema,
  PolicyDefinitionArraySchema,
  CivilServiceRankConfigSchema,
  CareerOpportunityDefinitionArraySchema,
  CareerExperienceQualificationRulesSchema,
  PersonalTaskTemplateArraySchema,
  CadreTemplateArraySchema,
  validateCadreTemplateReferences,
  RelativeSelectionConfigSchema,
} from './schemas';
import { EventDefinitionArraySchema } from '../domain/events/definition';
import { PHASE3_ACCEPTANCE_CONFIG } from './phase3-acceptance';
import deptTemplateData from './templates/departments.json' with { type: 'json' };
import deptExtraData from './templates/departments-extra.json' with { type: 'json' };
import kpiData from './templates/kpis.json' with { type: 'json' };
import personalTasksData from './templates/personal-tasks.json' with { type: 'json' };
import positionsData from './positions/positions.json' with { type: 'json' };
import institutionsData from './institutions/institutions.json' with { type: 'json' };
import constantsData from './constants.json' with { type: 'json' };
import regionData from './templates/regions.json' with { type: 'json' };
import universityData from './templates/universities.json' with { type: 'json' };
import backgroundData from './templates/backgrounds.json' with { type: 'json' };
import leadershipStyleData from './templates/leadership-styles.json' with { type: 'json' };
import eventsData from './templates/events.json' with { type: 'json' };
import policiesData from './templates/policies.json' with { type: 'json' };
import civilServiceRanksData from './career/civil-service-ranks.json' with { type: 'json' };
import careerOpportunitiesData from './career/opportunities.json' with { type: 'json' };
import experienceQualificationData from './career/experience-qualification.json' with { type: 'json' };
import cadreTemplatesData from './organization/cadres.json' with { type: 'json' };
import relativeSelectionData from './career/relative-selection.json' with { type: 'json' };

type RawDeptMap = Record<string, DepartmentTemplate>;

const ALL_DEPT_TEMPLATES: RawDeptMap = {
  ...(deptTemplateData as RawDeptMap),
  ...(deptExtraData as RawDeptMap),
};

const ALL_KPI_TEMPLATES = kpiData as Record<string, KPITemplate>;

// 使用正式 Schema 解析配置（单一事实来源）
const parsedPositions = PositionConfigArraySchema.parse(positionsData);
const parsedInstitutions = InstitutionConfigMapSchema.parse(institutionsData);
const parsedEvents = EventDefinitionArraySchema.parse(eventsData);
const parsedPolicies = PolicyDefinitionArraySchema.parse(policiesData);
const parsedCivilServiceRanks = CivilServiceRankConfigSchema.parse(civilServiceRanksData);
const parsedCareerOpportunities =
  CareerOpportunityDefinitionArraySchema.parse(careerOpportunitiesData);
const parsedExperienceQualificationRules = CareerExperienceQualificationRulesSchema.parse(
  experienceQualificationData,
);
const parsedPersonalTasks = PersonalTaskTemplateArraySchema.parse(personalTasksData);
const parsedCadreTemplates = CadreTemplateArraySchema.parse(cadreTemplatesData);
const parsedRelativeSelection = RelativeSelectionConfigSchema.parse(relativeSelectionData);
const ALL_POSITIONS = parsedPositions;
const ALL_INSTITUTIONS = parsedInstitutions;
const ALL_EVENTS = parsedEvents;
const ALL_POLICIES = parsedPolicies;

/**
 * 个人任务 KPI 台账贡献的引用完整性：指标必须存在于 KPI 模板库。
 * 运行期 eager 校验，配置错误在加载时立即失败。
 */
function validatePersonalTaskReferences(tasks: readonly PersonalTaskTemplate[]): void {
  for (const task of tasks) {
    if (!task.kpiEffects) continue;
    for (const effect of task.kpiEffects) {
      if (!ALL_KPI_TEMPLATES[effect.indicatorId])
        throw new Error(`Personal task ${task.id} targets unknown KPI "${effect.indicatorId}"`);
    }
  }
}

validatePersonalTaskReferences(parsedPersonalTasks);

const cadreReferenceErrors = validateCadreTemplateReferences(parsedCadreTemplates, ALL_POSITIONS);
if (cadreReferenceErrors.length > 0) throw new Error(cadreReferenceErrors.join('; '));

function validateCareerOpportunityReferences(
  definitions: readonly CareerOpportunityDefinition[],
): void {
  for (const definition of definitions) {
    if (definition.type === 'training') continue;
    const position = ALL_POSITIONS.find((item) => item.id === definition.targetPositionId);
    if (!position) throw new Error(`Career opportunity ${definition.id} targets unknown position`);
    const institution = ALL_INSTITUTIONS[position.institutionId];
    if (!institution)
      throw new Error(`Career opportunity ${definition.id} targets unknown institution`);
    if (
      institution.level !== position.institutionLevel ||
      institution.regionId !== position.regionId
    )
      throw new Error(
        `Career opportunity ${definition.id} target position and institution conflict`,
      );
    if (definition.type === 'leadership_vacancy' && position.leadershipRank === 'none')
      throw new Error(
        `Career opportunity ${definition.id} leadership target has no leadership rank`,
      );
  }
}

validateCareerOpportunityReferences(parsedCareerOpportunities);

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
  private events: Map<string, EventDefinition>;
  private eventsBySignal: Map<DomainSignal, EventDefinition[]>;
  private policies: Map<string, PolicyDefinitionConfig>;
  private civilServiceRanks: typeof parsedCivilServiceRanks;
  private careerOpportunities: CareerOpportunityDefinition[];
  private experienceQualificationRules: CareerExperienceQualificationRules;
  private personalTasks: PersonalTaskTemplate[];
  private cadreTemplates: CadreTemplate[];
  private relativeSelectionConfig: RelativeSelectionConfig;
  private phase3AcceptanceConfig: Phase3AcceptanceConfig;
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
    this.events = new Map(ALL_EVENTS.map((e) => [e.id, e]));
    // 按信号来源建立只读索引
    this.eventsBySignal = new Map();
    for (const event of ALL_EVENTS) {
      for (const signal of event.trigger.sources) {
        const list = this.eventsBySignal.get(signal) ?? [];
        list.push(event);
        this.eventsBySignal.set(signal, list);
      }
    }
    this.policies = new Map(ALL_POLICIES.map((p) => [p.id, p]));
    this.civilServiceRanks = parsedCivilServiceRanks;
    this.careerOpportunities = parsedCareerOpportunities;
    this.experienceQualificationRules = parsedExperienceQualificationRules;
    this.personalTasks = parsedPersonalTasks;
    this.cadreTemplates = parsedCadreTemplates;
    this.relativeSelectionConfig = parsedRelativeSelection;
    this.phase3AcceptanceConfig = PHASE3_ACCEPTANCE_CONFIG;
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

  /** 按稳定 ID 查询事件定义（未知 ID 返回 null） */
  getEventDefinition(eventId: string): EventDefinition | null {
    const event = this.events.get(eventId);
    // 返回深拷贝，避免调用方意外修改全局单例配置
    return event ? structuredClone(event) : null;
  }

  /** 获取全部事件定义（深拷贝） */
  getAllEventDefinitions(): EventDefinition[] {
    return ALL_EVENTS.map((e) => structuredClone(e));
  }

  /** 按信号来源查询可触发的事件定义（深拷贝） */
  getEventDefinitionsBySignal(signalType: DomainSignal): EventDefinition[] {
    const list = this.eventsBySignal.get(signalType) ?? [];
    return list.map((e) => structuredClone(e));
  }

  /** 按稳定 ID 查询政策定义（未知 ID 返回 null） */
  getPolicyDefinition(policyId: string): PolicyDefinitionConfig | null {
    const policy = this.policies.get(policyId);
    return policy ? structuredClone(policy) : null;
  }

  /** 获取全部政策定义（深拷贝） */
  getAllPolicyDefinitions(): PolicyDefinitionConfig[] {
    return ALL_POLICIES.map((p) => structuredClone(p));
  }

  /** 获取全部职业机会定义（深拷贝）。 */
  getAllCareerOpportunityDefinitions(): CareerOpportunityDefinition[] {
    return this.careerOpportunities.map((definition) => structuredClone(definition));
  }

  /** 获取职业履历资格规则的防御性副本。 */
  getCareerExperienceQualificationRules(): CareerExperienceQualificationRules {
    return structuredClone(this.experienceQualificationRules);
  }

  /** 获取全部个人任务模板（深拷贝）。 */
  getAllPersonalTaskTemplates(): PersonalTaskTemplate[] {
    return this.personalTasks.map((task) => structuredClone(task));
  }

  /** 按稳定 ID 查询个人任务模板（未知 ID 返回 null）。 */
  getPersonalTaskTemplate(taskId: string): PersonalTaskTemplate | null {
    const task = this.personalTasks.find((item) => item.id === taskId);
    return task ? structuredClone(task) : null;
  }

  /**
   * 获取 Phase 4 初始 NPC 干部模板。
   *
   * @returns 不可污染全局配置的干部模板副本
   */
  getCadreTemplates(): CadreTemplate[] {
    return this.cadreTemplates.map((template) => structuredClone(template));
  }

  /**
   * 获取相对选拔规则的防御性副本。
   *
   * @returns 已通过严格 Schema 校验的相对选拔配置副本
   */
  getRelativeSelectionConfig(): RelativeSelectionConfig {
    return structuredClone(this.relativeSelectionConfig);
  }

  /** 获取 Phase 3 验收配置的防御性副本。 */
  getPhase3AcceptanceConfig(): Phase3AcceptanceConfig {
    return structuredClone(this.phase3AcceptanceConfig);
  }

  /** 按领域信号查询职业机会定义（深拷贝）。 */
  getCareerOpportunityDefinitionsBySignal(signal: DomainSignal): CareerOpportunityDefinition[] {
    return this.careerOpportunities
      .filter((definition) => definition.triggerSignals.includes(signal))
      .map((definition) => structuredClone(definition));
  }

  /** 查询公务员职级定义，未知职级不回退。 */
  getCivilServiceRankDefinition(rank: CivilServiceRank) {
    const definition = this.civilServiceRanks.definitions.find((item) => item.id === rank);
    return definition ? structuredClone(definition) : null;
  }

  /** 查询当前职级的唯一晋升规则。 */
  getCivilServiceRankProgressionRule(rank: CivilServiceRank) {
    const rule = this.civilServiceRanks.progressionRules.find((item) => item.fromRank === rank);
    return rule ? structuredClone(rule) : null;
  }

  /** 获取全部公务员职级晋升规则（深拷贝）。 */
  getAllCivilServiceRankProgressionRules() {
    return this.civilServiceRanks.progressionRules.map((item) => structuredClone(item));
  }

  /** 获取新存档所需的公务员职级初始职数。 */
  getInitialCivilServiceRankQuotaMetrics(): Record<string, number> {
    const metrics: Record<string, number> = {};
    for (const rule of this.civilServiceRanks.progressionRules) {
      const quota = rule.quotaRequirement;
      if (!quota) continue;
      // 新存档只取得配置声明的初始库存；后续库存必须由年度考核自然生产。
      metrics[quota.metricId] = Math.max(metrics[quota.metricId] ?? 0, quota.initialValue);
    }
    return metrics;
  }

  /** 获取所有正式职级定义。 */
  getAllCivilServiceRankDefinitions() {
    return this.civilServiceRanks.definitions.map((item) => structuredClone(item));
  }

  /** 展开职位的部门配置 */
  resolvePositionDepartments(positionId: string): DepartmentConfig[] {
    const pos = this.positions.get(positionId);
    if (!pos) throw new Error(`Unknown position: ${positionId}`);
    return pos.departmentTemplateIds.map((tplName, i) =>
      this.resolveDepartment(positionId, tplName, i),
    );
  }

  /**
   * 展开职位的考核 KPI 配置。
   *
   * 当前职位所辖部门是治理行动和运行态的权威责任范围；展示与年终结算
   * 必须共同使用本入口，避免职位摘要字段与部门实际 producer 漂移。
   *
   * @param positionId 稳定职位 ID
   * @returns 按职位部门顺序展开的考核指标
   */
  resolvePositionKpis(positionId: string): KPITemplate[] {
    return this.resolvePositionDepartments(positionId).flatMap((department) =>
      department.kpiIndicators.map((indicator) => ({ ...indicator })),
    );
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
