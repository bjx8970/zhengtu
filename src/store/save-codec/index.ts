/**
 * 存档严格解码器（Schema 4）
 *
 * 只接受当前版本（Schema 4）的完整 SaveEnvelope，拒绝所有其他格式。
 * Schema 1 存档拒绝前保留只读备份。
 * 支持 Schema 2 → 3 → 4 链式迁移。
 *
 * 领域枚举使用 domain/ 单一事实来源，不重复声明。
 */

import { z } from 'zod';
import type { PlayerSave } from '../../types/player';
import type { SaveEnvelope, SaveDecodeResult } from '../../types/save';
import {
  CURRENT_SCHEMA_VERSION,
  CURRENT_CONTENT_VERSION,
  MIN_MIGRATABLE_SCHEMA_VERSION,
} from '../../types/save';
import {
  INSTITUTION_LEVELS,
  POSITION_DOMAINS,
  LEADERSHIP_RANKS,
  CIVIL_SERVICE_RANKS,
  APPOINTMENT_TYPES,
  APPOINTMENT_REASONS,
  CAREER_OPPORTUNITY_TYPES,
  CAREER_OPPORTUNITY_STATUSES,
} from '../../domain/career/types';
import { POLICY_STATUSES, DomainSignalSnapshotSchema } from '../../domain/governance/types';
import {
  EVENT_PRIORITIES,
  EVENT_PRESENTATIONS,
  EVENT_INSTANCE_STATUSES,
  EVENT_CHAIN_STATUSES,
} from '../../domain/events/types';
import {
  EventOptionDefinitionSchema,
  EventOutcomePayloadSchema,
} from '../../domain/events/definition';

/** 不兼容存档备份的 localStorage key 前缀 */
const BACKUP_KEY_PREFIX = 'zhengtu_incompatible_save';
const MAX_BACKUPS = 3;

/**
 * 将不兼容存档移动到只读备份。
 *
 * @param rawData 原始存档 JSON 字符串
 * @returns 备份 key（空字符串表示备份失败）
 */
export function backupIncompatibleSave(rawData: string): string {
  try {
    for (let i = 0; i < MAX_BACKUPS; i++) {
      const key = i === 0 ? BACKUP_KEY_PREFIX : `${BACKUP_KEY_PREFIX}_${i}`;
      if (localStorage.getItem(key) === rawData) return key;
    }
    for (let i = 0; i < MAX_BACKUPS; i++) {
      const key = i === 0 ? BACKUP_KEY_PREFIX : `${BACKUP_KEY_PREFIX}_${i}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, rawData);
        return key;
      }
    }
    localStorage.setItem(BACKUP_KEY_PREFIX, rawData);
    return BACKUP_KEY_PREFIX;
  } catch {
    return '';
  }
}

// ===== Schema 2 Zod 验证（领域枚举来自 domain/ 单一事实来源） =====

/** CurrentAppointment Schema */
const CurrentAppointmentSchema = z
  .object({
    positionId: z.string(),
    institutionId: z.string(),
    regionId: z.string(),
    institutionLevel: z.enum(INSTITUTION_LEVELS),
    positionDomain: z.enum(POSITION_DOMAINS),
    leadershipRank: z.enum(LEADERSHIP_RANKS),
    startedAtDay: z.number(),
    appointmentType: z.enum(APPOINTMENT_TYPES),
    probationEndsAtDay: z.number().nullable(),
  })
  .strict();

/** CareerExperience Schema */
const CareerExperienceSchema = z
  .object({
    id: z.string(),
    positionId: z.string(),
    positionNameSnapshot: z.string(),
    institutionId: z.string(),
    institutionNameSnapshot: z.string(),
    institutionLevel: z.enum(INSTITUTION_LEVELS),
    regionId: z.string(),
    positionDomain: z.enum(POSITION_DOMAINS),
    leadershipRank: z.enum(LEADERSHIP_RANKS),
    startedAtDay: z.number(),
    endedAtDay: z.number().nullable(),
    appointmentReason: z.enum(APPOINTMENT_REASONS),
    assessmentResults: z.array(
      z
        .object({
          year: z.number(),
          score: z.number(),
          tier: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

/** CareerOpportunity Schema */
const CareerOpportunitySchema = z
  .object({
    id: z.string(),
    type: z.enum(CAREER_OPPORTUNITY_TYPES),
    status: z.enum(CAREER_OPPORTUNITY_STATUSES),
    targetPositionId: z.string(),
    targetInstitutionId: z.string(),
    targetRegionId: z.string(),
    appearedAtDay: z.number(),
    expiresAtDay: z.number().nullable(),
    reason: z.string(),
  })
  .strict();

/** CareerProcess Schema（stageResults 使用明确结构） */
const CareerProcessSchema = z
  .object({
    type: z.enum(['selection', 'inspection', 'probation']),
    opportunityId: z.string(),
    currentStage: z.string(),
    startedAtDay: z.number(),
    stageResults: z
      .object({
        voteFor: z.number().optional(),
        voteAgainst: z.number().optional(),
        inspectionResult: z.string().optional(),
        passed: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

/** CareerState Schema */
const CareerStateSchema = z
  .object({
    appointment: CurrentAppointmentSchema,
    civilServiceRank: z.enum(CIVIL_SERVICE_RANKS),
    experiences: z.array(CareerExperienceSchema),
    specialties: z.record(z.number()),
    opportunities: z.array(CareerOpportunitySchema),
    activeProcess: CareerProcessSchema.nullable(),
  })
  .strict();

/** GovernanceState Schema */
const GovernanceStateSchema = z
  .object({
    policies: z.array(
      z
        .object({
          instanceId: z.string(),
          policyId: z.string(),
          status: z.enum(POLICY_STATUSES),
          proposedAtDay: z.number(),
          approvedAtDay: z.number().nullable(),
          effectiveAtDay: z.number().nullable(),
          regionId: z.string(),
          responsibleInstitutionId: z.string(),
          currentPhaseId: z.string(),
          metrics: z.record(z.number()),
        })
        .strict(),
    ),
    projects: z.array(
      z
        .object({
          instanceId: z.string(),
          projectId: z.string(),
          status: z.enum(['planning', 'active', 'completed', 'suspended', 'failed']),
          startedAtDay: z.number(),
          regionId: z.string(),
          institutionId: z.string(),
          metrics: z.record(z.number()),
        })
        .strict(),
    ),
    institutionMetrics: z.record(z.record(z.number())),
    regionMetrics: z.record(z.record(z.number())),
  })
  .strict();

/** EventExecutableSnapshot Schema */
const EventExecutableSnapshotSchema = z
  .object({
    eventId: z.string(),
    title: z.string(),
    description: z.string(),
    category: z.string(),
    priority: z.enum(EVENT_PRIORITIES),
    presentation: z.enum(EVENT_PRESENTATIONS),
    options: z.array(EventOptionDefinitionSchema),
    automaticOutcome: EventOutcomePayloadSchema.nullable(),
    mutexGroup: z.string().nullable(),
    contentVersion: z.string(),
    deadlineDays: z.number().nullable(),
    chainId: z.string().nullable(),
    nodeId: z.string().nullable(),
  })
  .strict();

/** AppliedEffectRecord Schema */
const AppliedEffectRecordSchema = z
  .object({
    target: z.string(),
    field: z.string().optional(),
    operation: z.string(),
    value: z.union([z.boolean(), z.number(), z.string()]),
    label: z.string(),
  })
  .strict();

/** EventCooldownRecord Schema */
const EventCooldownRecordSchema = z
  .object({
    eventId: z.string(),
    scope: z.enum(['global', 'source', 'chain']),
    scopeId: z.string().nullable(),
    untilDay: z.number(),
  })
  .strict();

/** EventRuntimeState Schema（Schema 4：cooldowns 数组 + snapshot + sourceKey） */
const EventRuntimeStateSchema = z
  .object({
    activeBlockingEventId: z.string().nullable(),
    pending: z.array(
      z
        .object({
          instanceId: z.string(),
          eventId: z.string(),
          status: z.enum(EVENT_INSTANCE_STATUSES),
          triggeredAtDay: z.number(),
          activatedAtDay: z.number(),
          deadlineDay: z.number().nullable(),
          triggerContext: DomainSignalSnapshotSchema,
          sourceKey: z.string(),
          chainInstanceId: z.string().nullable(),
          snapshot: EventExecutableSnapshotSchema,
        })
        .strict(),
    ),
    scheduled: z.array(
      z
        .object({
          instanceId: z.string(),
          eventId: z.string(),
          scheduledAtDay: z.number(),
          activateAtDay: z.number(),
          triggerContext: DomainSignalSnapshotSchema,
          sourceKey: z.string(),
          chainInstanceId: z.string().nullable(),
          snapshot: EventExecutableSnapshotSchema,
        })
        .strict(),
    ),
    history: z.array(
      z
        .object({
          eventId: z.string(),
          instanceId: z.string(),
          finalStatus: z.enum(['resolved', 'expired', 'cancelled']),
          triggeredAtDay: z.number(),
          completedAtDay: z.number(),
          sourceKey: z.string(),
          chainInstanceId: z.string().nullable(),
          titleSnapshot: z.string(),
          chosenOptionId: z.string().nullable(),
          chosenOptionLabel: z.string().nullable(),
          appliedEffects: z.array(AppliedEffectRecordSchema),
        })
        .strict(),
    ),
    cooldowns: z.array(EventCooldownRecordSchema),
    chainInstances: z.record(
      z
        .object({
          instanceId: z.string(),
          chainId: z.string(),
          status: z.enum(EVENT_CHAIN_STATUSES),
          sourceKey: z.string(),
          activeNodeIds: z.array(z.string()),
          completedNodeIds: z.array(z.string()),
          startedAtDay: z.number(),
          completedAtDay: z.number().nullable(),
        })
        .strict(),
    ),
    processedSignalIds: z.array(z.string()),
  })
  .strict();

/** WorldState Schema */
const WorldStateSchema = z
  .object({
    facts: z.record(z.union([z.boolean(), z.number(), z.string()])),
    metrics: z.record(z.number()),
    activeCycles: z.array(
      z
        .object({
          type: z.enum(['party_congress', 'people_congress', 'local_election']),
          termNumber: z.number(),
          startedAtDay: z.number(),
          endsAtDay: z.number(),
          phase: z.enum(['preparation', 'session', 'implementation', 'evaluation']),
        })
        .strict(),
    ),
  })
  .strict();

/** SlotOccupant Schema */
const SlotOccupantSchema = z
  .object({
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
      .strict()
      .optional(),
  })
  .strict();

/** ActionRuntimeState Schema */
const ActionRuntimeStateSchema = z
  .object({
    slots: z
      .object({
        primary: z
          .object({
            label: z.string(),
            count: z.number(),
            occupants: z.array(z.nullable(SlotOccupantSchema)),
          })
          .strict(),
        secondary: z
          .object({
            label: z.string(),
            count: z.number(),
            occupants: z.array(z.nullable(SlotOccupantSchema)),
          })
          .strict(),
        reserve: z
          .object({
            label: z.string(),
            count: z.number(),
            occupants: z.array(z.nullable(SlotOccupantSchema)),
          })
          .strict(),
      })
      .strict(),
    departmentStates: z.record(
      z
        .object({
          id: z.string(),
          kpiValues: z.record(z.number()),
          monthlyConsumption: z.number(),
          cumulativeConsumption: z.number(),
          lastActionDay: z.number(),
          actionCooldownUntilDays: z.record(z.number()),
        })
        .strict(),
    ),
    totalActions: z.number(),
    lastCompletedActions: z.array(
      z
        .object({
          actionName: z.string(),
          deptName: z.string(),
          effects: z.array(z.string()),
          completedAtDay: z.number(),
        })
        .strict(),
    ),
  })
  .strict();

/** CharacterState Schema */
const CharacterStateSchema = z
  .object({
    saveId: z.string(),
    userId: z.string(),
    characterName: z.string(),
    gender: z.enum(['男', '女']),
    birthPlace: z.object({ province: z.string(), city: z.string() }).strict(),
    birthYear: z.number(),
    gaokaoScore: z.number(),
    gaokaoTier: z.string(),
    university: z.string(),
    universityTier: z.string(),
    familyBackground: z.enum(['peasant', 'worker', 'merchant', 'cadre', 'academic']),
    promotionPath: z.enum(['xuandiao', 'gongwuyuan', 'junzhuan', 'guoqi']),
    isPreparatory: z.boolean(),
    vigor: z.number(),
    politicalCapital: z.number(),
    integrity: z.number(),
    stability: z.number(),
    performance: z.number(),
    charisma: z.number(),
    competence: z.number(),
    network: z.number(),
    diligence: z.number(),
    ambition: z.number(),
    corruptionRisk: z.number(),
    isUnderInvestigation: z.boolean(),
    philosophy: z.object({ scores: z.record(z.number()) }).strict(),
    relations: z
      .object({
        classmates: z.record(z.number()),
        colleagues: z.record(z.number()),
        business: z.record(z.number()),
        academic: z.record(z.number()),
        media: z.record(z.number()),
        central: z.record(z.number()),
      })
      .strict(),
  })
  .strict();

/** PlayerSave Schema（Schema 2，.strict() 拒绝旧职业字段） */
const PlayerSaveSchema = z
  .object({
    character: CharacterStateSchema,
    time: z
      .object({
        year: z.number().int().min(1),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(30),
        granularity: z.enum(['day', 'week', 'month']),
        totalDaysPlayed: z.number().min(0),
      })
      .strict(),
    career: CareerStateSchema,
    governance: GovernanceStateSchema,
    events: EventRuntimeStateSchema,
    world: WorldStateSchema,
    actions: ActionRuntimeStateSchema,
    assessments: z
      .object({
        comprehensiveScore: z.number(),
        annualAssessments: z.array(
          z
            .object({
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
                .strict()
                .optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    remainingBudget: z.number(),
    updatedAt: z.number(),
  })
  .strict();

/** SaveEnvelope Schema（Schema 2） */
const SaveEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().min(0),
    contentVersion: z.string(),
    revision: z.number().int().min(0),
    savedAt: z.number(),
    state: PlayerSaveSchema,
  })
  .strict();

// ===== 静态一致性检查：确保 Schema 与 TypeScript 类型不漂移 =====

/**
 * 编译期双向可赋值检查。
 * 如果 PlayerSaveSchema 与 PlayerSave 不一致，此处会产生类型错误。
 */
type SchemaInferred = z.infer<typeof PlayerSaveSchema>;
type _AssertSchemaToType = SchemaInferred extends PlayerSave ? true : never;
type _AssertTypeToSchema = PlayerSave extends SchemaInferred ? true : never;
const _schemaConsistencyCheck: _AssertSchemaToType = true;
const _typeConsistencyCheck: _AssertTypeToSchema = true;
void _schemaConsistencyCheck;
void _typeConsistencyCheck;

// ===== 公开 API =====

/**
 * 验证 PlayerSave 数据是否符合 Schema 2。
 *
 * @param data 待验证数据
 * @returns 验证结果
 */
export function validatePlayerSave(data: unknown): { valid: boolean; error?: string } {
  const result = PlayerSaveSchema.safeParse(data);
  if (result.success) return { valid: true };
  return { valid: false, error: result.error.message };
}

/**
 * 将 PlayerSave 封装为 SaveEnvelope。
 *
 * revision 为递增修订号：传入现有 revision，返回 revision + 1。
 *
 * @param state 游戏状态
 * @param existingRevision 现有修订号（默认 0，首次保存）
 * @returns SaveEnvelope（revision 已递增）
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
 * 将 Schema 2 存档迁移至 Schema 3。
 *
 * Schema 2 → 3 的唯一变化：治理指标从扁平 `Record<string, number>`
 * 改为嵌套 `MetricCollection = Record<string, Record<string, number>>`。
 * 旧扁平结构在新模型下无有效解释，且 Schema 2 阶段治理子系统未投产、
 * 指标恒为空对象，故迁移确定性地重置为空集合（不丢失任何真实数据）。
 *
 * @param raw 已解析的 Schema 2 SaveEnvelope 对象
 * @returns 迁移后的 Schema 3 SaveEnvelope 对象
 */
export function migrateSchema2To3(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(raw);
  const state = migrated.state as Record<string, unknown> | undefined;
  const governance = state?.governance as Record<string, unknown> | undefined;
  if (governance) {
    governance.institutionMetrics = {};
    governance.regionMetrics = {};
  }
  migrated.schemaVersion = 3;
  return migrated;
}

/**
 * 将 Schema 3 存档迁移至 Schema 4。
 *
 * Schema 3 → 4 的变化：
 * - events.cooldownUntilDay（Record）→ events.cooldowns（Array）
 * - EventInstance 增加 sourceKey、activatedAtDay、snapshot
 * - ScheduledEventInstance 增加 sourceKey、snapshot
 * - EventHistoryRecord 重构（resolvedAtDay → completedAtDay，增加 finalStatus 等）
 * - EventChainInstance 用 sourceKey 替代 sourceEntityType+sourceEntityId
 * - 存在非空事件实例时安全失败（无法补全快照）
 *
 * @param raw 已解析的 Schema 3 SaveEnvelope 对象
 * @returns 迁移后的 Schema 4 SaveEnvelope 对象
 */
export function migrateSchema3To4(raw: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(raw);
  const state = migrated.state as Record<string, unknown> | undefined;
  const events = state?.events as Record<string, unknown> | undefined;

  if (events) {
    // 旧 cooldownUntilDay → 新 cooldowns[]
    const oldCooldown = events.cooldownUntilDay as Record<string, number> | undefined;
    if (oldCooldown) {
      const cooldowns: Array<Record<string, unknown>> = [];
      for (const [eventId, untilDay] of Object.entries(oldCooldown)) {
        cooldowns.push({ eventId, scope: 'global', scopeId: null, untilDay });
      }
      (events as Record<string, unknown>).cooldowns = cooldowns;
      delete (events as Record<string, unknown>).cooldownUntilDay;
    } else {
      (events as Record<string, unknown>).cooldowns = [];
    }

    // 确保 cooldowns 存在
    if (!events.cooldowns) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (events as any).cooldowns = [];
    }

    // Schema 4 新增字段：已处理信号 ID
    if (!events.processedSignalIds) {
      (events as Record<string, unknown>).processedSignalIds = [];
    }

    // 迁移 pending/scheduled/history 中的事件实例
    const pending = events.pending as Array<Record<string, unknown>> | undefined;
    const scheduled = events.scheduled as Array<Record<string, unknown>> | undefined;
    const history = events.history as Array<Record<string, unknown>> | undefined;

    const hasNonEmptyEvents =
      (pending && pending.length > 0) ||
      (scheduled && scheduled.length > 0) ||
      (history && history.length > 0);

    if (hasNonEmptyEvents) {
      throw new Error(
        'Schema 3→4 migration failed: non-empty event instances cannot be patched with snapshots',
      );
    }

    // 空事件状态直接迁移，为兼容性增加默认字段
    if (pending) {
      for (const inst of pending) {
        inst.sourceKey = inst.sourceKey || '';
        inst.activatedAtDay = inst.activatedAtDay || inst.triggeredAtDay || 0;
        inst.snapshot = inst.snapshot || {
          eventId: inst.eventId || '',
          title: '',
          description: '',
          category: '',
          priority: 'normal',
          presentation: 'inbox',
          options: [],
          automaticOutcome: null,
          mutexGroup: null,
          contentVersion: '',
          deadlineDays: null,
          chainId: null,
          nodeId: null,
        };
        // 移除旧字段
        delete inst.priority;
        delete inst.presentation;
      }
    }
    if (scheduled) {
      for (const inst of scheduled) {
        inst.sourceKey = inst.sourceKey || '';
        inst.scheduledAtDay = inst.scheduledAtDay || inst.activateAtDay || 0;
        inst.snapshot = inst.snapshot || {
          eventId: inst.eventId || '',
          title: '',
          description: '',
          category: '',
          priority: 'normal',
          presentation: 'inbox',
          options: [],
          automaticOutcome: null,
          mutexGroup: null,
          contentVersion: '',
          deadlineDays: null,
          chainId: null,
          nodeId: null,
        };
      }
    }
    if (history) {
      for (const rec of history) {
        rec.finalStatus = rec.finalStatus || 'resolved';
        rec.triggeredAtDay = rec.triggeredAtDay || rec.resolvedAtDay || 0;
        rec.completedAtDay = rec.completedAtDay || rec.resolvedAtDay || 0;
        rec.sourceKey = rec.sourceKey || '';
        rec.titleSnapshot = rec.titleSnapshot || '';
        rec.chosenOptionLabel = rec.chosenOptionLabel || null;
        rec.appliedEffects = rec.appliedEffects || [];
        delete rec.resolvedAtDay;
        delete rec.outcome;
      }
    }

    // 迁移 chainInstances
    const chainInstances = events.chainInstances as
      Record<string, Record<string, unknown>> | undefined;
    if (chainInstances) {
      for (const [, chain] of Object.entries(chainInstances)) {
        chain.sourceKey = chain.sourceKey || `${chain.sourceEntityType}_${chain.sourceEntityId}`;
        chain.completedAtDay = chain.completedAtDay ?? null;
        delete chain.sourceEntityType;
        delete chain.sourceEntityId;
      }
    }
  }

  migrated.schemaVersion = 4;
  return migrated;
}

/**
 * 严格解码存档数据（已解析的对象）。
 *
 * 支持从 MIN_MIGRATABLE_SCHEMA_VERSION 开始的确定性迁移：
 * - 低于可迁移版本：拒绝为 legacy；
 * - Schema 2：迁移至 Schema 3 后解碼，Schema 3 再迁移至 4；
 * - Schema 3：迁移至 Schema 4；
 * - 当前版本（Schema 4）：直接解碼；
 * - 高于当前版本：拒绝为 future。
 *
 * @param data 已解析的存档数据
 * @returns 解码结果
 */
export function decodeCurrentSaveData(data: unknown): SaveDecodeResult {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'invalid_envelope', detail: 'Data is not an object' };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.schemaVersion !== 'number') {
    return {
      success: false,
      error: 'legacy_save_unsupported',
      detail: 'Bare PlayerSave without SaveEnvelope',
    };
  }

  if (obj.schemaVersion < MIN_MIGRATABLE_SCHEMA_VERSION) {
    return {
      success: false,
      error: 'legacy_save_unsupported',
      detail: `Schema ${obj.schemaVersion} < min migratable ${MIN_MIGRATABLE_SCHEMA_VERSION}`,
    };
  }
  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      error: 'future_version',
      detail: `Schema ${obj.schemaVersion} > current ${CURRENT_SCHEMA_VERSION}`,
    };
  }

  // 确定性迁移链至当前版本
  let target: unknown = data;
  try {
    if (obj.schemaVersion === 2) {
      target = migrateSchema3To4(migrateSchema2To3(obj));
    } else if (obj.schemaVersion === 3) {
      target = migrateSchema3To4(obj);
    }
  } catch (e) {
    return {
      success: false,
      error: 'migration_failed',
      detail: e instanceof Error ? e.message : 'Unknown migration error',
    };
  }

  const result = SaveEnvelopeSchema.safeParse(target);
  if (!result.success) {
    return { success: false, error: 'invalid_envelope', detail: result.error.message };
  }

  return { success: true, state: result.data.state as PlayerSave };
}

/**
 * 严格解码存档 JSON 字符串。
 *
 * @param raw JSON 字符串
 * @returns 解码结果
 */
export function decodeCurrentSave(raw: string): SaveDecodeResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    backupIncompatibleSave(raw);
    return {
      success: false,
      error: 'invalid_json',
      detail: 'JSON parse failed',
      backupKey: BACKUP_KEY_PREFIX,
    };
  }

  const result = decodeCurrentSaveData(data);

  if (!result.success) {
    const backupKey = backupIncompatibleSave(raw);
    return { ...result, backupKey: backupKey || undefined };
  }

  return result;
}
