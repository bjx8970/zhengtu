/**
 * 存档迁移管道
 *
 * 提供版本化存档的安全迁移能力：
 * - 检测存档版本
 * - 按版本链逐步迁移
 * - 迁移失败时保留原始数据备份
 * - 提供 Zod schema 验证
 */

import { z } from 'zod';
import type { PlayerSave } from '../../types/player';
import type { SaveEnvelope, MigrationStep, MigrationResult } from '../../types/save';
import { CURRENT_SCHEMA_VERSION, CURRENT_CONTENT_VERSION } from '../../types/save';
import { migrateV0ToV1 } from './versions/v0-to-v1';

/** 所有已注册的迁移步骤（按 fromVersion 排序） */
const MIGRATIONS: MigrationStep[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    description: 'v3 原型存档 → v4 版本化存档：删除临时字段，补充 runtimeSnapshot',
    migrate: migrateV0ToV1,
  },
];

/** 存档备份的 localStorage key 前缀 */
const BACKUP_KEY_PREFIX = 'zhengtu_backup_v';

// ===== Zod Schema 验证 =====

/** SlotOccupant 的 Zod schema */
const SlotOccupantSchema = z.object({
  actionId: z.string(),
  deptId: z.string(),
  actionName: z.string(),
  category: z.enum(['major', 'minor', 'routine']),
  startedAtDay: z.number(),
  durationDays: z.number(),
  cooldownDays: z.number(),
  runtimeSnapshot: z
    .object({
      effectivenessMultiplier: z.number(),
      styleConflictTriggered: z.boolean(),
      styleAlignment: z.string().optional(),
    })
    .optional(),
});

/** SlotTierGroup 的 Zod schema */
const SlotTierGroupSchema = z.object({
  label: z.string(),
  count: z.number(),
  occupants: z.array(z.nullable(SlotOccupantSchema)),
});

/** GameTime 的 Zod schema（含范围校验） */
const GameTimeSchema = z.object({
  year: z.number().int().min(1),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(30),
  granularity: z.enum(['day', 'week', 'month']),
});

/** 合法职业线枚举 */
const VALID_CAREER_LINES = ['admin', 'party', 'discipline', 'mass'];

/** 合法晋升阶段枚举 */
const VALID_PROMOTION_STAGES = [
  'idle',
  'target_selection',
  'democratic_vote',
  'org_inspection',
  'joint_review',
  'committee_vote',
  'public_notice',
  'appointment',
  'probation',
  'completed',
  'failed',
];

/** DepartmentState 的 Zod schema */
const DepartmentStateSchema = z.object({
  id: z.string(),
  kpiValues: z.record(z.number()),
  monthlyConsumption: z.number(),
  cumulativeConsumption: z.number(),
  lastActionDay: z.number(),
  actionCooldownUntilDays: z.record(z.number()),
});

/** PlayerSave 完整验证 schema */
const PlayerSaveSchema = z.object({
  // 基础信息
  saveId: z.string(),
  userId: z.string(),
  characterName: z.string(),
  gender: z.enum(['男', '女']),
  birthPlace: z.object({ province: z.string(), city: z.string() }),
  birthYear: z.number().int(),
  gaokaoScore: z.number(),
  gaokaoTier: z.string(),
  university: z.string(),
  universityTier: z.string(),
  familyBackground: z.enum(['peasant', 'worker', 'merchant', 'cadre', 'academic']),
  promotionPath: z.enum(['xuandiao', 'gongwuyuan', 'junzhuan', 'guoqi']),
  isPreparatory: z.boolean(),
  // 当前职位
  currentPositionId: z.string(),
  currentLevel: z.number().int().min(1).max(11),
  currentCareerLine: z.string().refine((v) => VALID_CAREER_LINES.includes(v)),
  yearsInCurrentPosition: z.number().min(0),
  // 资源
  slots: z.object({
    primary: SlotTierGroupSchema,
    secondary: SlotTierGroupSchema,
    reserve: SlotTierGroupSchema,
  }),
  vigor: z.number(),
  politicalCapital: z.number(),
  remainingBudget: z.number(),
  // 考核
  comprehensiveScore: z.number(),
  annualAssessments: z.array(
    z.object({
      year: z.number(),
      score: z.number(),
      tier: z.string(),
      dimensions: z
        .object({
          virtue: z.number(),
          capacity: z.number(),
          diligenceScore: z.number(),
          achievement: z.number(),
          honesty: z.number(),
        })
        .optional(),
    }),
  ),
  // 核心属性
  integrity: z.number(),
  stability: z.number(),
  performance: z.number(),
  charisma: z.number(),
  competence: z.number(),
  network: z.number(),
  diligence: z.number(),
  // 晋升
  promotionStage: z.string().refine((v) => VALID_PROMOTION_STAGES.includes(v)),
  promotionAttempts: z.number().min(0),
  frozenPeriods: z.number().min(0),
  promotionState: z.nullable(
    z.object({
      targetPositionId: z.string(),
      targetLevel: z.number(),
      currentStage: z.string(),
      stageResults: z.record(z.unknown()),
      flaggedForRisk: z.boolean().optional(),
    }),
  ),
  // 转职
  transferCount: z.number(),
  isLineLocked: z.boolean(),
  // 部门状态
  departmentStates: z.record(DepartmentStateSchema),
  // 职业履历
  careerHistory: z.array(
    z.object({
      positionId: z.string(),
      positionName: z.string(),
      level: z.number(),
      careerLine: z.string(),
      startYear: z.number(),
      endYear: z.nullable(z.number()),
      assessmentResults: z.array(z.unknown()),
      archived: z.boolean(),
    }),
  ),
  // 秘书
  secretary: z.nullable(
    z.object({
      id: z.string(),
      name: z.string(),
      experience: z.number(),
      level: z.string(),
    }),
  ),
  // 人脉与理念
  relations: z.object({
    classmates: z.record(z.number()),
    colleagues: z.record(z.number()),
    business: z.record(z.number()),
    academic: z.record(z.number()),
    media: z.record(z.number()),
    central: z.record(z.number()),
  }),
  philosophy: z.object({
    scores: z.record(z.number()),
  }),
  reserveTier: z.number(),
  ambition: z.number(),
  // 风险
  corruptionRisk: z.number(),
  isUnderInvestigation: z.boolean(),
  // 时间
  time: GameTimeSchema,
  // 高级系统
  successor: z.nullable(
    z.object({
      id: z.nullable(z.string()),
      name: z.string(),
      investment: z.number(),
      readiness: z.number(),
    }),
  ),
  thinkTank: z.object({
    science: z.nullable(z.string()),
    economics: z.nullable(z.string()),
    law: z.nullable(z.string()),
  }),
  mentees: z.array(z.object({ id: z.string(), progress: z.number() })),
  // 统计
  achievements: z.array(z.string()),
  totalActions: z.number().min(0),
  totalDaysPlayed: z.number().min(0),
  lastCompletedActions: z.array(
    z.object({
      actionName: z.string(),
      deptName: z.string(),
      effects: z.array(z.string()),
      completedAtDay: z.number(),
    }),
  ),
  // 终局
  endgameReached: z.boolean(),
  // 元数据
  updatedAt: z.number(),
});

/** SaveEnvelope 的 Zod schema */
const SaveEnvelopeSchema = z.object({
  schemaVersion: z.number(),
  contentVersion: z.string(),
  revision: z.number(),
  savedAt: z.number(),
  state: PlayerSaveSchema,
});

/**
 * 检测原始数据的存档版本。
 *
 * @param data 反序列化后的存档数据
 * @returns 版本号（0 表示无版本号的旧存档，-1 表示无法识别）
 */
export function detectSchemaVersion(data: unknown): number {
  if (!data || typeof data !== 'object') return -1;
  const obj = data as Record<string, unknown>;

  // 有 SaveEnvelope 结构
  if (typeof obj.schemaVersion === 'number') {
    // 必须是非负有限整数
    if (!Number.isFinite(obj.schemaVersion) || obj.schemaVersion < 0) return -1;
    return obj.schemaVersion;
  }

  // 无版本号但有 PlayerSave 基本结构 → v0 旧存档
  if (
    typeof obj.currentPositionId === 'string' &&
    typeof obj.currentLevel === 'number' &&
    typeof obj.characterName === 'string'
  ) {
    return 0;
  }

  return -1; // 无法识别
}

/**
 * 验证 PlayerSave 数据是否符合当前 schema。
 *
 * @param data 待验证数据
 * @returns 验证结果
 */
export function validatePlayerSave(data: unknown): { valid: boolean; error?: string } {
  const result = PlayerSaveSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, error: result.error.message };
}

/**
 * 验证 SaveEnvelope 数据。
 *
 * @param data 待验证数据
 * @returns 验证结果
 */
export function validateSaveEnvelope(data: unknown): { valid: boolean; error?: string } {
  const result = SaveEnvelopeSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, error: result.error.message };
}

/**
 * 创建存档备份到 localStorage。
 *
 * @param rawData 原始存档 JSON 字符串
 * @param version 存档版本号
 */
export function createBackup(rawData: string, version: number): string {
  const backupKey = `${BACKUP_KEY_PREFIX}${version}_${Date.now()}`;
  try {
    localStorage.setItem(backupKey, rawData);
    return backupKey;
  } catch {
    // localStorage 不可用时返回空字符串
    return '';
  }
}

/**
 * 执行存档迁移。
 *
 * 迁移流程：
 * 1. 检测源版本
 * 2. 创建备份
 * 3. 逐步执行迁移链
 * 4. 验证最终结果
 * 5. 返回迁移结果或错误
 *
 * @param rawData 原始存档 JSON 字符串
 * @returns 迁移结果
 */
export function migrateSave(rawData: string): MigrationResult {
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    // JSON 解析失败也创建备份
    const backupKey = createBackup(rawData, -1);
    return { success: false, error: '存档 JSON 解析失败', backup: backupKey || null };
  }

  const sourceVersion = detectSchemaVersion(data);
  if (sourceVersion === -1) {
    const backupKey = createBackup(rawData, -1);
    return { success: false, error: '无法识别的存档格式', backup: backupKey || null };
  }

  // 拒绝未来版本存档：旧客户端不能加载新版本存档
  if (sourceVersion > CURRENT_SCHEMA_VERSION) {
    const backupKey = createBackup(rawData, sourceVersion);
    return {
      success: false,
      error: `存档版本 v${sourceVersion} 高于当前支持的 v${CURRENT_SCHEMA_VERSION}，请更新客户端`,
      backup: backupKey || null,
    };
  }

  // 已经是最新版本
  if (sourceVersion === CURRENT_SCHEMA_VERSION) {
    const obj = data as Record<string, unknown>;
    const state = (obj.state ?? obj) as unknown as PlayerSave;
    const validation = validatePlayerSave(state);
    if (!validation.valid) {
      const backupKey = createBackup(rawData, sourceVersion);
      return {
        success: false,
        error: `存档验证失败: ${validation.error}`,
        backup: backupKey || null,
      };
    }
    return { success: true, state, migratedFrom: sourceVersion };
  }

  // 创建备份
  const backupKey = createBackup(rawData, sourceVersion);

  // 提取初始状态
  let currentState: Record<string, unknown>;
  const obj = data as Record<string, unknown>;
  if (obj.state && typeof obj.state === 'object') {
    currentState = obj.state as Record<string, unknown>;
  } else {
    currentState = obj;
  }

  // 逐步迁移
  let currentVersion = sourceVersion;
  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.find((m) => m.fromVersion === currentVersion);
    if (!migration) {
      return {
        success: false,
        error: `缺少从 v${currentVersion} 到 v${currentVersion + 1} 的迁移路径`,
        backup: backupKey || null,
      };
    }

    try {
      currentState = migration.migrate(currentState);
      currentVersion = migration.toVersion;
    } catch (err) {
      return {
        success: false,
        error: `迁移 v${migration.fromVersion} → v${migration.toVersion} 失败: ${err}`,
        backup: backupKey || null,
      };
    }
  }

  // 验证最终结果
  const validation = validatePlayerSave(currentState);
  if (!validation.valid) {
    return {
      success: false,
      error: `迁移后验证失败: ${validation.error}`,
      backup: backupKey || null,
    };
  }

  return {
    success: true,
    state: currentState as unknown as PlayerSave,
    migratedFrom: sourceVersion,
  };
}

/**
 * 将 PlayerSave 封装为 SaveEnvelope。
 *
 * @param state 游戏状态
 * @param existingRevision 已有修订号（递增用）
 * @returns 完整的 SaveEnvelope
 */
export function wrapSaveEnvelope(state: PlayerSave, existingRevision = 0): SaveEnvelope {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    contentVersion: CURRENT_CONTENT_VERSION,
    revision: existingRevision + 1,
    savedAt: Date.now(),
    state,
  };
}

/**
 * 从 SaveEnvelope 或裸 PlayerSave 中提取游戏状态。
 *
 * @param data 存档数据
 * @returns PlayerSave 或 null
 */
export function extractPlayerSave(data: unknown): PlayerSave | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // SaveEnvelope 格式
  if (obj.state && typeof obj.state === 'object') {
    return obj.state as PlayerSave;
  }

  // 裸 PlayerSave 格式
  if (typeof obj.currentPositionId === 'string') {
    return obj as unknown as PlayerSave;
  }

  return null;
}
