/**
 * 存档严格解码器（Schema 2）
 *
 * 只接受当前版本（Schema 2）的完整 SaveEnvelope，拒绝所有其他格式。
 * Schema 1 存档拒绝前保留只读备份。
 *
 * 严格流程：
 * 读取原始数据 → 必须是完整 SaveEnvelope → schemaVersion 必须等于 CURRENT
 * → 完整验证 Envelope 和 PlayerSave → 成功加载
 *
 * 拒绝：裸旧版 PlayerSave、Schema 1、未来版本、缺失元数据、结构验证失败。
 */

import { z } from 'zod';
import type { PlayerSave } from '../../types/player';
import type { SaveEnvelope, SaveDecodeResult } from '../../types/save';
import { CURRENT_SCHEMA_VERSION, CURRENT_CONTENT_VERSION } from '../../types/save';

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
    // 所有槽位已满，覆盖最旧的
    localStorage.setItem(BACKUP_KEY_PREFIX, rawData);
    return BACKUP_KEY_PREFIX;
  } catch {
    return '';
  }
}

// ===== Schema 2 Zod 验证 =====

/** 领域枚举值 */
const INSTITUTION_LEVELS = ['township', 'county', 'prefecture', 'province', 'central'] as const;
const POSITION_DOMAINS = [
  'local_governance',
  'party_organs',
  'government_general',
  'government_specialized',
  'discipline_inspection',
  'congress',
  'cppcc',
  'mass_organs',
  'central_institutions',
  'national_security',
] as const;
const LEADERSHIP_RANKS = [
  'none',
  'township_deputy',
  'township_chief',
  'county_deputy',
  'county_chief',
  'prefecture_deputy',
  'prefecture_chief',
  'province_deputy',
  'province_chief',
  'national_deputy',
  'national_chief',
] as const;
const CIVIL_SERVICE_RANKS = [
  'clerk_2',
  'clerk_1',
  'section_member_4',
  'section_member_3',
  'section_member_2',
  'section_member_1',
  'researcher_4',
  'researcher_3',
  'researcher_2',
  'researcher_1',
  'inspector_2',
  'inspector_1',
] as const;
const APPOINTMENT_TYPES = ['substantive', 'acting', 'temporary', 'secondment'] as const;
const APPOINTMENT_REASONS = [
  'initial_assignment',
  'promotion',
  'lateral_transfer',
  'rotation',
  'temporary_assignment',
  'secondment',
  'demotion',
] as const;
const POLICY_STATUSES = [
  'proposed',
  'approved',
  'implementing',
  'suspended',
  'completed',
  'failed',
  'repealed',
] as const;

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
      z.object({
        year: z.number(),
        score: z.number(),
        tier: z.string(),
      }),
    ),
  })
  .strict();

/** CareerOpportunity Schema */
const CareerOpportunitySchema = z
  .object({
    id: z.string(),
    type: z.enum([
      'promotion',
      'lateral_transfer',
      'rotation',
      'secondment',
      'demotion',
      'retirement',
    ]),
    status: z.enum(['available', 'applied', 'under_review', 'accepted', 'rejected', 'expired']),
    targetPositionId: z.string(),
    targetInstitutionId: z.string(),
    targetRegionId: z.string(),
    appearedAtDay: z.number(),
    expiresAtDay: z.number().nullable(),
    reason: z.string(),
  })
  .strict();

/** CareerProcess Schema */
const CareerProcessSchema = z
  .object({
    type: z.enum(['selection', 'inspection', 'probation']),
    opportunityId: z.string(),
    currentStage: z.string(),
    startedAtDay: z.number(),
    stageResults: z.record(z.unknown()),
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
    institutionMetrics: z.record(z.number()),
    regionMetrics: z.record(z.number()),
  })
  .strict();

/** EventRuntimeState Schema */
const EventRuntimeStateSchema = z
  .object({
    activeBlockingEventId: z.string().nullable(),
    pending: z.array(
      z
        .object({
          instanceId: z.string(),
          eventId: z.string(),
          status: z.enum(['pending', 'active', 'resolved', 'expired', 'cancelled']),
          priority: z.enum(['low', 'normal', 'high', 'urgent']),
          presentation: z.enum(['blocking', 'inbox', 'automatic']),
          triggeredAtDay: z.number(),
          sourceSignal: z.string(),
          triggerContext: z.record(z.union([z.number(), z.string(), z.boolean()])),
          deadlineDay: z.number().nullable(),
          chainInstanceId: z.string().nullable(),
        })
        .strict(),
    ),
    scheduled: z.array(
      z
        .object({
          instanceId: z.string(),
          eventId: z.string(),
          activateAtDay: z.number(),
          sourceSignal: z.string(),
          triggerContext: z.record(z.union([z.number(), z.string(), z.boolean()])),
          chainInstanceId: z.string().nullable(),
        })
        .strict(),
    ),
    history: z.array(
      z
        .object({
          eventId: z.string(),
          instanceId: z.string(),
          resolvedAtDay: z.number(),
          chosenOptionId: z.string().nullable(),
          outcome: z.string(),
        })
        .strict(),
    ),
    cooldownUntilDay: z.record(z.number()),
    chainInstances: z.record(
      z
        .object({
          instanceId: z.string(),
          chainId: z.string(),
          status: z.enum(['active', 'completed', 'failed', 'abandoned']),
          currentStepIndex: z.number(),
          sourceContext: z.record(z.union([z.string(), z.number()])),
          startedAtDay: z.number(),
          completedStepIds: z.array(z.string()),
        })
        .strict(),
    ),
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

/** PlayerSave Schema（Schema 2） */
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
 * @param state 游戏状态
 * @param revision 修订号（默认 0）
 * @returns SaveEnvelope
 */
export function wrapSaveEnvelope(state: PlayerSave, revision = 0): SaveEnvelope {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    contentVersion: CURRENT_CONTENT_VERSION,
    revision,
    savedAt: Date.now(),
    state,
  };
}

/**
 * 严格解码存档数据（已解析的对象）。
 *
 * @param data 已解析的存档数据
 * @returns 解码结果
 */
export function decodeCurrentSaveData(data: unknown): SaveDecodeResult {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'invalid_envelope', detail: 'Data is not an object' };
  }

  const obj = data as Record<string, unknown>;

  // 检查是否为 SaveEnvelope 结构
  if (typeof obj.schemaVersion !== 'number') {
    // 裸 PlayerSave（无 Envelope）
    return {
      success: false,
      error: 'legacy_save_unsupported',
      detail: 'Bare PlayerSave without SaveEnvelope',
    };
  }

  // Schema 版本检查
  if (obj.schemaVersion < CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      error: 'legacy_save_unsupported',
      detail: `Schema ${obj.schemaVersion} < current ${CURRENT_SCHEMA_VERSION}`,
    };
  }
  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      success: false,
      error: 'future_version',
      detail: `Schema ${obj.schemaVersion} > current ${CURRENT_SCHEMA_VERSION}`,
    };
  }

  // 完整 Envelope 验证
  const result = SaveEnvelopeSchema.safeParse(data);
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
