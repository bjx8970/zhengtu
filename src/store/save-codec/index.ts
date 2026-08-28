/**
 * 存档严格解码器（Schema 14）
 *
 * 只接受当前版本（Schema 14）的完整 SaveEnvelope，拒绝所有其他格式。
 * Schema 1 存档拒绝前保留只读备份。
 * 支持 Schema 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 链式迁移。
 *
 * 领域枚举使用 domain/ 单一事实来源，不重复声明。
 */

import { z } from 'zod';
import type { PlayerSave } from '../../types/player';
import { PERSONAL_TASK_LEDGER_ID } from '../../types/player';
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
import { RELATIVE_SELECTION_STAGES } from '../../domain/career/state';
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
import { PersonalTaskTemplateSchema } from '../../config/schemas';
import { processCareerOpportunitySignal } from '../../engine/career/opportunity-orchestrator';
import { createActionExecutableSnapshot } from '../action-executable-snapshot';
import { createOrganizationStateSchema } from './organization-schema';
import { validateOrganizationInvariants } from '../../engine/organization/organization-invariants';
import { createOrganizationState } from '../../engine/organization/organization-initialization';

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
    status: z.enum(['active', 'ended']),
    endedAtDay: z.number().int().nonnegative().nullable(),
    endReason: z
      .enum([
        'promotion',
        'lateral_transfer',
        'rotation',
        'temporary_assignment',
        'secondment',
        'demotion',
        'retirement',
        'disciplinary_exit',
        'probation_failed',
      ])
      .nullable(),
    probation: AppointmentProbationSchema.nullable(),
  })
  .strict()
  .superRefine((appointment, ctx) => {
    if (appointment.probation && appointment.probation.startedAtDay !== appointment.startedAtDay)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Probation start must match appointment start',
      });
    const activeHasEndFacts =
      appointment.status === 'active' &&
      (appointment.endedAtDay !== null || appointment.endReason !== null);
    const endedMissingEndFacts =
      appointment.status === 'ended' &&
      (appointment.endedAtDay === null || appointment.endReason === null);
    if (activeHasEndFacts || endedMissingEndFacts)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Appointment end facts must match appointment status',
      });
    if (appointment.endedAtDay !== null && appointment.endedAtDay < appointment.startedAtDay)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Appointment cannot end before it starts',
      });
    if (appointment.probation?.status === 'failed') {
      if (
        appointment.status !== 'ended' ||
        appointment.endReason !== 'probation_failed' ||
        appointment.endedAtDay !== appointment.probation.resolvedAtDay
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Failed probation must terminate its appointment on the resolution day',
        });
    } else if (appointment.endReason === 'probation_failed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Probation failure end reason requires a failed probation',
      });
    }
  });

/** 履历考核记录 Schema。 */
const CareerAssessmentRecordSchema = z
  .object({
    year: z.number(),
    score: z.number(),
    tier: z.string(),
  })
  .strict();

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
        'disciplinary_exit',
        'probation_failed',
      ])
      .nullable(),
    assessmentResults: z.array(CareerAssessmentRecordSchema),
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
    // Schema 13 links leadership opportunities to one real organization Vacancy.
    // Historical opportunities may not have the link and are deterministically null.
    vacancyId: z.string().min(1).nullable().default(null),
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

/** CareerProcess Schema（Schema 14 固定 Selection/Vacancy 引用及终态审计） */
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
    selectionId: z.string().nullable().optional(),
    vacancyId: z.string().nullable().optional(),
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
          candidateResults: z
            .array(
              z
                .object({
                  candidateId: z.string().min(1),
                  score: z.number().min(0).max(100),
                  rank: z.number().int().positive(),
                  eliminated: z.boolean(),
                })
                .strict(),
            )
            .optional(),
          survivingCandidateIds: z.array(z.string().min(1)).optional(),
        })
        .strict(),
    ),
    winnerId: z.string().min(1).nullable().optional(),
    failure: z
      .object({
        code: z.enum(['no_qualified_candidates', 'stage_no_survivors', 'no_unique_winner']),
        stage: z
          .enum([
            'eligibility_review',
            'democratic_recommendation',
            'organization_inspection',
            'collective_decision',
            'public_notice',
            'appointment',
          ])
          .nullable(),
        detail: z.string().min(1),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.status === 'active') !== (value.completedAtDay === null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Process completion date must match status',
      });
    for (const field of ['selectionId', 'vacancyId', 'winnerId', 'failure'] as const) {
      if (
        !Object.prototype.hasOwnProperty.call(value, field) ||
        (value[field] as unknown) === undefined
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `CareerProcess ${field} is required in Schema 14`,
        });
    }
    if (value.type === 'leadership_selection') {
      if (
        (value.selectionId === null || value.vacancyId === null) &&
        value.status !== 'failed' &&
        value.status !== 'cancelled'
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Leadership Selection requires Selection and Vacancy IDs',
        });
      for (const result of value.stageResults) {
        if (
          value.status === 'active' &&
          value.selectionId !== null &&
          (result.candidateResults === undefined || result.survivingCandidateIds === undefined)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stageResults'],
            message: 'Selection process stage result requires candidate audit',
          });
      }
      if (value.status === 'failed' && value.failure === null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failure'],
          message: 'Failed Selection process requires a failure',
        });
      if (value.status === 'completed' && value.winnerId === null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winnerId'],
          message: 'Completed Selection process requires a winner',
        });
      if (value.status === 'completed' && value.failure !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failure'],
          message: 'Completed Selection process cannot have a failure',
        });
      if (value.status === 'active' && value.failure !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failure'],
          message: 'Active Selection process cannot have a failure',
        });
    }
  });

/** 持久化职业限制 Schema。 */
const CareerRestrictionSchema = z
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
  .strict();

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
    restrictions: z.array(CareerRestrictionSchema),
    experiences: z.array(CareerExperienceSchema),
    specialties: z.record(z.number()),
    opportunities: z.array(CareerOpportunitySchema),
    activeProcess: CareerProcessSchema.nullable(),
    completedProcesses: z.array(CareerProcessSchema).default([]),
  })
  .strict()
  .superRefine((career, ctx) => {
    if (career.activeProcess && career.activeProcess.status !== 'active')
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activeProcess'],
        message: 'activeProcess must have active status',
      });
    const matchingExperiences = career.experiences.filter(
      (experience) => experience.appointmentId === career.appointment.appointmentId,
    );
    const openExperiences = career.experiences.filter(
      (experience) => experience.endedAtDay === null,
    );
    if (matchingExperiences.length !== 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experiences'],
        message: 'Appointment must have exactly one matching career experience',
      });
    const matching = matchingExperiences[0];
    if (career.appointment.status === 'active') {
      if (
        openExperiences.length !== 1 ||
        openExperiences[0]?.appointmentId !== career.appointment.appointmentId ||
        matching?.endReason !== null
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['experiences'],
          message: 'Active appointment must be represented by the only open experience',
        });
      return;
    }
    if (
      openExperiences.length !== 0 ||
      matching?.endedAtDay !== career.appointment.endedAtDay ||
      matching?.endReason !== career.appointment.endReason
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experiences'],
        message: 'Ended appointment must match its closed career experience',
      });
  });

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

const OrganizationStateSchema = createOrganizationStateSchema({
  currentAppointment: CurrentAppointmentSchema,
  careerExperience: CareerExperienceSchema,
  careerRestriction: CareerRestrictionSchema,
  careerAssessmentRecord: CareerAssessmentRecordSchema,
});

/** 部门行动可执行快照 Schema */
const DepartmentActionExecutableSnapshotSchema = z
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

/** 个人任务可执行快照 Schema（与部门行动共用槽位，department 固定为台账哨兵） */
const PersonalTaskExecutableSnapshotSchema = z
  .object({
    contentVersion: z.string().min(1),
    department: z
      .object({
        id: z.literal(PERSONAL_TASK_LEDGER_ID),
        name: z.string().min(1),
      })
      .strict(),
    task: PersonalTaskTemplateSchema,
    attributeBounds: z.record(z.string(), z.tuple([z.number(), z.number()])),
  })
  .strict();

/** ActionExecutableSnapshot Schema（按 action/task 判别部门行动与个人任务） */
const ActionExecutableSnapshotSchema = z.union([
  DepartmentActionExecutableSnapshotSchema,
  PersonalTaskExecutableSnapshotSchema,
]);

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
    const snapshot = occupant.executableSnapshot;
    if ('task' in snapshot) {
      // 个人任务：快照任务字段须与占用记录一致，且部门为台账哨兵
      if (
        snapshot.task.id !== occupant.actionId ||
        snapshot.task.name !== occupant.actionName ||
        snapshot.task.category !== occupant.category ||
        snapshot.task.durationDays !== occupant.durationDays ||
        snapshot.task.cooldownDays !== occupant.cooldownDays ||
        snapshot.department.id !== occupant.deptId
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Personal task snapshot does not match its slot occupant',
        });
      }
      return;
    }
    const action = snapshot.action;
    const department = snapshot.department;
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
    personalTasks: z
      .object({
        cooldownUntilDays: z.record(z.number()),
        completedCounts: z.record(z.number()),
        totalCompleted: z.number(),
      })
      .strict(),
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
    organization: OrganizationStateSchema,
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
  .strict()
  .superRefine((save, ctx) => {
    for (const error of validateOrganizationInvariants(save.organization, save.career.appointment))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organization'], message: error });
    const loader = getConfigLoader();
    for (const seat of save.organization.seats) {
      const position = loader.getPositionById(seat.positionId);
      const institution = loader.getInstitutionById(seat.institutionId);
      if (!position)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organization', 'seats'],
          message: `Seat ${seat.seatId} references unknown position`,
        });
      else if (
        seat.positionNameSnapshot !== position.name ||
        seat.institutionId !== position.institutionId ||
        seat.regionId !== position.regionId ||
        seat.institutionLevel !== position.institutionLevel ||
        seat.positionDomain !== position.positionDomain ||
        seat.leadershipRank !== position.leadershipRank
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organization', 'seats'],
          message: `Seat ${seat.seatId} does not match its position catalog snapshot`,
        });
      if (!institution)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organization', 'seats'],
          message: `Seat ${seat.seatId} references unknown institution`,
        });
      else if (
        seat.institutionNameSnapshot !== institution.name ||
        seat.regionId !== institution.regionId ||
        seat.institutionLevel !== institution.level
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organization', 'seats'],
          message: `Seat ${seat.seatId} does not match its institution catalog snapshot`,
        });
    }
  });

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
type _AssertTypeToSchema = PlayerSave extends SchemaInferred ? true : never;
const _typeConsistencyCheck: _AssertTypeToSchema = true;
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
  appointment.status = 'active';
  appointment.endedAtDay = null;
  appointment.endReason = null;
  migrated.schemaVersion = 9;
  migrated.contentVersion = '2026.08.1';
  return migrated;
}

/** 将不存在年度 producer 的旧内容职数恢复为当前配置初始值。 */
function resetLegacyRankQuotaMetrics(envelope: Record<string, unknown>): void {
  const state = envelope.state as Record<string, unknown> | undefined;
  const world = state?.world as Record<string, unknown> | undefined;
  const metrics = world?.metrics as Record<string, unknown> | undefined;
  if (!metrics) throw new Error('Legacy save is missing world metrics for content migration');
  for (const [metricId, initialValue] of Object.entries(
    getConfigLoader().getInitialCivilServiceRankQuotaMetrics(),
  )) {
    metrics[metricId] = initialValue;
  }
}

/**
 * 将 Schema 9 存档迁移至 Schema 10。
 *
 * 唯一变化：行动运行时新增个人任务状态 `actions.personalTasks`
 * （冷却表、完成计数、累计总数）。Schema 9 存档没有个人任务数据，
 * 确定性回填空集合；槽位中的部门行动快照结构不变。
 *
 * @param prev Schema 9 SaveEnvelope
 * @returns Schema 10 SaveEnvelope
 */
export function migrateSchema9To10(prev: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  const actions = state?.actions as Record<string, unknown> | undefined;
  if (!actions) throw new Error('Schema 9 save is missing action runtime state');
  if (actions.personalTasks !== undefined) {
    const personalTasks = actions.personalTasks as Record<string, unknown>;
    if (typeof personalTasks !== 'object' || Array.isArray(personalTasks))
      throw new Error('Schema 9 save has invalid personal task state');
  } else {
    actions.personalTasks = {
      cooldownUntilDays: {},
      completedCounts: {},
      totalCompleted: 0,
    };
  }
  // Schema 9 及更早内容从未存在年度职数 producer；必须在覆盖内容版本前
  // 清除旧规则预置库存，否则后续统一迁移无法再识别其来源。
  resetLegacyRankQuotaMetrics(migrated);
  migrated.schemaVersion = 10;
  migrated.contentVersion = '2026.08.3';
  return migrated;
}

/**
 * 取消旧版无条件副职机会，避免内容更新后绕过正式资格。
 *
 * 已终结机会作为历史保留；待处理、已接受或选拔中的旧机会转为取消。
 * 若对应流程正在运行，则以可审计的取消阶段归档，其他职业流程不受影响。
 *
 * @param prev Schema 10、内容版本 2026.08.3 的存档
 * @returns 已应用正式副职资格语义的存档
 */
export function migrateSchema10DeputyOpportunityContent(
  prev: Record<string, unknown>,
): Record<string, unknown> {
  if (prev.contentVersion !== '2026.08.3') return prev;
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  const career = state?.career as Record<string, unknown> | undefined;
  const time = state?.time as Record<string, unknown> | undefined;
  const opportunities = career?.opportunities;
  if (!career || !Array.isArray(opportunities) || typeof time?.totalDaysPlayed !== 'number')
    throw new Error('Legacy save is missing career opportunity state for content migration');
  const currentDay = time.totalDaysPlayed;
  const cancelledOpportunityIds = new Set<string>();
  for (const value of opportunities) {
    if (!value || typeof value !== 'object') continue;
    const opportunity = value as Record<string, unknown>;
    if (
      opportunity.definitionId !== 'township_deputy_leadership_vacancy' ||
      !['available', 'accepted', 'in_process'].includes(String(opportunity.status))
    )
      continue;
    if (typeof opportunity.id !== 'string')
      throw new Error('Legacy deputy opportunity has no stable ID');
    cancelledOpportunityIds.add(opportunity.id);
    opportunity.status = 'cancelled';
    opportunity.acceptedAtDay = null;
    opportunity.rejectedAtDay = null;
    opportunity.resolvedAtDay = null;
    opportunity.cancelledAtDay = currentDay;
    opportunity.finalOutcome = null;
  }
  const activeProcess = career.activeProcess;
  if (activeProcess && typeof activeProcess === 'object') {
    const process = activeProcess as Record<string, unknown>;
    if (
      typeof process.opportunityId === 'string' &&
      cancelledOpportunityIds.has(process.opportunityId)
    ) {
      const stageResults = Array.isArray(process.stageResults) ? process.stageResults : [];
      stageResults.push({
        stage: process.currentStage,
        resolvedAtDay: currentDay,
        outcome: 'cancelled',
        score: null,
        detail: '内容更新后按正式副职资格重新等待机会',
      });
      process.stageResults = stageResults;
      process.status = 'cancelled';
      process.completedAtDay = currentDay;
      const completedProcesses = Array.isArray(career.completedProcesses)
        ? career.completedProcesses
        : [];
      completedProcesses.push(process);
      career.completedProcesses = completedProcesses;
      career.activeProcess = null;
    }
  }
  migrated.contentVersion = '2026.08.4';
  return migrated;
}

/**
 * 迁移 Schema 10 的乡镇领导治理内容版本。
 *
 * 本次仅扩展当前职位配置与新任务准入规则，不重写玩家已经消耗的预算，
 * 也不替换在途行动/任务的可执行快照；新年度预算会在下一次年结按新配置补充。
 *
 * @param prev Schema 10、内容版本 2026.08.4 的存档
 * @returns 保留运行时状态并升级内容版本的存档
 */
export function migrateSchema10TownshipGovernanceContent(
  prev: Record<string, unknown>,
): Record<string, unknown> {
  if (prev.contentVersion !== '2026.08.4') return prev;
  const migrated = structuredClone(prev);
  migrated.contentVersion = '2026.08.5';
  return migrated;
}

function backfillCareerExperienceAssessments(
  state: Record<string, unknown>,
  currentDay: number,
): void {
  const career = state.career as Record<string, unknown> | undefined;
  const assessmentState = state.assessments as Record<string, unknown> | undefined;
  const time = state.time as Record<string, unknown> | undefined;
  const experiences = career?.experiences;
  const annualAssessments = assessmentState?.annualAssessments;
  if (
    !Array.isArray(experiences) ||
    !Array.isArray(annualAssessments) ||
    typeof time?.year !== 'number' ||
    typeof time.month !== 'number' ||
    typeof time.day !== 'number'
  )
    throw new Error('Legacy save is missing assessment history for chief content migration');

  // 2026.08.5 使用固定的 30 日月、360 日年。以当前日历锚点反推每次年结的绝对日，
  // 避免把玩家全局已有成绩错误归入尚未开始或已经结束的任职履历。
  const currentYearStartDay = currentDay - ((time.month - 1) * 30 + time.day - 1);
  for (const value of annualAssessments) {
    if (!value || typeof value !== 'object') continue;
    const assessment = value as Record<string, unknown>;
    if (
      typeof assessment.year !== 'number' ||
      typeof assessment.score !== 'number' ||
      typeof assessment.tier !== 'string'
    )
      continue;
    const assessmentDay = currentYearStartDay + (assessment.year + 1 - time.year) * 360;
    if (assessmentDay < 0 || assessmentDay > currentDay) continue;
    const candidates = experiences
      .filter((experience): experience is Record<string, unknown> => {
        if (!experience || typeof experience !== 'object') return false;
        const record = experience as Record<string, unknown>;
        return (
          typeof record.startedAtDay === 'number' &&
          record.startedAtDay <= assessmentDay &&
          (record.endedAtDay === null ||
            (typeof record.endedAtDay === 'number' && record.endedAtDay >= assessmentDay))
        );
      })
      .sort((left, right) => {
        const leftEndedToday = left.endedAtDay === assessmentDay ? 1 : 0;
        const rightEndedToday = right.endedAtDay === assessmentDay ? 1 : 0;
        if (leftEndedToday !== rightEndedToday) return rightEndedToday - leftEndedToday;
        return Number(right.startedAtDay) - Number(left.startedAtDay);
      });
    const experience = candidates[0];
    if (!experience) continue;
    const results = Array.isArray(experience.assessmentResults) ? experience.assessmentResults : [];
    if (
      !results.some(
        (result) =>
          result &&
          typeof result === 'object' &&
          (result as Record<string, unknown>).year === assessment.year,
      )
    )
      results.push({ year: assessment.year, score: assessment.score, tier: assessment.tier });
    experience.assessmentResults = results;
  }
}

function restoreMissedTownshipChiefOpportunity(
  state: Record<string, unknown>,
  currentDay: number,
  ignoredOpportunityIds: ReadonlySet<string>,
): void {
  const typedState = state as unknown as PlayerSave;
  const appointment = typedState.career.appointment;
  if (appointment.leadershipRank !== 'township_deputy' || appointment.status !== 'active') return;
  const experience = typedState.career.experiences.find(
    (item) => item.appointmentId === appointment.appointmentId && item.endedAtDay === null,
  );
  if (!experience) return;
  const time = typedState.time;
  const currentYearStartDay = currentDay - ((time.month - 1) * 30 + time.day - 1);
  const qualified = experience.assessmentResults
    .filter((assessment) => assessment.tier === '优秀' || assessment.tier === '称职')
    .map((assessment) => ({
      assessment,
      absoluteDay: currentYearStartDay + (assessment.year + 1 - time.year) * 360,
    }))
    .filter(
      (item) =>
        item.absoluteDay >= experience.startedAtDay &&
        item.absoluteDay <= currentDay &&
        (experience.endedAtDay === null || item.absoluteDay <= experience.endedAtDay),
    )
    .sort((left, right) => left.absoluteDay - right.absoluteDay);
  const source = qualified[1];
  if (!source) return;
  const expiresAtDay = source.absoluteDay + 270;
  if (currentDay >= expiresAtDay) return;
  const sourceId = `assessment:${source.assessment.year}`;
  if (
    typedState.career.opportunities.some(
      (opportunity) =>
        !ignoredOpportunityIds.has(opportunity.id) &&
        opportunity.definitionId === 'township_chief_leadership_vacancy' &&
        opportunity.source.sourceId === sourceId,
    )
  )
    return;

  // 历史信号只能读取当时已经完成的治理证据和任内考核，不能借用迁移日之后的成果。
  const historicalState = structuredClone(typedState);
  // opportunity orchestrator 自身也会按 definition/source 去重，因此只在重放快照中
  // 隐藏本轮刚取消的旧内容机会；真实 state 仍完整保留这些 cancelled 审计记录。
  historicalState.career.opportunities = historicalState.career.opportunities.filter(
    (opportunity) => !ignoredOpportunityIds.has(opportunity.id),
  );
  historicalState.events.history = historicalState.events.history.filter(
    (record) => record.completedAtDay <= source.absoluteDay,
  );
  const historicalExperience = historicalState.career.experiences.find(
    (item) => item.appointmentId === appointment.appointmentId && item.endedAtDay === null,
  );
  if (!historicalExperience) return;
  historicalExperience.assessmentResults = historicalExperience.assessmentResults.filter(
    (assessment) => assessment.year <= source.assessment.year,
  );
  const signal = {
    signalId: `content-migration-assessment-${appointment.appointmentId}-${source.assessment.year}`,
    signalType: 'assessment.completed' as const,
    occurredAtDay: source.absoluteDay,
    data: {
      year: source.assessment.year,
      score: source.assessment.score,
      tier: source.assessment.tier,
    },
  };
  const loader = getConfigLoader();
  const result = processCareerOpportunitySignal({
    state: historicalState,
    signal,
    currentDay: source.absoluteDay,
    definitions: loader
      .getCareerOpportunityDefinitionsBySignal('assessment.completed')
      .filter((definition) => definition.id === 'township_chief_leadership_vacancy'),
    positions: loader.getAllPositions(),
    institutions: loader.getAllInstitutions(),
    daysPerYear: 360,
    careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
    idFactory: () =>
      `content-migration-chief-${appointment.appointmentId}-${source.assessment.year}`,
  });
  const restored = result.created[0];
  if (restored) typedState.career.opportunities.push(restored);
}

function createMigrationOrganizationState(
  state: Record<string, unknown>,
  initializedAtDay: number,
) {
  const career = state.career as Record<string, unknown> | undefined;
  if (!career) throw new Error('Legacy save is missing career state for organization migration');
  const appointment = CurrentAppointmentSchema.parse(career.appointment);
  const loader = getConfigLoader();
  return createOrganizationState({
    initializedAtDay,
    playerAppointment: appointment,
    cadreTemplates: loader.getCadreTemplates(),
    positions: loader.getAllPositions(),
    institutions: loader.getAllInstitutions(),
  });
}

/**
 * 取消旧版宽松正职机会并升级乡镇正职内容语义。
 *
 * 已终结机会作为历史保留；采用旧条件生成且仍可处理的正职机会会被取消，
 * 对应运行中选拔以可审计阶段归档。治理事件、政策、预算和在途快照均原样保留。
 *
 * @param prev Schema 10、内容版本 2026.08.5 的存档
 * @returns 已应用正式正职资格语义的存档
 */
export function migrateSchema10TownshipChiefContent(
  prev: Record<string, unknown>,
): Record<string, unknown> {
  if (prev.contentVersion !== '2026.08.5') return prev;
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  const career = state?.career as Record<string, unknown> | undefined;
  const time = state?.time as Record<string, unknown> | undefined;
  const opportunities = career?.opportunities;
  if (
    !state ||
    !career ||
    !Array.isArray(opportunities) ||
    typeof time?.totalDaysPlayed !== 'number'
  )
    throw new Error('Legacy save is missing career opportunity state for chief content migration');
  const currentDay = time.totalDaysPlayed;
  backfillCareerExperienceAssessments(state, currentDay);
  const cancelledOpportunityIds = new Set<string>();
  const replaceableOpportunityIds = new Set<string>();
  for (const value of opportunities) {
    if (!value || typeof value !== 'object') continue;
    const opportunity = value as Record<string, unknown>;
    if (opportunity.definitionId !== 'township_chief_leadership_vacancy') continue;
    const status = String(opportunity.status);
    if (!['available', 'accepted', 'in_process', 'expired'].includes(status)) continue;
    if (typeof opportunity.id !== 'string')
      throw new Error('Legacy chief opportunity has no stable ID');
    replaceableOpportunityIds.add(opportunity.id);
    // 旧窗口自然过期只说明 30 天时限已结束，保留原 expired 记录并让下方按
    // 正式 270 天时限判断是否恢复；活动机会才需要在内容切换时显式取消。
    if (status === 'expired') continue;
    cancelledOpportunityIds.add(opportunity.id);
    opportunity.status = 'cancelled';
    opportunity.acceptedAtDay = null;
    opportunity.rejectedAtDay = null;
    opportunity.resolvedAtDay = null;
    opportunity.cancelledAtDay = currentDay;
    opportunity.finalOutcome = null;
  }
  const activeProcess = career.activeProcess;
  if (activeProcess && typeof activeProcess === 'object') {
    const process = activeProcess as Record<string, unknown>;
    if (
      typeof process.opportunityId === 'string' &&
      cancelledOpportunityIds.has(process.opportunityId)
    ) {
      const stageResults = Array.isArray(process.stageResults) ? process.stageResults : [];
      stageResults.push({
        stage: process.currentStage,
        resolvedAtDay: currentDay,
        outcome: 'cancelled',
        score: null,
        detail: '内容更新后按正式正职资格重新等待机会',
      });
      process.stageResults = stageResults;
      process.status = 'cancelled';
      process.completedAtDay = currentDay;
      const completedProcesses = Array.isArray(career.completedProcesses)
        ? career.completedProcesses
        : [];
      completedProcesses.push(process);
      career.completedProcesses = completedProcesses;
      career.activeProcess = null;
    }
  }
  // 本轮刚取消的旧内容机会不能充当正式机会的去重凭据；否则同一考核源下的
  // 30 天旧窗口会反过来阻止 270 天正式窗口恢复。迁移前已终结的记录仍参与去重，
  // 防止已经消费过的来源被再次开放。
  // Schema 10 尚无组织世界，但当前机会编排只认实际空席；先建立迁移日快照供
  // 历史信号重放使用，最终 Schema 12 迁移会基于同一输入重新确定性落盘。
  state.organization = createMigrationOrganizationState(state, currentDay);
  restoreMissedTownshipChiefOpportunity(state, currentDay, replaceableOpportunityIds);
  migrated.contentVersion = '2026.08.6';
  return migrated;
}

/**
 * 迁移 Phase 3 发布内容版本。
 *
 * 本次只补齐正式配置 producer、可达性验收和数值平衡，不改变持久化结构。
 * 既有预算、机会、事件、政策及在途可执行快照全部保持原样；新配置只作用于
 * 后续创建的运行时实例和下一次正常年度预算结算。
 *
 * @param prev Schema 10、内容版本 2026.08.6 的存档
 * @returns 保留运行时状态并升级至当前内容版本的存档
 */
export function migrateSchema10Phase3ReleaseContent(
  prev: Record<string, unknown>,
): Record<string, unknown> {
  if (prev.contentVersion !== '2026.08.6') return prev;
  const migrated = structuredClone(prev);
  migrated.contentVersion = CURRENT_CONTENT_VERSION;
  return migrated;
}

/**
 * 迁移 Schema 10 的年度职数内容语义。
 *
 * `2026.08.2` 新存档会为所有未来职级预置职数；该库存无法与玩家行为区分，
 * 而当时也不存在年度 producer。因此迁移时将全部正式职数恢复为新配置的
 * 初始值，让后续库存只能由年度考核重新取得。行动/政策快照继续保留原内容版本。
 *
 * @param prev Schema 10 SaveEnvelope
 * @returns 已应用当前内容语义的 Schema 10 SaveEnvelope
 */
export function migrateSchema10RankQuotaContent(
  prev: Record<string, unknown>,
): Record<string, unknown> {
  if (prev.contentVersion !== '2026.08.2') return prev;
  const migrated = structuredClone(prev);
  resetLegacyRankQuotaMetrics(migrated);
  migrated.contentVersion = '2026.08.3';
  return migrated;
}

/**
 * 将 Schema 10 存档迁移至当前 Schema 14（函数名保留以兼容既有调用方）。
 *
 * 旧存档没有可恢复的 NPC 历史，因此只在迁移日确定性建立配置干部池；不会
 * 伪造迁移日前的 NPC 考核或任职年限。玩家当前有效任职映射到唯一实际 Seat。
 *
 * @param prev 已完成 Schema 10 内容迁移的 SaveEnvelope
 * @returns 包含组织世界状态、离任账本和 Vacancy 审计字段的 Schema 14 SaveEnvelope
 */
export function migrateSchema10To11(prev: Record<string, unknown>): Record<string, unknown> {
  if (prev.schemaVersion !== 10) return prev;
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  const career = state?.career as Record<string, unknown> | undefined;
  const time = state?.time as Record<string, unknown> | undefined;
  if (!state || !career || !time) throw new Error('Schema 10 save is missing migration state');
  const initializedAtDay = time.totalDaysPlayed;
  if (
    typeof initializedAtDay !== 'number' ||
    !Number.isInteger(initializedAtDay) ||
    initializedAtDay < 0
  )
    throw new Error('Schema 10 save has invalid totalDaysPlayed');
  state.organization = createMigrationOrganizationState(state, initializedAtDay);
  migrated.schemaVersion = 11;
  migrated.contentVersion = CURRENT_CONTENT_VERSION;
  // 保持该公开迁移入口对旧调用方的“迁移到当前版本”语义。
  return migrateSchema11To12(migrated);
}

/** 将 Schema 11 的组织世界升级至 Schema 14，并建立空的离任事实账本。 */
export function migrateSchema11To12(prev: Record<string, unknown>): Record<string, unknown> {
  if (prev.schemaVersion !== 11) return prev;
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  if (!state || !state.organization || typeof state.organization !== 'object')
    throw new Error('Schema 11 save is missing organization state');
  const organization = state.organization as Record<string, unknown>;
  if (organization.departures === undefined) organization.departures = [];
  else if (!Array.isArray(organization.departures))
    throw new Error('Schema 11 organization departures must be an array');
  migrated.schemaVersion = 12;
  migrated.contentVersion = CURRENT_CONTENT_VERSION;
  // 保持该公开迁移入口对旧调用方的“迁移到当前版本”语义。
  return migrateSchema13To14(migrateSchema12To13(migrated));
}

/** 从机会 sourceId 移除恰好一个 vacancy 命名空间，恢复 raw Vacancy ID。 */
function rawVacancyIdFromSourceId(sourceId: unknown): string | null {
  const prefix = 'vacancy:';
  if (typeof sourceId !== 'string' || !sourceId.startsWith(prefix)) return null;
  const rawVacancyId = sourceId.slice(prefix.length);
  return rawVacancyId.trim().length > 0 ? rawVacancyId : null;
}

/**
 * 将 Schema 12 的 Vacancy/机会结构升级至 Schema 13。
 *
 * 这是向后兼容的字段补齐与组织事实回填：缺失终态字段才使用确定性的 null
 * 默认值；已存在但类型错误的字段必须保留，让严格 Schema 报告存档损坏，而不是静默修正。
 *
 * @param prev Schema 12 SaveEnvelope
 * @returns Schema 13 SaveEnvelope（Schema 14 由 migrateSchema13To14 完成）
 */
export function migrateSchema12To13(prev: Record<string, unknown>): Record<string, unknown> {
  if (prev.schemaVersion !== 12) return prev;
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  if (!state || typeof state.organization !== 'object' || state.organization === null)
    throw new Error('Schema 12 save is missing organization state');
  const organization = state.organization as Record<string, unknown>;
  if (!Array.isArray(organization.vacancies))
    throw new Error('Schema 12 organization vacancies must be an array');
  if (!Array.isArray(organization.seats))
    throw new Error('Schema 12 organization seats must be an array');
  if (!Array.isArray(organization.processedProducerKeys))
    throw new Error('Schema 12 organization processedProducerKeys must be an array');
  for (const value of organization.vacancies) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Schema 12 organization vacancies contain an invalid entry');
    const vacancy = value as Record<string, unknown>;
    if (vacancy.filledBy === undefined) vacancy.filledBy = null;
    if (vacancy.filledAppointmentId === undefined) vacancy.filledAppointmentId = null;
    if (vacancy.cancellationReason === undefined) vacancy.cancellationReason = null;
  }

  const initializedAtDay = organization.initializedAtDay;
  if (
    typeof initializedAtDay !== 'number' ||
    !Number.isInteger(initializedAtDay) ||
    initializedAtDay < 0
  ) {
    throw new Error('Schema 12 organization initializedAtDay must be a non-negative integer');
  }
  const vacancies = organization.vacancies as unknown[];
  const processedProducerKeys = organization.processedProducerKeys as unknown[];
  const seats = organization.seats
    .map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Schema 12 organization seats contain an invalid entry');
      const seat = value as Record<string, unknown>;
      if (typeof seat.seatId !== 'string' || seat.seatId.length === 0)
        throw new Error('Schema 12 organization seat has an invalid seatId');
      return seat;
    })
    .sort((left, right) => (left.seatId as string).localeCompare(right.seatId as string));
  const seatIds = new Set<string>();
  for (const seat of seats) {
    const seatId = seat.seatId as string;
    if (seatIds.has(seatId)) throw new Error(`Schema 12 has duplicate seat identity ${seatId}`);
    seatIds.add(seatId);
    if (seat.occupant !== null) continue;

    const vacancyId = `vacancy:initial:${seatId}`;
    const processedKey = vacancyId;
    const activeVacancy = vacancies.find((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const vacancy = value as Record<string, unknown>;
      return (
        vacancy.seatId === seatId && (vacancy.status === 'open' || vacancy.status === 'selecting')
      );
    });
    const existingById = vacancies.find((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return (value as Record<string, unknown>).vacancyId === vacancyId;
    });
    const keyExists = processedProducerKeys.includes(processedKey);
    const expected = {
      vacancyId,
      seatId,
      positionId: seat.positionId,
      positionNameSnapshot: seat.positionNameSnapshot,
      institutionId: seat.institutionId,
      institutionNameSnapshot: seat.institutionNameSnapshot,
      regionId: seat.regionId,
      institutionLevel: seat.institutionLevel,
      positionDomain: seat.positionDomain,
      leadershipRank: seat.leadershipRank,
      openedAtDay: initializedAtDay,
      reason: 'initial_opening',
      status: 'open',
      sourceType: 'system',
      sourceId: `initial:${seatId}`,
      closesAtDay: null,
      closedAtDay: null,
      selectionId: null,
      filledBy: null,
      filledAppointmentId: null,
      cancellationReason: null,
    } as const;
    const matchesExpected =
      existingById !== undefined &&
      Object.entries(expected).every(([field, value]) => {
        return (existingById as Record<string, unknown>)[field] === value;
      });

    if (existingById && !matchesExpected)
      throw new Error(`Schema 12 initial Vacancy ID conflict: ${vacancyId}`);
    if (keyExists && !matchesExpected)
      throw new Error(`Schema 12 initial Vacancy producer key conflict: ${processedKey}`);
    if (activeVacancy) {
      // Existing active vacancies already represent this empty Seat; migration must not fork it.
      continue;
    }
    if (matchesExpected) {
      if (!keyExists) processedProducerKeys.push(processedKey);
      continue;
    }

    vacancies.push(expected);
    processedProducerKeys.push(processedKey);
  }

  const career = state.career as Record<string, unknown> | undefined;
  if (!career || !Array.isArray(career.opportunities))
    throw new Error('Schema 12 save is missing career opportunities');
  const vacancyIds = new Set(
    vacancies.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const vacancyId = (value as Record<string, unknown>).vacancyId;
      return typeof vacancyId === 'string' ? [vacancyId] : [];
    }),
  );
  for (const value of career.opportunities) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Schema 12 career opportunities contain an invalid entry');
    const opportunity = value as Record<string, unknown>;
    if (opportunity.vacancyId !== undefined) continue;
    const source = opportunity.source;
    const sourceRecord =
      source && typeof source === 'object' && !Array.isArray(source)
        ? (source as Record<string, unknown>)
        : null;
    const candidateVacancyId =
      sourceRecord?.sourceType === 'vacancy'
        ? rawVacancyIdFromSourceId(sourceRecord.sourceId)
        : null;
    opportunity.vacancyId =
      candidateVacancyId !== null && vacancyIds.has(candidateVacancyId) ? candidateVacancyId : null;
  }
  migrated.schemaVersion = 13;
  migrated.contentVersion = CURRENT_CONTENT_VERSION;
  return migrated;
}

/** 将缺少冻结评分的旧 completed Selection 变成不可重放但结构完整的终态审计。 */
function buildLegacyCompletedStageResults(
  selection: Record<string, unknown>,
  _fallbackStage: string,
): unknown[] {
  const stages = [
    'eligibility_review',
    'democratic_recommendation',
    'organization_inspection',
    'collective_decision',
    'public_notice',
    'appointment',
  ];
  const candidateIds = Array.isArray(selection.candidates)
    ? selection.candidates
        .filter(
          (candidate): candidate is Record<string, unknown> =>
            !!candidate && typeof candidate === 'object' && !Array.isArray(candidate),
        )
        .map((candidate) => candidate.candidateId)
        .filter((candidateId): candidateId is string => typeof candidateId === 'string')
        .sort((left, right) => left.localeCompare(right))
    : [];
  const uniqueCandidateIds = [...new Set(candidateIds)];
  const winnerId = typeof selection.winnerId === 'string' ? selection.winnerId : null;
  if (winnerId === null || !uniqueCandidateIds.includes(winnerId)) return [];
  const audits = Array.isArray(selection.stageAudits) ? selection.stageAudits : [];
  let survivors = uniqueCandidateIds;
  return stages.map((stage, index) => {
    const audit = audits[index];
    const auditRecord =
      audit && typeof audit === 'object' && !Array.isArray(audit)
        ? (audit as Record<string, unknown>)
        : null;
    const auditCandidates = Array.isArray(auditRecord?.candidates)
      ? auditRecord.candidates
          .filter(
            (candidate): candidate is Record<string, unknown> =>
              !!candidate && typeof candidate === 'object' && !Array.isArray(candidate),
          )
          .filter((candidate) => uniqueCandidateIds.includes(candidate.candidateId as string))
      : [];
    const byId = new Map(
      auditCandidates.map((candidate) => [candidate.candidateId as string, candidate]),
    );
    const stageCandidateIds = [...survivors];
    const candidates = stageCandidateIds.map((candidateId, rank) => {
      const legacy = byId.get(candidateId);
      const score =
        typeof legacy?.score === 'number' && Number.isFinite(legacy.score)
          ? Math.max(0, Math.min(100, legacy.score))
          : 0;
      return {
        candidateId,
        score,
        rank: rank + 1,
        eliminated: false,
      };
    });
    const auditedSurvivors = Array.isArray(auditRecord?.survivingCandidateIds)
      ? stageCandidateIds.filter((candidateId) =>
          (auditRecord.survivingCandidateIds as unknown[]).includes(candidateId),
        )
      : stageCandidateIds;
    const surviving =
      index === stages.length - 1
        ? [winnerId]
        : auditedSurvivors.length > 0
          ? auditedSurvivors
          : stageCandidateIds;
    const survivingSet = new Set(surviving);
    for (const candidate of candidates)
      candidate.eliminated = !survivingSet.has(candidate.candidateId);
    survivors = surviving;
    return {
      stage,
      resolvedAtDay:
        typeof auditRecord?.resolvedAtDay === 'number'
          ? auditRecord.resolvedAtDay
          : (selection.completedAtDay ?? selection.startedAtDay ?? 0),
      candidates,
      survivingCandidateIds: surviving.length > 0 ? surviving : uniqueCandidateIds,
    };
  });
}

/**
 * 将 Schema 13 的世界选拔结构升级为冻结 Selection 审计结构。
 *
 * Schema 13 没有可重放的候选快照或 RNG，因此旧 Selection 只能成为明确的
 * terminal failed audit；迁移绝不猜测赢家或重新抽取随机数。
 *
 * @param prev Schema 13 SaveEnvelope
 * @returns Schema 14 SaveEnvelope；非 Schema 13 输入原样返回
 */
export function migrateSchema13To14(prev: Record<string, unknown>): Record<string, unknown> {
  if (prev.schemaVersion !== 13) return prev;
  const migrated = structuredClone(prev);
  const state = migrated.state as Record<string, unknown> | undefined;
  if (!state || typeof state.organization !== 'object' || state.organization === null)
    throw new Error('Schema 13 save is missing organization state');
  const organization = state.organization as Record<string, unknown>;
  if (!Array.isArray(organization.selections) || !Array.isArray(organization.vacancies))
    throw new Error('Schema 13 organization selections/vacancies must be arrays');
  const legacySelectionIds = new Set<string>();
  for (const value of organization.selections) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Schema 13 organization selections contain an invalid entry');
    const selection = value as Record<string, unknown>;
    if (typeof selection.selectionId !== 'string' || typeof selection.vacancyId !== 'string')
      throw new Error('Schema 13 Selection has invalid identity');
    if (selection.candidates !== undefined && !Array.isArray(selection.candidates))
      throw new Error('Schema 13 Selection candidates must be an array');
    for (const candidateValue of selection.candidates ?? []) {
      if (!candidateValue || typeof candidateValue !== 'object' || Array.isArray(candidateValue))
        throw new Error('Schema 13 Selection candidate has an invalid entry');
      const candidate = candidateValue as Record<string, unknown>;
      if (candidate.experiences === undefined) candidate.experiences = [];
    }
    if (selection.rulesVersion === undefined) selection.rulesVersion = 'legacy-schema-13';
    const lastAudit = Array.isArray(selection.stageAudits)
      ? selection.stageAudits.at(-1)
      : undefined;
    const legacyStageCandidate =
      lastAudit &&
      typeof lastAudit === 'object' &&
      !Array.isArray(lastAudit) &&
      typeof (lastAudit as Record<string, unknown>).stage === 'string'
        ? (lastAudit as Record<string, unknown>).stage
        : typeof selection.currentStage === 'string'
          ? selection.currentStage
          : 'appointment';
    const legacyStage =
      RELATIVE_SELECTION_STAGES.find((stage) => stage === legacyStageCandidate) ?? 'appointment';
    if (Array.isArray(selection.stageAudits)) {
      for (const value of selection.stageAudits) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const audit = value as Record<string, unknown>;
          if (audit.candidates === undefined) audit.candidates = [];
        }
      }
    }
    if (selection.status === 'completed') {
      if (selection.winnerId === undefined) {
        const winner = selection.winner;
        selection.winnerId =
          winner &&
          typeof winner === 'object' &&
          !Array.isArray(winner) &&
          typeof (winner as Record<string, unknown>).id === 'string'
            ? (winner as Record<string, unknown>).id
            : null;
      }
      if (selection.failure === undefined) selection.failure = null;
      if (selection.stageResults === undefined)
        selection.stageResults = buildLegacyCompletedStageResults(selection, legacyStage);
    } else if (selection.status === 'active' || selection.status === 'pending') {
      selection.status = 'failed';
      selection.winner = null;
      selection.winnerId = null;
      selection.failure = {
        code:
          selection.candidates instanceof Array && selection.candidates.length === 0
            ? 'no_qualified_candidates'
            : 'stage_no_survivors',
        stage:
          selection.candidates instanceof Array && selection.candidates.length === 0
            ? null
            : legacyStage,
        detail: 'Schema 13 Selection lacks frozen candidates and cannot be resumed',
      };
      if (selection.stageResults === undefined) selection.stageResults = [];
      // 旧赢家没有冻结候选审计；不把不可验证记录升级成新赢家事实。
    } else if (selection.status === 'failed') {
      if (selection.winnerId === undefined) selection.winnerId = null;
      if (selection.stageResults === undefined) selection.stageResults = [];
      if (selection.failure === undefined)
        selection.failure = {
          code:
            selection.candidates instanceof Array && selection.candidates.length === 0
              ? 'no_qualified_candidates'
              : 'stage_no_survivors',
          stage:
            selection.candidates instanceof Array && selection.candidates.length === 0
              ? null
              : legacyStage,
          detail: 'Schema 13 Selection lacks frozen candidates and cannot be resumed',
        };
    } else if (selection.status === 'cancelled') {
      if (selection.winnerId === undefined) selection.winnerId = null;
      if (selection.failure === undefined) selection.failure = null;
      if (selection.stageResults === undefined) selection.stageResults = [];
    }
    if (selection.completedAtDay === null || selection.completedAtDay === undefined)
      selection.completedAtDay = selection.startedAtDay;
    legacySelectionIds.add(selection.selectionId);
  }
  for (const value of organization.vacancies) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Schema 13 organization vacancies contain an invalid entry');
    const vacancy = value as Record<string, unknown>;
    if (typeof vacancy.selectionId === 'string' && legacySelectionIds.has(vacancy.selectionId)) {
      if (vacancy.status === 'selecting' || vacancy.status === 'open') {
        vacancy.status = 'open';
        vacancy.selectionId = null;
      }
    }
  }
  const career = state.career as Record<string, unknown> | undefined;
  if (!career) throw new Error('Schema 13 save is missing career state');
  const time = state.time as Record<string, unknown> | undefined;
  const migrationDay = typeof time?.totalDaysPlayed === 'number' ? time.totalDaysPlayed : 0;
  const processValues = [
    career.activeProcess,
    ...(Array.isArray(career.completedProcesses) ? career.completedProcesses : []),
  ];
  const selections = organization.selections as Array<Record<string, unknown>>;
  for (const value of processValues) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const process = value as Record<string, unknown>;
    if (process.selectionId === undefined) process.selectionId = null;
    if (process.vacancyId === undefined) process.vacancyId = null;
    if (process.winnerId === undefined) process.winnerId = null;
    if (process.failure === undefined) process.failure = null;
    const linkedSelection =
      typeof process.selectionId === 'string'
        ? selections.find((selection) => selection.selectionId === process.selectionId)
        : undefined;
    const replayableSelection =
      linkedSelection?.status === 'active' &&
      typeof linkedSelection.rulesVersion === 'string' &&
      Array.isArray(linkedSelection.stageResults) &&
      Array.isArray(linkedSelection.randomDraws);
    if (
      process.type === 'leadership_selection' &&
      process.status === 'active' &&
      !replayableSelection
    ) {
      process.status = 'failed';
      process.completedAtDay = process.completedAtDay ?? migrationDay;
      process.failure = {
        code: 'stage_no_survivors',
        stage:
          typeof process.currentStage === 'string'
            ? (RELATIVE_SELECTION_STAGES.find((stage) => stage === process.currentStage) ??
              'appointment')
            : 'appointment',
        detail: 'Schema 13 CareerProcess lacks a replayable Selection',
      };
      if (Array.isArray(career.opportunities)) {
        const opportunity = career.opportunities.find(
          (candidate) =>
            candidate &&
            typeof candidate === 'object' &&
            !Array.isArray(candidate) &&
            (candidate as Record<string, unknown>).id === process.opportunityId,
        );
        if (opportunity && typeof opportunity === 'object' && !Array.isArray(opportunity)) {
          const legacyOpportunity = opportunity as Record<string, unknown>;
          if (
            legacyOpportunity.status === 'accepted' ||
            legacyOpportunity.status === 'in_process'
          ) {
            legacyOpportunity.status = 'resolved';
            legacyOpportunity.resolvedAtDay = migrationDay;
            legacyOpportunity.finalOutcome = 'not_selected';
          }
        }
      }
      if (Array.isArray(process.stageResults)) {
        for (const result of process.stageResults) {
          if (result && typeof result === 'object' && !Array.isArray(result)) {
            const stageResult = result as Record<string, unknown>;
            if (stageResult.candidateResults === undefined) stageResult.candidateResults = [];
            if (stageResult.survivingCandidateIds === undefined)
              stageResult.survivingCandidateIds = [];
          }
        }
      }
    }
  }
  const activeProcess = career.activeProcess;
  if (
    activeProcess &&
    typeof activeProcess === 'object' &&
    !Array.isArray(activeProcess) &&
    (activeProcess as Record<string, unknown>).status !== 'active'
  ) {
    const completed = Array.isArray(career.completedProcesses) ? career.completedProcesses : [];
    completed.push(structuredClone(activeProcess));
    career.completedProcesses = completed;
    career.activeProcess = null;
  }
  migrated.schemaVersion = 14;
  migrated.contentVersion = CURRENT_CONTENT_VERSION;
  return migrated;
}

/**
 * 严格解码存档数据（已解析的对象）。
 *
 * 支持从 MIN_MIGRATABLE_SCHEMA_VERSION 开始的确定性迁移：
 * - 低于可迁移版本：拒绝为 legacy；
 * - Schema 2–10：按版本顺序链式迁移至 Schema 14；
 * - Schema 11：补齐离任事实账本后迁移至 Schema 14；
 * - Schema 12：补齐 Vacancy 终态审计字段并回填初始空缺后迁移至 Schema 14；
 * - Schema 13：升级冻结 Selection 审计后迁移至 Schema 14；
 * - 当前版本（Schema 14）：直接解码；
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
      target = migrateSchema9To10(
        migrateSchema8To9(
          migrateSchema7To8(
            migrateSchema6To7(
              migrateSchema5To6(migrateSchema4To5(migrateSchema3To4(migrateSchema2To3(obj)))),
            ),
          ),
        ),
      );
    } else if (obj.schemaVersion === 3) {
      target = migrateSchema9To10(
        migrateSchema8To9(
          migrateSchema7To8(
            migrateSchema6To7(migrateSchema5To6(migrateSchema4To5(migrateSchema3To4(obj)))),
          ),
        ),
      );
    } else if (obj.schemaVersion === 4) {
      target = migrateSchema9To10(
        migrateSchema8To9(
          migrateSchema7To8(migrateSchema6To7(migrateSchema5To6(migrateSchema4To5(obj)))),
        ),
      );
    } else if (obj.schemaVersion === 5) {
      target = migrateSchema9To10(
        migrateSchema8To9(migrateSchema7To8(migrateSchema6To7(migrateSchema5To6(obj)))),
      );
    } else if (obj.schemaVersion === 6) {
      target = migrateSchema9To10(migrateSchema8To9(migrateSchema7To8(migrateSchema6To7(obj))));
    } else if (obj.schemaVersion === 7) {
      target = migrateSchema9To10(migrateSchema8To9(migrateSchema7To8(obj)));
    } else if (obj.schemaVersion === 8) {
      target = migrateSchema9To10(migrateSchema8To9(obj));
    } else if (obj.schemaVersion === 9) {
      target = migrateSchema9To10(obj);
    }
    target = migrateSchema10RankQuotaContent(target as Record<string, unknown>);
    target = migrateSchema10DeputyOpportunityContent(target as Record<string, unknown>);
    target = migrateSchema10TownshipGovernanceContent(target as Record<string, unknown>);
    target = migrateSchema10TownshipChiefContent(target as Record<string, unknown>);
    target = migrateSchema10Phase3ReleaseContent(target as Record<string, unknown>);
    target = migrateSchema10To11(target as Record<string, unknown>);
    target = migrateSchema11To12(target as Record<string, unknown>);
    target = migrateSchema13To14(migrateSchema12To13(target as Record<string, unknown>));
  } catch (e) {
    return {
      success: false,
      error: 'migration_failed',
      detail: e instanceof Error ? e.message : 'Unknown migration error',
    };
  }

  // Content migrations can append a terminal legacy process after the
  // organization migration has already run. Complete only missing Schema 14
  // fields on saves that originated before Schema 14; current saves remain
  // strictly untouched so malformed data still fails decoding.
  if (obj.schemaVersion < CURRENT_SCHEMA_VERSION && target && typeof target === 'object') {
    const migratedState = (target as Record<string, unknown>).state;
    const migratedCareer =
      migratedState && typeof migratedState === 'object'
        ? (migratedState as Record<string, unknown>).career
        : null;
    const processes =
      migratedCareer && typeof migratedCareer === 'object'
        ? [
            (migratedCareer as Record<string, unknown>).activeProcess,
            ...((Array.isArray((migratedCareer as Record<string, unknown>).completedProcesses)
              ? (migratedCareer as Record<string, unknown>).completedProcesses
              : []) as unknown[]),
          ]
        : [];
    for (const value of processes) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const process = value as Record<string, unknown>;
      if (process.selectionId === undefined) process.selectionId = null;
      if (process.vacancyId === undefined) process.vacancyId = null;
      if (process.winnerId === undefined) process.winnerId = null;
      if (process.failure === undefined) process.failure = null;
      if (
        process.type === 'leadership_selection' &&
        process.selectionId === null &&
        Array.isArray(process.stageResults)
      ) {
        for (const stage of process.stageResults) {
          if (!stage || typeof stage !== 'object' || Array.isArray(stage)) continue;
          const result = stage as Record<string, unknown>;
          if (result.candidateResults === undefined) result.candidateResults = [];
          if (result.survivingCandidateIds === undefined) result.survivingCandidateIds = [];
        }
      }
    }
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
