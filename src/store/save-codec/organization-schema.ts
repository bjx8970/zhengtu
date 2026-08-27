/**
 * Phase 4 组织世界的严格 Zod 存档 Schema。
 *
 * 玩家与 NPC 复用同一任职、履历和限制契约；这些 Schema 由主解码器注入，
 * 避免在组织模块复制一套会随 CareerState 漂移的结构定义。
 */

import { z } from 'zod';
import {
  CIVIL_SERVICE_RANKS,
  INSTITUTION_LEVELS,
  LEADERSHIP_RANKS,
  POSITION_DOMAINS,
} from '../../domain/career/types';
import type { OrganizationState } from '../../types/organization';

const SeatOccupantRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('player'), id: z.literal('player') }).strict(),
  z.object({ type: z.literal('npc'), id: z.string().min(1) }).strict(),
]);

const SelectionStageSchema = z.enum([
  'eligibility_review',
  'democratic_recommendation',
  'organization_inspection',
  'collective_decision',
  'public_notice',
  'appointment',
]);

/**
 * 构建组织世界 Schema。
 *
 * @param dependencies 主存档解码器提供的职业事实 Schema
 * @returns 严格组织世界 Schema
 */
export function createOrganizationStateSchema(dependencies: {
  currentAppointment: z.ZodTypeAny;
  careerExperience: z.ZodTypeAny;
  careerRestriction: z.ZodTypeAny;
  careerAssessmentRecord: z.ZodTypeAny;
}): z.ZodType<OrganizationState> {
  const cadre = z
    .object({
      cadreId: z.string().min(1),
      name: z.string().min(1),
      gender: z.enum(['男', '女']),
      birthYear: z.number().int().min(1900),
      civilServiceRank: z.enum(CIVIL_SERVICE_RANKS),
      civilServiceRankStartedAtDay: z.number().int().nonnegative(),
      currentAppointment: dependencies.currentAppointment.nullable(),
      experiences: z.array(dependencies.careerExperience),
      assessments: z.array(dependencies.careerAssessmentRecord),
      specialties: z.record(z.number()),
      restrictions: z.array(dependencies.careerRestriction),
      status: z.enum(['active', 'retired', 'exited']),
      exitedAtDay: z.number().int().nonnegative().nullable(),
      exitReason: z.string().min(1).nullable(),
    })
    .strict();
  const seat = z
    .object({
      seatId: z.string().min(1),
      positionId: z.string().min(1),
      positionNameSnapshot: z.string().min(1),
      institutionId: z.string().min(1),
      institutionNameSnapshot: z.string().min(1),
      regionId: z.string().min(1),
      institutionLevel: z.enum(INSTITUTION_LEVELS),
      positionDomain: z.enum(POSITION_DOMAINS),
      leadershipRank: z.enum(LEADERSHIP_RANKS),
      occupant: SeatOccupantRefSchema.nullable(),
      currentAppointmentId: z.string().min(1).nullable(),
      occupiedAtDay: z.number().int().nonnegative().nullable(),
      sourceTransitionId: z.string().min(1).nullable(),
    })
    .strict();
  const vacancy = z
    .object({
      vacancyId: z.string().min(1),
      seatId: z.string().min(1),
      positionId: z.string().min(1),
      positionNameSnapshot: z.string().min(1),
      institutionId: z.string().min(1),
      institutionNameSnapshot: z.string().min(1),
      regionId: z.string().min(1),
      institutionLevel: z.enum(INSTITUTION_LEVELS),
      positionDomain: z.enum(POSITION_DOMAINS),
      leadershipRank: z.enum(LEADERSHIP_RANKS),
      openedAtDay: z.number().int().nonnegative(),
      reason: z.enum([
        'initial_opening',
        'retirement',
        'promotion',
        'lateral_transfer',
        'rotation',
        'disciplinary_exit',
        'political_cycle',
        'organization_change',
      ]),
      status: z.enum(['open', 'selecting', 'filled', 'cancelled', 'expired']),
      sourceType: z.enum(['appointment', 'cadre_lifecycle', 'political_cycle', 'event', 'system']),
      sourceId: z.string().min(1),
      closesAtDay: z.number().int().nonnegative().nullable(),
      closedAtDay: z.number().int().nonnegative().nullable(),
      selectionId: z.string().min(1).nullable(),
      /** Schema 12 had no terminal occupant/cancellation audit fields. */
      filledBy: SeatOccupantRefSchema.nullable(),
      filledAppointmentId: z.string().min(1).nullable(),
      cancellationReason: z
        .enum([
          'organization_change',
          'selection_cancelled',
          'opportunity_withdrawn',
          'expired',
          'system',
        ])
        .nullable(),
    })
    .strict()
    .superRefine((value, ctx) => {
      const filled = value.status === 'filled';
      const terminalCancellation = value.status === 'cancelled' || value.status === 'expired';
      if (filled !== (value.filledBy !== null && value.filledAppointmentId !== null))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Filled Vacancy must retain its occupant and appointment audit fields',
        });
      if (terminalCancellation !== (value.cancellationReason !== null))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Cancelled or expired Vacancy must retain a cancellation reason',
        });
      if ((value.status === 'open' || value.status === 'selecting') && value.closedAtDay !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Active Vacancy cannot have a closedAtDay',
        });
      if (terminalCancellation && value.closedAtDay === null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Cancelled or expired Vacancy requires a closedAtDay',
        });
    });
  const candidate = z
    .object({
      candidateId: z.string().min(1),
      candidateType: z.enum(['player', 'npc']),
      currentPositionId: z.string().min(1).nullable(),
      institutionId: z.string().min(1).nullable(),
      regionId: z.string().min(1).nullable(),
      leadershipRank: z.enum(LEADERSHIP_RANKS),
      civilServiceRank: z.enum(CIVIL_SERVICE_RANKS),
      appointmentStartedAtDay: z.number().int().nonnegative().nullable(),
      serviceStartedAtDay: z.number().int().nonnegative(),
      assessments: z.array(dependencies.careerAssessmentRecord),
      specialties: z.record(z.number()),
      restrictionTypes: z.array(z.string().min(1)),
      scoringInputs: z.record(z.number()),
    })
    .strict();
  const departure = z
    .object({
      departureId: z.string().min(1),
      cadreId: z.string().min(1),
      appointmentId: z.string().min(1).nullable(),
      experienceId: z.string().min(1).nullable(),
      seatId: z.string().min(1).nullable(),
      positionId: z.string().min(1).nullable(),
      institutionId: z.string().min(1).nullable(),
      regionId: z.string().min(1).nullable(),
      occurredAtDay: z.number().int().nonnegative(),
      reason: z.enum(['retirement', 'disciplinary_exit']),
      sourceType: z.literal('cadre_lifecycle'),
    })
    .strict();
  const selection = z
    .object({
      selectionId: z.string().min(1),
      vacancyId: z.string().min(1),
      status: z.enum(['pending', 'active', 'completed', 'cancelled', 'failed']),
      currentStage: SelectionStageSchema,
      startedAtDay: z.number().int().nonnegative(),
      completedAtDay: z.number().int().nonnegative().nullable(),
      candidates: z.array(candidate),
      stageAudits: z.array(
        z
          .object({
            stage: SelectionStageSchema,
            resolvedAtDay: z.number().int().nonnegative(),
            survivingCandidateIds: z.array(z.string().min(1)),
            detail: z.string(),
            candidates: z.array(
              z
                .object({
                  candidateId: z.string().min(1),
                  score: z.number().min(0).max(100),
                  rank: z.number().int().positive(),
                  eliminated: z.boolean(),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      winner: SeatOccupantRefSchema.nullable(),
      playerCareerProcessId: z.string().min(1).nullable(),
      randomDraws: z.array(z.number().min(0).max(1)),
      rulesVersion: z.string().min(1).optional(),
      stageResults: z
        .array(
          z
            .object({
              stage: SelectionStageSchema,
              resolvedAtDay: z.number().int().nonnegative(),
              candidates: z.array(
                z
                  .object({
                    candidateId: z.string().min(1),
                    score: z.number().min(0).max(100),
                    rank: z.number().int().positive(),
                    eliminated: z.boolean(),
                  })
                  .strict(),
              ),
              survivingCandidateIds: z.array(z.string().min(1)),
            })
            .strict(),
        )
        .optional(),
      winnerId: z.string().min(1).nullable().optional(),
      failure: z
        .object({
          code: z.enum(['no_qualified_candidates', 'stage_no_survivors', 'no_unique_winner']),
          stage: SelectionStageSchema.nullable(),
          detail: z.string().min(1),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      for (const field of ['rulesVersion', 'stageResults', 'winnerId', 'failure'] as const) {
        if (
          !Object.prototype.hasOwnProperty.call(value, field) ||
          (value[field] as unknown) === undefined
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `Selection ${field} is required in Schema 14`,
          });
      }
      if (value.stageResults) {
        const stages = value.stageResults.map((result) => result.stage);
        const expectedPrefix = [
          'eligibility_review',
          'democratic_recommendation',
          'organization_inspection',
          'collective_decision',
          'public_notice',
          'appointment',
        ];
        if (stages.some((stage, index) => stage !== expectedPrefix[index]))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stageResults'],
            message: 'Selection stage results must be a fixed-order prefix',
          });
        if (new Set(stages).size !== stages.length)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stageResults'],
            message: 'Selection stage results must be unique',
          });
        for (const [stageIndex, result] of value.stageResults.entries()) {
          const candidateIds = new Set(result.candidates.map((candidate) => candidate.candidateId));
          if (candidateIds.size !== result.candidates.length)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['stageResults'],
              message: 'Selection stage candidate IDs must be unique',
            });
          result.candidates.forEach((candidate, index) => {
            if (candidate.rank !== index + 1)
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['stageResults'],
                message: 'Selection stage ranks must be continuous and match array order',
              });
          });
          if (!result.survivingCandidateIds.every((candidateId) => candidateIds.has(candidateId)))
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['stageResults'],
              message: 'Survivors must be present in candidate results',
            });
          if (
            !result.survivingCandidateIds.every((candidateId) => {
              const candidate = result.candidates.find((item) => item.candidateId === candidateId);
              return candidate !== undefined && !candidate.eliminated;
            })
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['stageResults'],
              message: 'Survivors cannot be eliminated',
            });
          const expectedCandidateIds =
            stageIndex === 0
              ? value.candidates.map((candidate) => candidate.candidateId)
              : (value.stageResults[stageIndex - 1]?.survivingCandidateIds ?? []);
          const actualCandidateIds = result.candidates.map((candidate) => candidate.candidateId);
          const sortedCandidateIds = (candidateIds: string[]) =>
            [...candidateIds].sort((left, right) => left.localeCompare(right));
          const sortedExpectedCandidateIds = sortedCandidateIds(expectedCandidateIds);
          const sortedActualCandidateIds = sortedCandidateIds(actualCandidateIds);
          const candidateCollectionMatches =
            sortedExpectedCandidateIds.length === sortedActualCandidateIds.length &&
            sortedExpectedCandidateIds.every(
              (candidateId, index) => sortedActualCandidateIds[index] === candidateId,
            );
          if (!candidateCollectionMatches)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['stageResults', stageIndex, 'candidates'],
              message:
                'Selection stage candidates must equal the frozen pool or previous survivors in order',
            });
          const expectedSurvivorIds = result.candidates
            .filter((candidate) => !candidate.eliminated)
            .map((candidate) => candidate.candidateId);
          if (
            expectedSurvivorIds.length !== result.survivingCandidateIds.length ||
            expectedSurvivorIds.some(
              (candidateId, index) => result.survivingCandidateIds[index] !== candidateId,
            )
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['stageResults', stageIndex, 'survivingCandidateIds'],
              message: 'Selection survivors must preserve non-eliminated ranking order',
            });
        }
      }
      if (value.randomDraws.length > 0 && value.randomDraws.length < value.candidates.length * 6)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['randomDraws'],
          message: 'Selection randomDraws are incomplete',
        });
      if (
        value.winnerId !== null &&
        !value.candidates.some((candidate) => candidate.candidateId === value.winnerId)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winnerId'],
          message: 'Selection winner must be a candidate',
        });
      if (value.winnerId === null && value.winner !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winner'],
          message: 'Selection winner reference requires winnerId',
        });
      if (value.winnerId !== null && (value.winner === null || value.winner.id !== value.winnerId))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winner'],
          message: 'Selection winner reference must match winnerId',
        });
      if (value.status === 'completed' && value.winnerId === null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winnerId'],
          message: 'Completed Selection requires a winner',
        });
      if (value.status === 'completed') {
        if (value.stageResults?.length !== 6)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stageResults'],
            message: 'Completed Selection requires all six stages',
          });
        const final = value.stageResults?.at(-1);
        if (
          !final ||
          final.survivingCandidateIds.length !== 1 ||
          final.survivingCandidateIds[0] !== value.winnerId
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['winnerId'],
            message: 'Completed Selection winner must be the sole final survivor',
          });
      }
      if (value.status === 'completed' && value.failure !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failure'],
          message: 'Completed Selection cannot have a failure',
        });
      if (value.status === 'failed' && value.failure === null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failure'],
          message: 'Failed Selection requires a failure',
        });
      if (value.status === 'failed' && value.winnerId !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winnerId'],
          message: 'Failed Selection cannot have a winner',
        });
      if (value.status === 'active' && value.winnerId !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winnerId'],
          message: 'Active Selection cannot have a winner',
        });
      if (value.failure) {
        if (value.failure.code === 'no_qualified_candidates') {
          if (value.failure.stage !== null || value.candidates.length !== 0)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['failure'],
              message: 'No-qualified failure requires an empty candidate pool and null stage',
            });
        } else if (value.failure.stage === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['failure'],
            message: 'Stage failure requires a stage',
          });
        }
      }
      if (value.status === 'failed' && value.winnerId !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['winnerId'],
          message: 'Failed Selection cannot have a winner',
        });
      if (value.status === 'active' && value.failure !== null)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['failure'],
          message: 'Active Selection cannot have a failure',
        });
    });
  return z
    .object({
      initializedAtDay: z.number().int().nonnegative(),
      cadres: z.array(cadre),
      seats: z.array(seat),
      vacancies: z.array(vacancy),
      selections: z.array(selection),
      departures: z.array(departure),
      processedProducerKeys: z.array(z.string().min(1)),
    })
    .strict() as z.ZodType<OrganizationState>;
}
