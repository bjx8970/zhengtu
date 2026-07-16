/**
 * 配置数据校验脚本
 *
 * 使用 zod schema 验证所有 JSON 配置文件的格式正确性和引用完整性。
 * CI 中自动运行（pnpm validate:config），校验失败阻断合并。
 *
 * 校验范围：
 * - 部门/KPI/事件模板格式
 * - 职业线职位定义格式
 * - 模板引用 ID 是否存在（departments ↔ career-lines）
 * - constants.json 全局配置项格式
 */
import { z } from 'zod';
import deptCore from '../src/config/templates/departments.json' with { type: 'json' };
import deptExtra from '../src/config/templates/departments-extra.json' with { type: 'json' };
import kpis from '../src/config/templates/kpis.json' with { type: 'json' };
import events from '../src/config/templates/events.json' with { type: 'json' };
import admin from '../src/config/career-lines/administrative.json' with { type: 'json' };

const departments = { ...deptCore, ...deptExtra };

const EffectSchema = z.object({
  target: z.string().min(1),
  operation: z.enum(['add', 'multiply', 'set']),
  value: z.number(),
  range: z.object({ min: z.number(), max: z.number() }).optional(),
});

const ActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  slotCost: z.number().int().min(1).max(6),
  cooldownDays: z.number().int().min(0),
  budgetDelta: z.number(),
  effects: z.array(EffectSchema).min(1),
  unlockLevel: z.number().optional(),
});

const KPISchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  targetValue: z.number(),
  weight: z.number().min(0).max(1),
  unit: z.enum(['%', '万元', '分', '次', '个']),
  calcType: z.enum(['ratio', 'absolute', 'inverse']),
});

const DepartmentTemplateSchema = z.object({
  name: z.string().min(1),
  consumptionCoefficient: z.number().min(0.1),
  baseConsumption: z.number().min(0),
  actions: z.array(ActionSchema).min(2).max(4),
  kpiTemplateIds: z.array(z.string()).min(1).max(3),
});

const EventOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
  effects: z.array(
    z.object({
      target: z.string().min(1),
      value: z.number(),
    }),
  ),
  risk: z
    .object({
      type: z.string(),
      probability: z.number().min(0).max(1),
    })
    .optional(),
});

const EventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  triggerCondition: z.object({
    minLevel: z.number().optional(),
    maxLevel: z.number().optional(),
    careerLines: z.array(z.string()).optional(),
    minScore: z.number().optional(),
    requiredFlag: z.string().optional(),
  }),
  options: z.array(EventOptionSchema).length(3),
});

const PositionRawSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  departmentTemplateIds: z.array(z.string()).min(3).max(5),
  kpiTemplateIds: z.array(z.string()).min(4).max(5),
  annualBudget: z.number().min(0),
  deptOverrides: z.record(z.unknown()).optional(),
});

const LevelSchema = z.object({
  level: z.number().int().min(1).max(11),
  label: z.string().min(1),
  positions: z.array(PositionRawSchema).min(3).max(4),
  promotionRequirements: z.object({
    minYearsInService: z.number().int().min(1),
    minAssessmentPasses: z.number().int().min(1),
    politicalConditions: z.array(z.string()),
    specialConditions: z.array(z.string()).optional(),
    canBreakRules: z.boolean().optional(),
  }),
});

let errors = 0;

function validateRecord<T>(
  label: string,
  schema: z.ZodType<T>,
  data: Record<string, unknown>,
): void {
  let passed = 0;
  for (const [key, value] of Object.entries(data)) {
    const result = schema.safeParse(value);
    if (result.success) {
      passed++;
    } else {
      console.error(`❌ ${label}.${key}:`);
      for (const issue of result.error.issues) {
        console.error(`   [${issue.path.join('.')}] ${issue.message}`);
      }
      errors++;
    }
  }
  console.log(`   ${label}: ${passed}/${Object.keys(data).length} passed`);
}

console.log('\n=== 配置数据格式校验 ===\n');

validateRecord('部门模板', DepartmentTemplateSchema, departments);
validateRecord('KPI 模板', KPISchema, kpis);
validateRecord('事件模板', EventSchema, events);

for (const level of admin.levels) {
  const levelResult = LevelSchema.safeParse(level);
  if (!levelResult.success) {
    console.error(`❌ 行政线 L${level.level}:`);
    for (const issue of levelResult.error.issues) {
      console.error(`   [${issue.path.join('.')}] ${issue.message}`);
    }
    errors++;
  } else {
    console.log(`   ✅ 行政线 ${level.label} (${level.positions.length} 个职位)`);
  }
}

console.log('\n--- 引用完整性检查 ---\n');

const allDeptIds = new Set(Object.keys(departments));
const allKpiIds = new Set(Object.keys(kpis));

for (const level of admin.levels) {
  for (const pos of level.positions) {
    for (const deptId of pos.departmentTemplateIds) {
      if (!allDeptIds.has(deptId)) {
        console.error(`❌ ${pos.name}: 引用不存在的部门模板 "${deptId}"`);
        errors++;
      }
    }
    for (const kpiId of pos.kpiTemplateIds) {
      if (!allKpiIds.has(kpiId)) {
        console.error(`❌ ${pos.name}: 引用不存在的KPI模板 "${kpiId}"`);
        errors++;
      }
    }
    const deptWeightChecked =
      pos.departmentTemplateIds.length >= 3 && pos.departmentTemplateIds.length <= 5;
    if (!deptWeightChecked) {
      console.error(`❌ ${pos.name}: 部门数量 ${pos.departmentTemplateIds.length} 不在 3~5 范围内`);
      errors++;
    }
  }
}

console.log('\n--- 事件引用完整性 ---\n');

for (const [eventId, event] of Object.entries(events) as [string, z.infer<typeof EventSchema>][]) {
  if (event.triggerCondition.careerLines) {
    const validLines = ['admin', 'party', 'discipline', 'mass'];
    for (const line of event.triggerCondition.careerLines) {
      if (!validLines.includes(line)) {
        console.error(`❌ 事件 ${eventId}: 无效的职业线 "${line}"`);
        errors++;
      }
    }
  }
  if (event.options.length !== 3) {
    console.error(`❌ 事件 ${eventId}: 选项数 ${event.options.length} 不为 3`);
    errors++;
  }
}

console.log('\n--- 常量配置校验 ---\n');

const ConstantsSchema = z.object({
  slotLimits: z.object({ day: z.number(), week: z.number(), month: z.number() }),
  daysPerMonth: z.number().min(1),
  monthsPerYear: z.number().min(1),
  retirementAge: z.number().min(1),
  startYear: z.number(),
  congressCycleYears: z.number().min(1),
  budgetByLevel: z.array(z.number().min(0)),
  budgetMultiplierByLine: z.record(z.number().min(0)),
  initialTransferCount: z.number().min(0),
  lineLockLevel: z.number().min(1),
  transferWindowLevels: z.array(z.tuple([z.number(), z.number()])),
  attributeBounds: z.record(z.tuple([z.number(), z.number()])),
  kpiTierThresholds: z.object({ excellent: z.number(), competent: z.number(), basic: z.number() }),
  completionRateCap: z.number().positive(),
  daysPerSlotUnit: z.number().positive(),
  sentimentMinLevel: z.number().min(1),
  incompetentFrozenPeriods: z.number().min(0),
  consecutiveFailureThreshold: z.number().min(1),
  maxFrozenPeriods: z.number().min(1),
  defaultStartingAge: z.number().min(18),
  initialAttributes: z.record(z.number()),
  kpiTierColors: z.record(z.string()),
  completionBarThresholds: z.object({ excellent: z.number(), good: z.number() }),
  promotion: z.object({
    democraticVote: z.object({
      passThreshold: z.number(),
      connectionsBonus: z.number(),
      connectionsRiskProbability: z.number().min(0).max(1),
    }),
    orgInspection: z.object({
      excellentThreshold: z.number(),
      qualifiedThreshold: z.number(),
      suspendedThreshold: z.number(),
      influencePoliticalCost: z.number().min(0),
      influenceScoreBonus: z.number(),
    }),
    jointReview: z.object({
      disciplineCorruptionThreshold: z.number(),
      otherDepartmentsPassRate: z.number().min(0).max(1),
    }),
    committeeVote: z.object({
      minSize: z.number().int().min(1),
      maxSize: z.number().int().min(1),
      sizePerLevelInterval: z.number().int().min(0),
    }),
    publicNotice: z.object({
      complaintProbPerRisk: z.number().min(0).max(1),
      sentimentProbPerRisk: z.number().min(0).max(1),
    }),
    probation: z.object({
      passThreshold: z.number(),
    }),
    progression: z.object({
      demoralizationOnFail: z.number().min(0),
      demoralizationOnRejected: z.number().min(0),
      politicalCapitalBonusOnSuccess: z.number().min(0),
    }),
  }),
});

import constants from '../src/config/constants.json' with { type: 'json' };

const cResult = ConstantsSchema.safeParse(constants);
if (!cResult.success) {
  for (const issue of cResult.error.issues) {
    console.error(`❌ constants.json [${issue.path.join('.')}] ${issue.message}`);
    errors++;
  }
} else {
  console.log('   ✅ constants.json 格式校验通过');
}

if (errors > 0) {
  console.error(`\n❌ 发现 ${errors} 个配置错误\n`);
  process.exit(1);
}
console.log('\n✅ 所有配置验证通过\n');
