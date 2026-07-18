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
import regionData from '../src/config/templates/regions.json' with { type: 'json' };
import universityData from '../src/config/templates/universities.json' with { type: 'json' };
import backgroundData from '../src/config/templates/backgrounds.json' with { type: 'json' };

const departments = { ...deptCore, ...deptExtra };

const EffectSchema = z.object({
  target: z.string().min(1),
  operation: z.enum(['add', 'multiply', 'set']),
  value: z.number(),
  range: z.object({ min: z.number(), max: z.number() }).optional(),
});

const ActionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    durationDays: z.number().int().min(1),
    category: z.enum(['major', 'minor', 'routine']),
    cooldownDays: z.number().int().min(0),
    budgetDelta: z.number(),
    effects: z.array(EffectSchema).min(1),
    unlockLevel: z.number().optional(),
  })
  .superRefine((action, ctx) => {
    if (action.category === 'major' && action.cooldownDays !== 14) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cooldownDays'],
        message: '重大行动的冷却天数必须为 14',
      });
    }
    if (action.category === 'minor' && action.cooldownDays !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cooldownDays'],
        message: '次要行动的冷却天数必须为 7',
      });
    }
    if (action.category === 'routine' && action.cooldownDays !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cooldownDays'],
        message: '日常行动的冷却天数必须为 0',
      });
    }
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
const actionOwners = new Map<string, string>();

for (const [deptId, department] of Object.entries(departments)) {
  for (const action of department.actions) {
    const existingDeptId = actionOwners.get(action.id);
    if (existingDeptId) {
      console.error(
        `❌ 行动 ID "${action.id}" 在部门模板 "${existingDeptId}" 和 "${deptId}" 中重复`,
      );
      errors++;
    } else {
      actionOwners.set(action.id, deptId);
    }
  }
}

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
  slotTiers: z.object({
    primary: z.object({ label: z.string(), count: z.number(), description: z.string() }),
    secondary: z.object({ label: z.string(), count: z.number(), description: z.string() }),
    reserve: z.object({ label: z.string(), count: z.number(), description: z.string() }),
  }),
  reservePenalty: z.object({ health: z.number(), demoralization: z.number() }),
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

console.log('\n--- 建档数据校验 ---\n');

const RegionSchema = z.object({
  provinces: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(['province', 'municipality', 'autonomous']),
      scoreDistribution: z.object({
        mean: z.number(),
        stddev: z.number().positive(),
        minScore: z.number(),
        maxScore: z.number(),
      }),
      gaokaoThresholds: z.record(z.string(), z.number()),
      ethnicBonus: z.number().min(0),
      hasPreparatoryProgram: z.boolean(),
      cities: z.array(z.string().min(1)).min(2),
    }),
  ),
});

const rResult = RegionSchema.safeParse(regionData);
if (!rResult.success) {
  for (const issue of rResult.error.issues) {
    console.error(`❌ regions.json [${issue.path.join('.')}] ${issue.message}`);
    errors++;
  }
} else {
  console.log(`   ✅ regions.json (${regionData.provinces.length} 个省份)`);
}

const UniversitySchema = z.object({
  tiers: z.record(z.string(), z.array(z.string().min(1)).min(1)),
});
const uResult = UniversitySchema.safeParse(universityData);
if (!uResult.success) {
  for (const issue of uResult.error.issues) {
    console.error(`❌ universities.json [${issue.path.join('.')}] ${issue.message}`);
    errors++;
  }
} else {
  const totalSchools = Object.values(universityData.tiers).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  console.log(
    `   ✅ universities.json (${Object.keys(universityData.tiers).length} 档, ${totalSchools} 所)`,
  );
}

const BackgroundSchema = z.object({
  familyBackgrounds: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      bonuses: z.record(z.string(), z.number()),
    }),
  ),
  promotionPaths: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      bonuses: z.record(z.string(), z.number()),
    }),
  ),
});
const bResult = BackgroundSchema.safeParse(backgroundData);
if (!bResult.success) {
  for (const issue of bResult.error.issues) {
    console.error(`❌ backgrounds.json [${issue.path.join('.')}] ${issue.message}`);
    errors++;
  }
} else {
  console.log(
    `   ✅ backgrounds.json (${backgroundData.familyBackgrounds.length} 背景 + ${backgroundData.promotionPaths.length} 通道)`,
  );
}

if (errors > 0) {
  console.error(`\n❌ 发现 ${errors} 个配置错误\n`);
  process.exit(1);
}
console.log('\n✅ 所有配置验证通过\n');
