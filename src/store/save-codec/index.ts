/**
 * 存档严格解码器（Schema 9）
 *
 * 只接受当前版本（Schema 9）的完整 SaveEnvelope，拒绝所有其他格式。
 * Schema 1 存档拒绝前保留只读备份。
 * 支持 Schema 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 链式迁移。
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
  CAREER_OPPORTUNITY_STATUSES,
} from '../../domain/career/types';
import {
  POLICY_STATUSES,
  POLICY_CATEGORIES,
  DomainSignalSnapshotSchema,
} from '../../domain/governance/types';
import { ConditionExpressionSchema, EffectDefinitionSchema } from '../../domain/conditions';
import {
  EVENT_PRIORITIES,
  EVENT_PRESENTATIONS,
  EVENT_INSTANCE_STATUSES,
  EVENT_CHAIN_STATUSES,
} from '../../domain/events/types';
import {
  EventOptionDefinitionSchema,
  EventOutcomePayloadSchema,
  EventRepeatPolicySchema,
} from '../../domain/events/definition';
import { getConfigLoader } from '../../config/loader';
import { createActionExecutableSnapshot } from '../action-executable-snapshot';

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

/** 试用期单次评估审计 Schema。 */
const ProbationEvaluationRecordSchema = z
  .object({
    evaluatedAtDay: z.number().int().nonnegative(),
    outcome: z.enum(['passed', 'extended', 'failed']),
    score: z.number().min(0).max(100),
    completedActionCount: z.number().int().nonnegative(),
    unmetRequirements: z.array(z.string().min(1)),
    previousEndsAtDay: z.number().int().nonnegative(),
    nextEndsAtDay: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** 任职试用期生命周期 Schema。 */
const AppointmentProbationSchema = z
  .object({
    status: z.enum(['active', 'passed', 'failed']),
    startedAtDay: z.number().int().nonnegative(),
    endsAtDay: z.number().int().nonnegative(),
    extensionCount: z.number().int().nonnegative(),
    completedActionCount: z.number().int().nonnegative(),
    resolvedAtDay: z.number().int().nonnegative().nullable(),
    outcomeReason: z.string().min(1).nullable(),
    evaluations: z.array(ProbationEvaluationRecordSchema),
  })
  .strict()
  .superRefine((probation, ctx) => {
    if (probation.endsAtDay < probation.startedAtDay)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Probation end precedes start' });
    const active = probation.status === 'active';
    if (active && probation.resolvedAtDay !== null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Active probation cannot have a resolution date',
      });
    if (!active && (probation.resolvedAtDay === null || probation.outcomeReason === null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal probation requires resolution metadata',
      });
    const latestEvaluation = probation.evaluations[probation.evaluations.length - 1];
    if (active && latestEvaluation && latestEvaluation.outcome !== 'extended')
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Active probation can only retain an extension evaluation',
      });
    if (active && !latestEvaluation && probation.outcomeReason !== null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Initial probation cannot have an outcome reason',
      });
  });

/** CurrentAppointment Schema */
const CurrentAppointmentSchema = z
  .object({
    appointmentId: z.string().min(1),
    positionId: z.string(),
    institutionId: z.string(),
    regionId: z.string(),
    institutionLevel: z.enum(INSTITUTION_LEVELS),
    positionDomain: z.enum(POSITION_DOMAINS),
    leadershipRank: z.enum(LEADERSHIP_RANKS),
    startedAtDay: z.number(),
    appointmentType: z.enum(APPOINTMENT_TYPES),
    appointmentReason: z.enum(APPOINTMENT_REASONS),
    sourceOpportunityId: z.string().nullable(),
    probation: AppointmentProbationSchema.nullable(),
  })
  .strict()
  .superRefine((appointment, ctx) => {
    if (appointment.probation && appointment.probation.startedAtDay !== appointment.startedAtDay)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Probation start must match appointment start',
      });
  });

/** CareerExperience Schema */
const CareerExperienceSchema = z
  .object({
    id: z.string(),
    appointmentId: z.string().min(1),
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
    appointmentType: z.enum(APPOINTMENT_TYPES),
    sourceOpportunityId: z.string().nullable(),
    endReason: z
      .enum([
        'promotion',
        'lateral_transfer',
        'rotation',
        'temporary_assignment',
        'secondment',
        'demotion',
        'retirement',
        'probation_failed',
      ])
      .nullable(),
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

/** 职业机会共享存档 Schema。 */
const CareerOpportunityBaseSchema = z
  .object({
    id: z.string(),
    definitionId: z.string().min(1),
    status: z.enum(CAREER_OPPORTUNITY_STATUSES),
    source: z
      .object({
        sourceType: z.enum([
          'assessment',
          'political_cycle',
          'event',
          'policy',
          'vacancy',
          'system',
        ]),
        sourceId: z.string().min(1),
        signalId: z.string().nullable(),
        description: z.string(),
      })
      .strict(),
    // Schema 8 saves predate frozen trigger payloads. Decode them as null rather
    // than fabricating a payload which could accidentally satisfy signal fields.
    sourceSignal: DomainSignalSnapshotSchema.nullable().default(null),
    appearedAtDay: z.number(),
    expiresAtDay: z.number().nullable(),
    acceptedAtDay: z.number().nullable(),
    rejectedAtDay: z.number().nullable(),
    resolvedAtDay: z.number().nullable(),
    cancelledAtDay: z.number().nullable(),
    requiresSelection: z.boolean(),
    eligibilityConditions: z.array(ConditionExpressionSchema),
    finalOutcome: z
      .enum([
        'appointed',
        'continued_observation',
        'not_selected',
        'training_completed',
        'withdrawn',
      ])
      .nullable(),
    reason: z.string(),
  })
  .strict();

const CareerOpportunityTargetSchema = z
  .object({
    positionId: z.string(),
    positionName: z.string(),
    institutionId: z.string(),
    institutionName: z.string(),
    regionId: z.string(),
    institutionLevel: z.enum(INSTITUTION_LEVELS),
    positionDomain: z.enum(POSITION_DOMAINS),
    leadershipRank: z.enum(LEADERSHIP_RANKS),
  })
  .strict();

/** CareerOpportunity Schema（training 使用正式判别联合）。 */
const CareerOpportunitySchema = z
  .union([
    CareerOpportunityBaseSchema.extend({
      type: z.enum([
        'leadership_vacancy',
        'lateral_transfer',
        'temporary_assignment',
        'secondment',
        'demotion',
        'retirement',
      ]),
      target: CareerOpportunityTargetSchema,
      appointmentType: z.enum(APPOINTMENT_TYPES),
      appointmentReason: z.enum(APPOINTMENT_REASONS),
    }).strict(),
    CareerOpportunityBaseSchema.extend({
      type: z.literal('training'),
      target: z.null(),
      appointmentType: z.null(),
      appointmentReason: z.null(),
      trainingDefinitionId: z.string().min(1),
      effects: z.array(EffectDefinitionSchema),
    }).strict(),
  ])
  .superRefine((value, ctx) => {
    const dateFields = [
      ['acceptedAtDay', value.acceptedAtDay],
      ['rejectedAtDay', value.rejectedAtDay],
      ['resolvedAtDay', value.resolvedAtDay],
      ['cancelledAtDay', value.cancelledAtDay],
    ] as const;
    for (const [field, date] of dateFields) {
      if (date !== null && date < value.appearedAtDay)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} cannot predate opportunity appearance`,
        });
    }

    const requireDate = (field: (typeof dateFields)[number][0], required: boolean) => {
      const date = value[field];
      if ((date !== null) !== required)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: required
            ? `${field} is required for ${value.status} opportunities`
            : `${field} is not allowed for ${value.status} opportunities`,
        });
    };
    const requireOutcome = value.status === 'resolved';
    if ((value.finalOutcome !== null) !== requireOutcome)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['finalOutcome'],
        message: 'finalOutcome is required only for resolved opportunities',
      });

    switch (value.status) {
      case 'available':
      case 'expired':
        for (const [field] of dateFields) requireDate(field, false);
        if (value.status === 'expired' && value.expiresAtDay === null)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['expiresAtDay'],
            message: 'expiresAtDay is required for expired opportunities',
          });
        break;
      case 'accepted':
      case 'in_process':
        requireDate('acceptedAtDay', true);
        requireDate('rejectedAtDay', false);
        requireDate('resolvedAtDay', false);
        requireDate('cancelledAtDay', false);
        break;
      case 'rejected':
        requireDate('acceptedAtDay', false);
        requireDate('rejectedAtDay', true);
        requireDate('resolvedAtDay', false);
        requireDate('cancelledAtDay', false);
        break;
      case 'resolved':
        requireDate('acceptedAtDay', true);
        requireDate('rejectedAtDay', false);
        requireDate('resolvedAtDay', true);
        requireDate('cancelledAtDay', false);
        break;
      case 'cancelled':
        requireDate('acceptedAtDay', false);
        requireDate('rejectedAtDay', false);
        requireDate('resolvedAtDay', false);
        requireDate('cancelledAtDay', true);
        break;
    }
  });

/** CareerProcess Schema（stageResults 使用明确结构） */
const CareerProcessSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      'leadership_selection',
      'appointment_review',
      'probation',
      'temporary_assignment',
      'training',
    ]),
    status: z.enum(['active', 'completed', 'failed', 'cancelled']),
    opportunityId: z.string(),
    currentStage: z.enum([
      'eligibility_review',
      'democratic_recommendation',
      'organization_inspection',
      'collective_decision',
      'public_notice',
      'appointment',
      'probation',
      'finalization',
    ]),
    startedAtDay: z.number(),
    completedAtDay: z.number().nullable(),
    stageResults: z.array(
      z
        .object({
          stage: z.enum([
            'eligibility_review',
            'democratic_recommendation',
            'organization_inspection',
            'collective_decision',
            'public_notice',
            'appointment',
            'probation',
            'finalization',
          ]),
          resolvedAtDay: z.number(),
          outcome: z.enum(['passed', 'failed', 'continued', 'cancelled']),
          score: z.number().nullable(),
          detail: z.string(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.status === 'active') !== (value.completedAtDay === null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Process completion date must match status',
      });
  });

/** CareerState Schema */
const CareerStateSchema = z
  .object({
    appointment: CurrentAppointmentSchema,
    civilServiceRank: z.enum(CIVIL_SERVICE_RANKS),
    civilServiceRankStartedAtDay: z.number().int().nonnegative(),
    civilServiceRankHistory: z.array(
      z
        .object({
          id: z.string().min(1),
          previousRank: z.enum(CIVIL_SERVICE_RANKS),
          currentRank: z.enum(CIVIL_SERVICE_RANKS),
          changedAtDay: z.number().int().nonnegative(),
          reason: z.enum(['regular_advancement', 'exceptional_advancement', 'demotion']),
          sourceType: z.enum(['assessment', 'event', 'policy', 'system']),
          sourceId: z.string().nullable(),
          sourceAssessmentYear: z.number().int().nullable(),
        })
        .strict(),
    ),
    restrictions: z.array(
      z
        .object({
          id: z.string().min(1),
          type: z.enum([
            'rank_advancement_freeze',
            'appointment_selection_freeze',
            'disciplinary_action',
          ]),
          startedAtDay: z.number().int().nonnegative(),
          endsAtDay: z.number().int().nullable(),
          reason: z.string(),
          sourceType: z.enum(['assessment', 'event', 'policy', 'system']),
          sourceId: z.string().nullable(),
        })
        .strict(),
    ),
    experiences: z.array(CareerExperienceSchema),
    specialties: z.record(z.number()),
    opportunities: z.array(CareerOpportunitySchema),
    activeProcess: CareerProcessSchema.nullable(),
    completedProcesses: z.array(CareerProcessSchema).default([]),
  })
  .strict();

/** PolicyPhaseDefinition Schema */
const PolicyPhaseDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    durationDays: z.number(),
    entryEffects: z.array(EffectDefinitionSchema),
    completionEffects: z.array(EffectDefinitionSchema),
  })
  .strict();

/** GovernanceState Schema（Schema 5：PolicyInstance 使用 originContext + snapshot） */
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
          currentPhaseId: z.string().nullable(),
          phaseEnteredAtDay: z.number().nullable(),
          nextMilestoneAtDay: z.number().nullable(),
          suspendedAtDay: z.number().nullable(),
          accumulatedSuspendedDays: z.number(),
          completedAtDay: z.number().nullable(),
          failedAtDay: z.number().nullable(),
          repealedAtDay: z.number().nullable(),
          originContext: z
            .object({
              positionId: z.string(),
              institutionId: z.string(),
              regionId: z.string(),
              institutionLevel: z.enum(INSTITUTION_LEVELS),
              positionDomain: z.enum(POSITION_DOMAINS),
              leadershipRank: z.enum(LEADERSHIP_RANKS),
              experienceId: z.string().nullable(),
            })
            .strict(),
          snapshot: z
            .object({
              policyId: z.string(),
              name: z.string(),
              description: z.string(),
              category: z.enum(POLICY_CATEGORIES),
              tags: z.array(z.string()),
              effectiveDelayDays: z.number(),
              approvalEffects: z.array(EffectDefinitionSchema),
              phases: z.array(PolicyPhaseDefinitionSchema),
              contentVersion: z.string(),
            })
            .strict(),
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
    repeatPolicy: EventRepeatPolicySchema,
  })
  .strict();

/** EventInstance Schema */
const EventInstanceSchema = z
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
  .strict();

/** ScheduledEventInstance Schema */
const ScheduledEventInstanceSchema = z
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
  .strict();

/** 暂停实例/信号的统一 continuation 队列 Schema。 */
const EventContinuationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('instance'),
      instance: EventInstanceSchema,
      // Schema 4 初版没有为暂停实例写入深度；解码旧存档时按根深度恢复。
      cascadeDepth: z.number().int().nonnegative().default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal('signal'),
      signal: DomainSignalSnapshotSchema,
      cascadeDepth: z.number().int().nonnegative(),
    })
    .strict(),
]);

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
    pending: z.array(EventInstanceSchema),
    scheduled: z.array(ScheduledEventInstanceSchema),
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
    // 兼容已写出的 Schema 4 存档；运行时会在首次使用时转入统一 continuation 队列。
    deferredSignals: z.array(DomainSignalSnapshotSchema).default([]),
    // 新字段使用 default 保持 Schema 4 的前向兼容，未知字段仍由 strict() 拒绝。
    deferredContinuations: z.array(EventContinuationSchema).default([]),
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

/** ActionExecutableSnapshot Schema */
const ActionExecutableSnapshotSchema = z
  .object({
    contentVersion: z.string().min(1),
    department: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
      })
      .strict(),
    action: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        durationDays: z.number().int().nonnegative(),
        category: z.enum(['major', 'minor', 'routine']),
        cooldownDays: z.number().int().nonnegative(),
        budgetDelta: z.number(),
        effects: z.array(
          z
            .object({
              target: z.string().min(1),
              operation: z.enum(['add', 'multiply', 'set']),
              value: z.number(),
              range: z
                .object({
                  min: z.number(),
                  max: z.number(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        ),
        unlockLevel: z.number().optional(),
        styleAlignment: z.string().optional(),
      })
      .strict(),
    attributeBounds: z.record(z.string(), z.tuple([z.number(), z.number()])),
  })
  .strict();

/** SlotOccupant Schema */
const SlotOccupantSchema = z
  .object({
    instanceId: z.string().min(1),
    actionId: z.string(),
    deptId: z.string(),
    actionName: z.string(),
    originPositionId: z.string().min(1),
    originInstitutionId: z.string().min(1),
    originRegionId: z.string().min(1),
    category: z.enum(['major', 'minor', 'routine']),
    startedAtDay: z.number(),
    durationDays: z.number(),
    cooldownDays: z.number(),
    executableSnapshot: ActionExecutableSnapshotSchema,
    runtimeSnapshot: z
      .object({
        effectivenessMultiplier: z.number(),
        styleConflictTriggered: z.boolean(),
        styleAlignment: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((occupant, ctx) => {
    const action = occupant.executableSnapshot.action;
    const department = occupant.executableSnapshot.department;
    if (
      action.id !== occupant.actionId ||
      action.name !== occupant.actionName ||
      action.category !== occupant.category ||
      action.durationDays !== occupant.durationDays ||
      action.cooldownDays !== occupant.cooldownDays ||
      department.id !== occupant.deptId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Action executable snapshot does not match its slot occupant',
      });
    }
  });

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

const TimelineContinuationNodeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('probation_evaluation'),
      absoluteDay: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('career_opportunity_expiry'),
      absoluteDay: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('scheduled_event_activation'),
      absoluteDay: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('event_deadline'),
      absoluteDay: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('monthly_settlement'),
      absoluteDay: z.number().int().nonnegative(),
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('annual_assessment'),
      absoluteDay: z.number().int().nonnegative(),
      year: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('political_cycle'),
      absoluteDay: z.number().int().nonnegative(),
      year: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('retirement_check'),
      absoluteDay: z.number().int().nonnegative(),
    })
    .strict(),
]);

const TIMELINE_NODE_PRIORITY: Record<
  z.infer<typeof TimelineContinuationNodeSchema>['type'],
  number
> = {
  probation_evaluation: 0,
  career_opportunity_expiry: 1,
  scheduled_event_activation: 2,
  event_deadline: 3,
  monthly_settlement: 4,
  annual_assessment: 5,
  political_cycle: 6,
  retirement_check: 7,
};

const GameTimeStateSchema = z
  .object({
    year: z.number().int().min(1),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(30),
    granularity: z.enum(['day', 'week', 'month']),
    totalDaysPlayed: z.number().int().nonnegative(),
    pendingContinuation: z
      .object({
        absoluteDay: z.number().int().nonnegative(),
        remainingNodes: z.array(TimelineContinuationNodeSchema),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((time, ctx) => {
    const continuation = time.pendingContinuation;
    if (!continuation) return;
    if (continuation.absoluteDay !== time.totalDaysPlayed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Timeline continuation must belong to the current absolute day',
      });
    }
    const seen = new Set<string>();
    let previousPriority = -1;
    for (const node of continuation.remainingNodes) {
      if (node.absoluteDay !== continuation.absoluteDay) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Timeline continuation node absolute day mismatch',
        });
      }
      if (seen.has(node.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate timeline continuation node "${node.type}"`,
        });
      }
      seen.add(node.type);
      const priority = TIMELINE_NODE_PRIORITY[node.type];
      if (priority < previousPriority) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Timeline continuation nodes are not in fixed execution order',
        });
      }
      previousPriority = priority;
    }
  });

/** PlayerSave Schema（当前版本，.strict() 拒绝未知字段） */
const PlayerSaveSchema = z
  .object({
    character: CharacterStateSchema,
    time: GameTimeStateSchema,
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

/** SaveEnvelope Schema（当前版本） */
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
 * 验证 PlayerSave 数据是否符合当前 Schema。
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

    if (!events.deferredSignals) {
      (events as Record<string, unknown>).deferredSignals = [];
    }

    if (!events.deferredContinuations) {
      (events as Record<string, unknown>).deferredContinuations = [];
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
 * Schema 4 → 5 迁移：PolicyInstance 扁平字段 → originContext + snapshot 复合结构。
 *
 * Schema 4 的 PolicyInstance 使用 regionId/responsibleInstitutionId 等扁平字段。
 * Schema 5 将其收束到 originContext（位置/机构/地区）和 snapshot（政策定义快照）。
 * 旧记录没有足以重建不可变政策快照的任职与阶段信息，因此只有空政策集合
 * 能确定性升级；含有政策实例时必须显式失败并由调用方保留原始备份。
 *
 * @param prev Schema 4 SaveEnvelope 对象
 * @returns 迁移后的 Schema 5 SaveEnvelope 对象
 */
export function migrateSchema4To5(prev: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  const governance = state?.governance as Record<string, unknown> | undefined;
  const oldPolicies = (governance?.policies ?? []) as Array<Record<string, unknown>>;
  if (oldPolicies.length > 0) {
    throw new Error(
      'Schema 4 save contains policy instances that cannot be migrated without executable snapshots',
    );
  }

  migrated.schemaVersion = 5;
  (migrated as Record<string, unknown>).contentVersion = '2026.07.3';
  return migrated;
}

/**
 * 将 Schema 5 存档迁移至 Schema 6。
 *
 * 新增空时间轴 continuation，并使用 Schema 5 当前任职为执行中行动冻结
 * 来源上下文；行动 ID 完全由槽位、开始日和行动配置 ID 确定。
 *
 * @param prev Schema 5 SaveEnvelope 对象
 * @returns 迁移后的 Schema 6 SaveEnvelope 对象
 */
export function migrateSchema5To6(prev: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(prev);
  const legacyContentVersion = migrated.contentVersion;
  if (legacyContentVersion !== '2026.07.3') {
    throw new Error(
      `Schema 5 content version "${String(legacyContentVersion)}" has no reliable action migration`,
    );
  }
  const state = migrated.state as Record<string, unknown> | undefined;
  const time = state?.time as Record<string, unknown> | undefined;
  const career = state?.career as Record<string, unknown> | undefined;
  const appointment = career?.appointment as Record<string, unknown> | undefined;
  const actions = state?.actions as Record<string, unknown> | undefined;
  const slots = actions?.slots as Record<string, unknown> | undefined;
  if (!time || !appointment || !slots) {
    throw new Error('Schema 5 save is missing time, appointment, or action slots');
  }
  const positionId = appointment.positionId;
  const institutionId = appointment.institutionId;
  const regionId = appointment.regionId;
  if (
    typeof positionId !== 'string' ||
    typeof institutionId !== 'string' ||
    typeof regionId !== 'string'
  ) {
    throw new Error('Schema 5 appointment context is invalid');
  }
  const loader = getConfigLoader();
  const departments = loader.resolvePositionDepartments(positionId);
  const attributeBounds = loader.getGameConfig().attributeBounds;
  time.pendingContinuation = null;
  for (const tier of ['primary', 'secondary', 'reserve'] as const) {
    const group = slots[tier] as Record<string, unknown> | undefined;
    const occupants = group?.occupants as Array<Record<string, unknown> | null> | undefined;
    if (!occupants) throw new Error(`Schema 5 action tier "${tier}" is invalid`);
    occupants.forEach((occupant, slotIndex) => {
      if (!occupant) return;
      const startedAtDay = occupant.startedAtDay;
      const actionId = occupant.actionId;
      const deptId = occupant.deptId;
      if (
        typeof startedAtDay !== 'number' ||
        typeof actionId !== 'string' ||
        typeof deptId !== 'string'
      ) {
        throw new Error(`Schema 5 action in "${tier}" slot ${slotIndex} is invalid`);
      }
      const department = departments.find((item) => item.id === deptId);
      const action = department?.actions.find((item) => item.id === actionId);
      if (!department || !action) {
        throw new Error(
          `Schema 5 action "${deptId}/${actionId}" cannot be migrated from content 2026.07.3`,
        );
      }
      if (
        occupant.actionName !== action.name ||
        occupant.category !== action.category ||
        occupant.durationDays !== action.durationDays ||
        occupant.cooldownDays !== action.cooldownDays
      ) {
        throw new Error(
          `Schema 5 action "${deptId}/${actionId}" no longer matches its executable definition`,
        );
      }
      occupant.instanceId = `legacy-action-${tier}-${slotIndex}-${startedAtDay}-${actionId}`;
      occupant.originPositionId = positionId;
      occupant.originInstitutionId = institutionId;
      occupant.originRegionId = regionId;
      occupant.executableSnapshot = createActionExecutableSnapshot(
        department,
        action,
        legacyContentVersion,
        attributeBounds,
      );
    });
  }
  migrated.schemaVersion = 6;
  migrated.contentVersion = CURRENT_CONTENT_VERSION;
  return migrated;
}

/** 将 Schema 6 存档迁移至 Schema 7。 */
export function migrateSchema6To7(prev: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  const career = state?.career as Record<string, unknown> | undefined;
  const world = state?.world as Record<string, unknown> | undefined;
  const metrics = world?.metrics as Record<string, unknown> | undefined;
  const appointment = career?.appointment as Record<string, unknown> | undefined;
  if (
    !career ||
    !appointment ||
    typeof appointment.positionId !== 'string' ||
    typeof appointment.startedAtDay !== 'number'
  ) {
    throw new Error('Schema 6 save is missing a valid appointment');
  }
  const opportunities = career.opportunities;
  const activeProcess = career.activeProcess;
  if (!Array.isArray(opportunities) || opportunities.length > 0)
    throw new Error(
      'Schema 6 non-empty career opportunities cannot be migrated without source and target snapshots',
    );
  if (activeProcess !== null)
    throw new Error(
      'Schema 6 active career process cannot be migrated from an open stage vocabulary',
    );
  appointment.appointmentId = `legacy-appointment-${appointment.positionId}-${appointment.startedAtDay}`;
  appointment.appointmentReason = 'initial_assignment';
  appointment.sourceOpportunityId = null;
  career.civilServiceRankStartedAtDay = 0;
  career.civilServiceRankHistory = [];
  career.restrictions = [];
  if (!metrics) throw new Error('Schema 6 save is missing world metrics');
  for (const [metricId, initialValue] of Object.entries(
    getConfigLoader().getInitialCivilServiceRankQuotaMetrics(),
  )) {
    if (metrics[metricId] === undefined) metrics[metricId] = initialValue;
  }
  migrated.schemaVersion = 7;
  migrated.contentVersion = '2026.07.5';
  return migrated;
}

/** 将 Schema 7 存档迁移至 Schema 8。 */
export function migrateSchema7To8(prev: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(prev);
  if (migrated.contentVersion !== '2026.07.5')
    throw new Error(`Schema 7 content version "${String(migrated.contentVersion)}" is unsupported`);
  const state = migrated.state as Record<string, unknown> | undefined;
  const career = state?.career as Record<string, unknown> | undefined;
  const appointment = career?.appointment as Record<string, unknown> | undefined;
  if (!career || !appointment || typeof appointment.appointmentId !== 'string')
    throw new Error('Schema 7 save is missing a valid appointment instance');
  if (!Array.isArray(career.opportunities) || career.opportunities.length > 0)
    throw new Error('Schema 7 non-empty career opportunities cannot be safely discriminated');
  if (career.activeProcess !== null)
    throw new Error('Schema 7 active career process cannot be safely migrated');
  const experiences = career.experiences;
  if (!Array.isArray(experiences)) throw new Error('Schema 7 career experiences are invalid');
  if (
    experiences.some(
      (experience) => !experience || typeof experience !== 'object' || Array.isArray(experience),
    )
  )
    throw new Error('Schema 7 career experiences contain an invalid entry');
  const typedExperiences = experiences as Record<string, unknown>[];
  const openExperiences = typedExperiences.filter((experience) => experience.endedAtDay === null);
  if (openExperiences.length > 1) throw new Error('Schema 7 has multiple open career experiences');
  const positionId = appointment.positionId;
  const institutionId = appointment.institutionId;
  if (typeof positionId !== 'string' || typeof institutionId !== 'string')
    throw new Error('Schema 7 appointment position context is invalid');
  const position = getConfigLoader().getPositionById(positionId);
  const institution = getConfigLoader().getInstitutionById(institutionId);
  if (!position || !institution)
    throw new Error('Schema 7 appointment configuration is unavailable');
  const fillCurrentExperience = (experience: Record<string, unknown>, id: string) => {
    if (
      experience.positionId !== position.id ||
      experience.institutionId !== institution.id ||
      experience.regionId !== appointment.regionId ||
      experience.startedAtDay !== appointment.startedAtDay
    )
      throw new Error('Schema 7 open experience conflicts with current appointment');
    experience.id = typeof experience.id === 'string' ? experience.id : id;
    experience.appointmentId = appointment.appointmentId;
    experience.positionNameSnapshot =
      typeof experience.positionNameSnapshot === 'string'
        ? experience.positionNameSnapshot
        : position.name;
    experience.institutionNameSnapshot =
      typeof experience.institutionNameSnapshot === 'string'
        ? experience.institutionNameSnapshot
        : institution.name;
    experience.institutionLevel = position.institutionLevel;
    experience.positionDomain = position.positionDomain;
    experience.leadershipRank = position.leadershipRank;
    experience.appointmentType = appointment.appointmentType;
    experience.appointmentReason = appointment.appointmentReason;
    experience.sourceOpportunityId = appointment.sourceOpportunityId;
    experience.endReason = null;
    experience.assessmentResults = Array.isArray(experience.assessmentResults)
      ? experience.assessmentResults
      : [];
  };
  if (openExperiences.length === 0) {
    const experience: Record<string, unknown> = {
      id: `legacy-experience-${appointment.appointmentId}`,
      positionId: position.id,
      institutionId: institution.id,
      regionId: appointment.regionId,
      startedAtDay: appointment.startedAtDay,
      endedAtDay: null,
    };
    fillCurrentExperience(experience, `legacy-experience-${appointment.appointmentId}`);
    typedExperiences.push(experience);
  } else {
    fillCurrentExperience(openExperiences[0]!, `legacy-experience-${appointment.appointmentId}`);
  }
  for (const [index, experience] of typedExperiences.entries()) {
    if (experience.endedAtDay === null) continue;
    const legacyId = typeof experience.id === 'string' ? experience.id : `experience-${index}`;
    experience.appointmentId = `legacy-appointment-${legacyId}-${index}`;
    experience.appointmentType =
      experience.appointmentReason === 'temporary_assignment'
        ? 'temporary'
        : experience.appointmentReason === 'secondment'
          ? 'secondment'
          : 'substantive';
    experience.sourceOpportunityId = null;
    // Schema 7 did not record why a tenure ended, so preserve that absence explicitly.
    experience.endReason = null;
    experience.assessmentResults = Array.isArray(experience.assessmentResults)
      ? experience.assessmentResults
      : [];
  }
  migrated.schemaVersion = 8;
  migrated.contentVersion = '2026.07.8';
  return migrated;
}

/**
 * 将 Schema 8 存档迁移至 Schema 9。
 *
 * 旧版仅有 `probationEndsAtDay`：数值表示尚未消费的活动试用期，null 表示
 * 本次任职没有试用期。迁移后用显式状态与空审计记录表达同一事实。
 *
 * @param prev Schema 8 SaveEnvelope
 * @returns Schema 9 SaveEnvelope
 */
export function migrateSchema8To9(prev: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(prev);
  if (migrated.contentVersion !== '2026.07.8')
    throw new Error(`Schema 8 content version "${String(migrated.contentVersion)}" is unsupported`);
  const state = migrated.state as Record<string, unknown> | undefined;
  const career = state?.career as Record<string, unknown> | undefined;
  const appointment = career?.appointment as Record<string, unknown> | undefined;
  if (!appointment || typeof appointment.startedAtDay !== 'number')
    throw new Error('Schema 8 save is missing a valid appointment');
  const legacyEnd = appointment.probationEndsAtDay;
  const alreadyExpanded = appointment.probation;
  if (
    legacyEnd === undefined &&
    alreadyExpanded !== null &&
    (typeof alreadyExpanded !== 'object' || Array.isArray(alreadyExpanded))
  )
    throw new Error('Schema 8 appointment has invalid expanded probation data');
  if (legacyEnd !== undefined && legacyEnd !== null && typeof legacyEnd !== 'number')
    throw new Error('Schema 8 appointment has an invalid probation end');
  if (legacyEnd !== undefined)
    appointment.probation =
      legacyEnd === null
        ? null
        : {
            status: 'active',
            startedAtDay: appointment.startedAtDay,
            endsAtDay: legacyEnd,
            extensionCount: 0,
            completedActionCount: 0,
            resolvedAtDay: null,
            outcomeReason: null,
            evaluations: [],
          };
  delete appointment.probationEndsAtDay;
  migrated.schemaVersion = 9;
  migrated.contentVersion = CURRENT_CONTENT_VERSION;
  return migrated;
}

/**
 * 严格解码存档数据（已解析的对象）。
 *
 * 支持从 MIN_MIGRATABLE_SCHEMA_VERSION 开始的确定性迁移：
 * - 低于可迁移版本：拒绝为 legacy；
 * - Schema 2–8：按版本顺序链式迁移至 Schema 9；
 * - 当前版本（Schema 9）：直接解码；
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
      target = migrateSchema8To9(
        migrateSchema7To8(
          migrateSchema6To7(
            migrateSchema5To6(migrateSchema4To5(migrateSchema3To4(migrateSchema2To3(obj)))),
          ),
        ),
      );
    } else if (obj.schemaVersion === 3) {
      target = migrateSchema8To9(
        migrateSchema7To8(
          migrateSchema6To7(migrateSchema5To6(migrateSchema4To5(migrateSchema3To4(obj)))),
        ),
      );
    } else if (obj.schemaVersion === 4) {
      target = migrateSchema8To9(
        migrateSchema7To8(migrateSchema6To7(migrateSchema5To6(migrateSchema4To5(obj)))),
      );
    } else if (obj.schemaVersion === 5) {
      target = migrateSchema8To9(migrateSchema7To8(migrateSchema6To7(migrateSchema5To6(obj))));
    } else if (obj.schemaVersion === 6) {
      target = migrateSchema8To9(migrateSchema7To8(migrateSchema6To7(obj)));
    } else if (obj.schemaVersion === 7) {
      target = migrateSchema8To9(migrateSchema7To8(obj));
    } else if (obj.schemaVersion === 8) {
      target = migrateSchema8To9(obj);
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
