/**
 * 配置数据校验脚本
 *
 * 使用 zod schema 验证所有 JSON 配置文件的格式正确性和引用完整性。
 * CI 中自动运行（pnpm validate:config），校验失败阻断合并。
 *
 * 校验范围：
 * - 部门/KPI/事件模板格式
 * - 职业线职位定义格式（全部 4 条线）
 * - 模板引用 ID 是否存在（departments ↔ career-lines）
 * - 职位 ID / 行动 ID 全局唯一性
 * - 预算单调性与晋升门槛合理性
 * - constants.json 全局配置项格式
 */
import { z } from 'zod';
import deptCore from '../src/config/templates/departments.json' with { type: 'json' };
import deptExtra from '../src/config/templates/departments-extra.json' with { type: 'json' };
import kpis from '../src/config/templates/kpis.json' with { type: 'json' };
import events from '../src/config/templates/events.json' with { type: 'json' };
import admin from '../src/config/career-lines/administrative.json' with { type: 'json' };
import party from '../src/config/career-lines/party.json' with { type: 'json' };
import discipline from '../src/config/career-lines/discipline.json' with { type: 'json' };
import mass from '../src/config/career-lines/mass.json' with { type: 'json' };
import regionData from '../src/config/templates/regions.json' with { type: 'json' };
import universityData from '../src/config/templates/universities.json' with { type: 'json' };
import backgroundData from '../src/config/templates/backgrounds.json' with { type: 'json' };
import leadershipStyles from '../src/config/templates/leadership-styles.json' with { type: 'json' };
import positionsData from '../src/config/positions/positions.json' with { type: 'json' };
import institutionsData from '../src/config/institutions/institutions.json' with { type: 'json' };

const departments = { ...deptCore, ...deptExtra };
const departmentsLookup = departments as Record<string, unknown>;

/** 所有职业线配置 */
const ALL_CAREER_LINES: { id: string; name: string; data: typeof admin }[] = [
  { id: 'admin', name: '行政线', data: admin },
  { id: 'party', name: '党务线', data: party },
  { id: 'discipline', name: '纪检线', data: discipline },
  { id: 'mass', name: '群团线', data: mass },
];

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
  /** 事件类型：通用 / 专属（P3 预留） */
  eventType: z.enum(['generic', 'exclusive']).optional(),
  /** 事件分类（P3 预留） */
  eventCategory: z.enum(['resident', 'political', 'economic', 'emergency', 'story']).optional(),
  triggerCondition: z.object({
    minLevel: z.number().optional(),
    maxLevel: z.number().optional(),
    careerLines: z.array(z.string()).optional(),
    minScore: z.number().optional(),
    requiredFlag: z.string().optional(),
    // P3 新增预留字段
    /** 地区限定 */
    regions: z.array(z.string()).optional(),
    /** 时间窗口（月份范围） */
    timeWindow: z
      .object({ startMonth: z.number().min(1).max(12), endMonth: z.number().min(1).max(12) })
      .optional(),
    /** 前置事件链（已完成事件 ID） */
    prerequisiteEvents: z.array(z.string()).optional(),
    /** 专属职位 ID 列表 */
    positionIds: z.array(z.string()).optional(),
    /** 隐藏状态条件（后续扩展民众满意度等） */
    hiddenStateConditions: z
      .array(
        z.object({
          key: z.string().min(1),
          operator: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
          value: z.number(),
        }),
      )
      .optional(),
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

// 全部职业线格式校验
for (const line of ALL_CAREER_LINES) {
  for (const level of line.data.levels) {
    const levelResult = LevelSchema.safeParse(level);
    if (!levelResult.success) {
      console.error(`❌ ${line.name} L${level.level}:`);
      for (const issue of levelResult.error.issues) {
        console.error(`   [${issue.path.join('.')}] ${issue.message}`);
      }
      errors++;
    } else {
      console.log(`   ✅ ${line.name} ${level.label} (${level.positions.length} 个职位)`);
    }
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

// 职位 ID 全局唯一性检查（跨职业线）
const positionOwners = new Map<string, string>();
for (const line of ALL_CAREER_LINES) {
  for (const level of line.data.levels) {
    for (const pos of level.positions) {
      const existingLine = positionOwners.get(pos.id);
      if (existingLine) {
        console.error(`❌ 职位 ID "${pos.id}" 在 ${existingLine} 和 ${line.name} 中重复`);
        errors++;
      } else {
        positionOwners.set(pos.id, line.name);
      }
    }
  }
}

// 全部职业线引用完整性 + 预算单调性 + 晋升门槛合理性
for (const line of ALL_CAREER_LINES) {
  let prevLevelBudget = 0;
  for (const level of line.data.levels) {
    // 晋升门槛合理性检查
    const req = level.promotionRequirements;
    if (req.minYearsInService < 1 || req.minYearsInService > 8) {
      console.error(
        `❌ ${line.name} L${level.level}: minYearsInService=${req.minYearsInService} 不在 1~8 范围内`,
      );
      errors++;
    }
    if (req.minAssessmentPasses < 1 || req.minAssessmentPasses > 5) {
      console.error(
        `❌ ${line.name} L${level.level}: minAssessmentPasses=${req.minAssessmentPasses} 不在 1~5 范围内`,
      );
      errors++;
    }

    // 预算单调性检查（相邻等级预算应递增）
    const avgBudget =
      level.positions.reduce((sum, p) => sum + p.annualBudget, 0) / level.positions.length;
    if (prevLevelBudget > 0 && avgBudget < prevLevelBudget) {
      console.error(
        `⚠️ ${line.name} L${level.level}: 平均预算 ${Math.round(avgBudget)} 低于上一级 ${Math.round(prevLevelBudget)}`,
      );
      // 警告不计入错误，仅提示
    }
    prevLevelBudget = avgBudget;

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
        console.error(
          `❌ ${pos.name}: 部门数量 ${pos.departmentTemplateIds.length} 不在 3~5 范围内`,
        );
        errors++;
      }
    }
  }
}

// 逐级摘要输出
console.log('\n--- 逐级配置摘要 ---\n');
for (const line of ALL_CAREER_LINES) {
  console.log(`   ${line.name}:`);
  for (const level of line.data.levels) {
    const budgets = level.positions.map((p) => p.annualBudget);
    const minBudget = Math.min(...budgets);
    const maxBudget = Math.max(...budgets);
    const deptCount = level.positions.reduce((sum, p) => sum + p.departmentTemplateIds.length, 0);
    const kpiCount = level.positions.reduce((sum, p) => sum + p.kpiTemplateIds.length, 0);
    console.log(
      `     L${level.level} ${level.label}: ${level.positions.length} 职位 | 预算 ${minBudget}~${maxBudget} | 部门引用 ${deptCount} | KPI 引用 ${kpiCount}`,
    );
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
  reservePenalty: z.object({ vigor: z.number(), ambition: z.number() }),
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
  fiveDimMapping: z.object({
    virtue: z.record(z.number().min(0).max(1)),
    capacity: z.record(z.number().min(0).max(1)),
    diligenceScore: z.record(z.number().min(0).max(1)),
    honesty: z.record(z.number().min(0).max(1)),
  }),
  comprehensiveScoreWeights: z
    .object({
      virtue: z.number().min(0).max(1),
      capacity: z.number().min(0).max(1),
      diligenceScore: z.number().min(0).max(1),
      achievement: z.number().min(0).max(1),
      honesty: z.number().min(0).max(1),
    })
    .refine(
      (w) =>
        Math.abs(w.virtue + w.capacity + w.diligenceScore + w.achievement + w.honesty - 1) < 0.001,
      { message: 'comprehensiveScoreWeights 总和必须为 1.0' },
    ),
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
      ambitionOnFail: z.number().min(0),
      ambitionOnRejected: z.number().min(0),
      politicalCapitalBonusOnSuccess: z.number().min(0),
    }),
  }),
});

const ExtremeActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  styleAlignment: z.string().min(1),
  requiredScore: z.number().min(0).max(100),
  durationDays: z.number().int().min(1),
  category: z.enum(['major', 'minor', 'routine']),
  cooldownDays: z.number().int().min(0),
  budgetDelta: z.number(),
  effects: z.array(z.any()).min(1),
  riskDescription: z.string().optional(),
  isExtreme: z.literal(true),
});

const ExtremeEventOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
  effects: z.record(z.number()),
});

const ExtremeEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  requiredScore: z.number().min(0).max(100),
  triggerProbability: z.number().min(0).max(1),
  options: z.array(ExtremeEventOptionSchema).min(1).max(4),
});

const SpectrumConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    members: z.array(z.string()).min(2),
    sumCap: z.number().min(1),
    fuzzyThreshold: z.number().min(0),
    fuzzyPenalty: z.number().min(-1).max(0),
    extremeThreshold: z.number().min(0).max(100),
    extremeHighThreshold: z.number().min(0).max(100),
    extremeActions: z.record(z.array(ExtremeActionSchema)),
    extremeEvents: z.record(z.array(ExtremeEventSchema)),
  })
  .refine((s) => s.extremeHighThreshold >= s.extremeThreshold, {
    message: 'extremeHighThreshold 必须 >= extremeThreshold',
  });

const IndependentStyleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  max: z.number().min(1),
  defaultDecayRate: z.number().min(0).max(1),
  extremeActions: z.record(z.array(ExtremeActionSchema)),
});

const DeviationPenaltySchema = z.object({
  effectivenessMultiplier: z.number().min(0).max(1),
  minStyleDiffForOpposition: z.number().min(0),
  styleConflictThreshold: z.number().min(0).max(100),
});

const LeadershipStyleSchema = z.object({
  version: z.number(),
  styleSpectrums: z.array(SpectrumConfigSchema),
  independentStyles: z.array(IndependentStyleSchema),
  deviationPenalty: DeviationPenaltySchema,
  styleDecayFactor: z.number().min(0).max(1),
  defaultStyleDecayRate: z.number().min(0).max(1),
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

console.log('\n--- 领导风格配置校验 ---\n');

const lsResult = LeadershipStyleSchema.safeParse(leadershipStyles);
if (!lsResult.success) {
  for (const issue of lsResult.error.issues) {
    console.error(`❌ leadership-styles.json [${issue.path.join('.')}] ${issue.message}`);
    errors++;
  }
} else {
  const allStyleIds = new Set<string>();
  for (const spectrum of leadershipStyles.styleSpectrums) {
    console.log(
      `   ✅ 光谱 "${spectrum.id}" (${spectrum.members.join(', ')}), sumCap=${spectrum.sumCap}`,
    );
    for (const member of spectrum.members) {
      if (allStyleIds.has(member)) {
        console.error(`❌ 风格 ID "${member}" 在多个光谱中重复`);
        errors++;
      } else {
        allStyleIds.add(member);
      }
    }
    for (const key of Object.keys(spectrum.extremeActions)) {
      if (!spectrum.members.includes(key)) {
        console.error(`❌ 光谱 "${spectrum.id}" extremeActions key "${key}" 不在 members 中`);
        errors++;
      }
    }
    for (const key of Object.keys(spectrum.extremeEvents)) {
      if (!spectrum.members.includes(key)) {
        console.error(`❌ 光谱 "${spectrum.id}" extremeEvents key "${key}" 不在 members 中`);
        errors++;
      }
    }
  }
  for (const ind of leadershipStyles.independentStyles) {
    if (allStyleIds.has(ind.id)) {
      console.error(`❌ 独立风格 ID "${ind.id}" 与光谱成员重复`);
      errors++;
    } else {
      allStyleIds.add(ind.id);
    }
    console.log(`   ✅ 独立风格 "${ind.id}", max=${ind.max}`);
  }
  console.log(`   ✅ 共 ${allStyleIds.size} 个唯一风格 ID`);
}

// ===== 新版职位配置校验（复用正式 Schema 单一事实来源） =====
console.log('\n--- 新版职位配置校验 (positions.json) ---\n');

import {
  PositionConfigArraySchema,
  InstitutionConfigMapSchema,
  validatePositionInstitutionConsistency,
} from '../src/config/schemas';

// 使用正式 Schema 解析（与 ConfigLoader 共用同一入口）
const parsedPositionsResult = PositionConfigArraySchema.safeParse(positionsData);
if (!parsedPositionsResult.success) {
  console.error(`❌ positions.json 未通过 PositionConfigSchema 校验：`);
  for (const issue of parsedPositionsResult.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    errors++;
  }
}

const parsedInstitutionsResult = InstitutionConfigMapSchema.safeParse(institutionsData);
if (!parsedInstitutionsResult.success) {
  console.error(`❌ institutions.json 未通过 InstitutionConfigSchema 校验：`);
  for (const issue of parsedInstitutionsResult.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    errors++;
  }
}

if (parsedPositionsResult.success && parsedInstitutionsResult.success) {
  const validPositions = parsedPositionsResult.data;
  const validInstitutions = parsedInstitutionsResult.data;
  const posIds = new Set<string>();

  console.log(`   职位数量: ${validPositions.length}`);
  console.log(`   机构数量: ${Object.keys(validInstitutions).length}`);

  for (const pos of validPositions) {
    // ID 唯一性
    if (posIds.has(pos.id)) {
      console.error(`❌ 职位 ID "${pos.id}" 重复`);
      errors++;
    }
    posIds.add(pos.id);

    // 职位与机构交叉一致性（层级 + 地区）
    const inst = validInstitutions[pos.institutionId];
    const consistencyErrors = validatePositionInstitutionConsistency(pos, inst);
    for (const err of consistencyErrors) {
      console.error(`❌ ${err}`);
      errors++;
    }

    // 部门模板引用存在性
    for (const deptId of pos.departmentTemplateIds) {
      if (!departmentsLookup[deptId]) {
        console.error(`❌ 职位 "${pos.id}" 引用的部门模板 "${deptId}" 不存在`);
        errors++;
      }
    }

    // KPI 模板引用存在性
    for (const kpiId of pos.kpiTemplateIds) {
      if (!(kpis as Record<string, unknown>)[kpiId]) {
        console.error(`❌ 职位 "${pos.id}" 引用的 KPI 模板 "${kpiId}" 不存在`);
        errors++;
      }
    }
  }

  // 机构 ID 与键一致性
  for (const [key, inst] of Object.entries(validInstitutions)) {
    if (inst.id !== key) {
      console.error(`❌ 机构键 "${key}" 与 id "${inst.id}" 不匹配`);
      errors++;
    }
  }

  if (errors === 0) {
    console.log(`   ✅ ${validPositions.length} 个职位全部通过正式 Schema 校验`);
    console.log(`   ✅ ${Object.keys(validInstitutions).length} 个机构配置有效`);
    console.log(`   ✅ 职位—机构交叉一致性通过（层级 + 地区）`);
    console.log(`   ✅ 所有部门/KPI 引用完整`);
  }
}

if (errors > 0) {
  console.error(`\n❌ 发现 ${errors} 个配置错误\n`);
  process.exit(1);
}
console.log('\n✅ 所有配置验证通过\n');
