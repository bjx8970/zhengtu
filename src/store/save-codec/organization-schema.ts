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
    })
    .strict();
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
          })
          .strict(),
      ),
      winner: SeatOccupantRefSchema.nullable(),
      playerCareerProcessId: z.string().min(1).nullable(),
      randomDraws: z.array(z.number().min(0).max(1)),
    })
    .strict();
  return z
    .object({
      initializedAtDay: z.number().int().nonnegative(),
      cadres: z.array(cadre),
      seats: z.array(seat),
      vacancies: z.array(vacancy),
      selections: z.array(selection),
      processedProducerKeys: z.array(z.string().min(1)),
    })
    .strict() as z.ZodType<OrganizationState>;
}
