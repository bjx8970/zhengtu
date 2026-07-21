/**
 * 存档严格解码器
 *
 * 本版本明确不兼容旧存档，不提供任何旧存档自动迁移。
 * 只接受当前版本的完整 SaveEnvelope，拒绝所有其他格式。
 *
 * 严格流程：
 * 读取原始数据 → 必须是完整 SaveEnvelope → schemaVersion 必须等于 CURRENT
 * → 完整验证 Envelope 和 PlayerSave → 成功加载
 *
 * 拒绝：裸旧版 PlayerSave、低版本、未来版本、缺失元数据、结构验证失败。
 * 不兼容或损坏的存档会被移动到只读备份 key，避免重复备份。
 */

import { z } from 'zod';
import type { PlayerSave } from '../../types/player';
import type { SaveEnvelope, SaveDecodeResult } from '../../types/save';
import { CURRENT_SCHEMA_VERSION, CURRENT_CONTENT_VERSION } from '../../types/save';

/** 不兼容存档备份的 localStorage key 前缀 */
const BACKUP_KEY_PREFIX = 'zhengtu_incompatible_save';
/** 最大备份数量 */
const MAX_BACKUPS = 3;

/**
 * 将不兼容存档移动到只读备份。
 *
 * 相同内容不重复备份，不同内容创建新备份（最多保留 MAX_BACKUPS 份）。
 *
 * @param rawData 原始存档 JSON 字符串
 * @returns 备份 key（空字符串表示备份失败）
 */
export function backupIncompatibleSave(rawData: string): string {
  try {
    // 检查是否已有相同内容的备份
    for (let i = 0; i < MAX_BACKUPS; i++) {
      const key = i === 0 ? BACKUP_KEY_PREFIX : `${BACKUP_KEY_PREFIX}_${i}`;
      const existing = localStorage.getItem(key);
      if (existing === rawData) {
        return key; // 相同内容已备份
      }
    }

    // 找到第一个空槽位
    for (let i = 0; i < MAX_BACKUPS; i++) {
      const key = i === 0 ? BACKUP_KEY_PREFIX : `${BACKUP_KEY_PREFIX}_${i}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, rawData);
        return key;
      }
    }

    // 所有槽位已满，覆盖最旧的（第一个）
    localStorage.setItem(BACKUP_KEY_PREFIX, rawData);
    return BACKUP_KEY_PREFIX;
  } catch {
    return '';
  }
}

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
const PlayerSaveSchema = z
  .object({
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
    currentPositionId: z.string(),
    currentLevel: z.number().int().min(1).max(11),
    currentCareerLine: z.string().refine((v) => VALID_CAREER_LINES.includes(v)),
    yearsInCurrentPosition: z.number().min(0),
    slots: z.object({
      primary: SlotTierGroupSchema,
      secondary: SlotTierGroupSchema,
      reserve: SlotTierGroupSchema,
    }),
    vigor: z.number(),
    politicalCapital: z.number(),
    remainingBudget: z.number(),
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
    integrity: z.number(),
    stability: z.number(),
    performance: z.number(),
    charisma: z.number(),
    competence: z.number(),
    network: z.number(),
    diligence: z.number(),
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
    transferCount: z.number(),
    isLineLocked: z.boolean(),
    departmentStates: z.record(DepartmentStateSchema),
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
    secretary: z.nullable(
      z.object({
        id: z.string(),
        name: z.string(),
        experience: z.number(),
        level: z.string(),
      }),
    ),
    relations: z.object({
      classmates: z.record(z.number()),
      colleagues: z.record(z.number()),
      business: z.record(z.number()),
      academic: z.record(z.number()),
      media: z.record(z.number()),
      central: z.record(z.number()),
    }),
    philosophy: z.object({ scores: z.record(z.number()) }),
    reserveTier: z.number(),
    ambition: z.number(),
    corruptionRisk: z.number(),
    isUnderInvestigation: z.boolean(),
    time: GameTimeSchema,
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
    endgameReached: z.boolean(),
    updatedAt: z.number(),
  })
  .strict();

/** SaveEnvelope 的 Zod schema（严格模式，拒绝未知字段） */
const SaveEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().min(0),
    contentVersion: z.string(),
    revision: z.number().int().min(0),
    savedAt: z.number(),
    state: PlayerSaveSchema,
  })
  .strict();

// ===== 公开 API =====

/**
 * 严格解码已解析的存档数据。
 *
 * 只接受当前版本的完整 SaveEnvelope，拒绝所有其他格式。
 *
 * @param data 已解析的存档数据
 * @returns 解码结果
 */
export function decodeCurrentSaveData(data: unknown): SaveDecodeResult {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'invalid_envelope', detail: '数据不是有效对象' };
  }

  const obj = data as Record<string, unknown>;

  // 检测裸旧版 PlayerSave（无 schemaVersion 但有 currentPositionId）
  if (typeof obj.schemaVersion !== 'number' && typeof obj.currentPositionId === 'string') {
    return {
      success: false,
      error: 'legacy_save_unsupported',
      detail: '本次大型版本不兼容旧存档，需要重新开始',
    };
  }

  // 必须有 schemaVersion
  if (typeof obj.schemaVersion !== 'number') {
    return { success: false, error: 'invalid_envelope', detail: '缺失 schemaVersion' };
  }

  // 拒绝未来版本
  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      error: 'future_version',
      detail: `存档版本 v${obj.schemaVersion} 高于当前支持的 v${CURRENT_SCHEMA_VERSION}，请更新客户端`,
    };
  }

  // 拒绝低版本（不兼容旧存档）
  if (obj.schemaVersion < CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      error: 'legacy_save_unsupported',
      detail: `存档版本 v${obj.schemaVersion} 低于当前版本 v${CURRENT_SCHEMA_VERSION}，本次大型版本不兼容旧存档`,
    };
  }

  // 验证完整 Envelope 结构
  const envelopeResult = SaveEnvelopeSchema.safeParse(data);
  if (!envelopeResult.success) {
    return {
      success: false,
      error: 'invalid_envelope',
      detail: `存档结构验证失败: ${envelopeResult.error.message}`,
    };
  }

  return { success: true, state: envelopeResult.data.state as PlayerSave };
}

/**
 * 严格解码原始 JSON 字符串存档。
 *
 * @param rawData 原始存档 JSON 字符串
 * @returns 解码结果
 */
export function decodeCurrentSave(rawData: string): SaveDecodeResult {
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    // JSON 解析失败也创建备份
    const backupKey = backupIncompatibleSave(rawData);
    return {
      success: false,
      error: 'invalid_json',
      detail: '存档 JSON 解析失败',
      backupKey: backupKey || undefined,
    };
  }

  const result = decodeCurrentSaveData(data);

  // 不兼容或损坏的存档创建只读备份
  if (!result.success && rawData.length > 0) {
    result.backupKey = backupIncompatibleSave(rawData) || undefined;
  }

  return result;
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
