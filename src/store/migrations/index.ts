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

/** GameTime 的 Zod schema */
const GameTimeSchema = z.object({
  year: z.number(),
  month: z.number(),
  day: z.number(),
  granularity: z.enum(['day', 'week', 'month']),
});

/** PlayerSave 的最小必要字段验证 schema */
const PlayerSaveSchema = z
  .object({
    saveId: z.string(),
    userId: z.string(),
    characterName: z.string(),
    currentPositionId: z.string(),
    currentLevel: z.number(),
    currentCareerLine: z.string(),
    slots: z.object({
      primary: SlotTierGroupSchema,
      secondary: SlotTierGroupSchema,
      reserve: SlotTierGroupSchema,
    }),
    time: GameTimeSchema,
    // 其余字段使用 passthrough 允许扩展
  })
  .passthrough();

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
 * @returns 版本号（0 表示无版本号的旧存档）
 */
export function detectSchemaVersion(data: unknown): number {
  if (!data || typeof data !== 'object') return -1;
  const obj = data as Record<string, unknown>;

  // 有 SaveEnvelope 结构
  if (typeof obj.schemaVersion === 'number') {
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
    return { success: false, error: '存档 JSON 解析失败', backup: null };
  }

  const sourceVersion = detectSchemaVersion(data);
  if (sourceVersion === -1) {
    return { success: false, error: '无法识别的存档格式', backup: null };
  }

  // 已经是最新版本
  if (sourceVersion >= CURRENT_SCHEMA_VERSION) {
    // 提取 state（可能是 SaveEnvelope 或裸 PlayerSave）
    const obj = data as Record<string, unknown>;
    const state = (obj.state ?? obj) as PlayerSave;
    const validation = validatePlayerSave(state);
    if (!validation.valid) {
      return { success: false, error: `存档验证失败: ${validation.error}`, backup: null };
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
