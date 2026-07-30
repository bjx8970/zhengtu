/**
 * 职业机会、选拔与任职 Store 事务。
 *
 * 每个入口在完整状态副本上运行；任一校验或事件编排失败均不提交草稿。
 */

import { unwrap } from 'solid-js/store';
import { getConfigLoader } from '../../config/loader';
import type { CareerOpportunity, CareerProcess } from '../../domain/career/state';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { PlayerSave } from '../../types/player';
import {
  acceptCareerOpportunity,
  cancelCareerOpportunity,
  rejectCareerOpportunity,
  resolveCareerOpportunity,
} from '../../engine/career/career-opportunity-lifecycle';
import { evaluateCondition } from '../../engine/events/condition-interpreter';
import { applyEffects } from '../../engine/events/effect-executor';
import { deriveMetricSignalsFromEffects } from '../../engine/events/metric-signal-bridge';
import { settleCareerSelectionStage } from '../../engine/career/selection-settlement';
import { processCascadeSignalsInTransaction } from './event-reducer';
import { createRuntimeIdFactory } from '../runtime-id';

export interface CareerOpportunityPayload {
  opportunityId: string;
  _idFactory?: () => string;
  _rng?: () => number;
}
export type AdvanceCareerProcessPayload = CareerOpportunityPayload;

function replaceOpportunity(draft: PlayerSave, next: CareerOpportunity): void {
  const index = draft.career.opportunities.findIndex((item) => item.id === next.id);
  if (index < 0) throw new Error(`Career opportunity ${next.id} disappeared`);
  draft.career.opportunities[index] = next;
}

function hasRunningAction(state: Readonly<PlayerSave>): boolean {
  return Object.values(state.actions.slots).some((tier) => tier.occupants.some(Boolean));
}

function hasActiveAppointmentRestriction(state: Readonly<PlayerSave>, currentDay: number): boolean {
  return state.career.restrictions.some(
    (restriction) =>
      (restriction.type === 'appointment_selection_freeze' ||
        restriction.type === 'disciplinary_action') &&
      restriction.startedAtDay <= currentDay &&
      (restriction.endsAtDay === null || currentDay < restriction.endsAtDay),
  );
}

function satisfiesConditions(
  conditions: CareerOpportunity['eligibilityConditions'],
  state: Readonly<PlayerSave>,
  currentDay: number,
): boolean {
  const config = getConfigLoader().getGameConfig();
  // Opportunity snapshots do not retain arbitrary source payloads. Reject
  // signal-dependent requirements rather than inventing data that could bypass one.
  if (conditions.some(containsSignalFieldCondition)) return false;
  const signal: DomainSignalSnapshot = {
    signalId: 'career-eligibility-recheck',
    signalType: 'assessment.completed',
    occurredAtDay: currentDay,
    data: { year: 0, score: 0, tier: '' },
  };
  return conditions.every((condition) =>
    evaluateCondition(condition, {
      state,
      signal,
      currentDay,
      daysPerYear: config.daysPerMonth * config.monthsPerYear,
    }),
  );
}

function containsSignalFieldCondition(
  condition: CareerOpportunity['eligibilityConditions'][number],
): boolean {
  if ('signalField' in condition) return true;
  if ('all' in condition) return condition.all.some(containsSignalFieldCondition);
  if ('any' in condition) return condition.any.some(containsSignalFieldCondition);
  return 'not' in condition && containsSignalFieldCondition(condition.not);
}

function isEligibleForAppointment(
  state: Readonly<PlayerSave>,
  opportunity: Exclude<CareerOpportunity, { type: 'training' }>,
  currentDay: number,
): boolean {
  const loader = getConfigLoader();
  const target = loader.getPositionById(opportunity.target.positionId);
  if (
    !target ||
    target.vacancyCount <= 0 ||
    state.career.appointment.positionId === target.id ||
    hasActiveAppointmentRestriction(state, currentDay) ||
    !satisfiesConditions(opportunity.eligibilityConditions, state, currentDay) ||
    !satisfiesConditions(target.requirements, state, currentDay)
  )
    return false;
  return (
    target.institutionId === opportunity.target.institutionId &&
    target.regionId === opportunity.target.regionId
  );
}

function archiveCompletedProcess(transaction: PlayerSave, process: CareerProcess): void {
  transaction.career.completedProcesses.push(structuredClone(process));
  transaction.career.activeProcess = null;
}

function orchestrateSignal(
  draft: PlayerSave,
  signal: DomainSignalSnapshot,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
): void {
  const loader = getConfigLoader();
  processCascadeSignalsInTransaction(
    draft,
    [signal],
    currentDay,
    rng,
    idFactory,
    loader.getAllEventDefinitions(),
  );
}

/** @param draft 状态草稿 @param payload 机会标识 @param currentDay 当前日 @returns 是否已接受。 */
export function reduceAcceptCareerOpportunity(
  draft: PlayerSave,
  payload: CareerOpportunityPayload,
  currentDay: number,
): boolean {
  const original = draft.career.opportunities.find((item) => item.id === payload.opportunityId);
  if (
    !original ||
    draft.career.activeProcess ||
    draft.events.activeBlockingEventId ||
    draft.time.pendingContinuation
  )
    return false;
  if (original.type !== 'training' && !isEligibleForAppointment(draft, original, currentDay))
    return false;
  if (
    original.type === 'training' &&
    !satisfiesConditions(original.eligibilityConditions, draft, currentDay)
  )
    return false;
  const result = acceptCareerOpportunity(original, currentDay);
  if (!result.success || !result.opportunity) return false;
  const transaction = structuredClone(unwrap(draft));
  replaceOpportunity(transaction, result.opportunity);
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('career');
  const process: CareerProcess = {
    id: idFactory(),
    type:
      result.opportunity.type === 'training'
        ? 'training'
        : result.opportunity.requiresSelection
          ? 'leadership_selection'
          : 'appointment_review',
    status: 'active',
    opportunityId: result.opportunity.id,
    currentStage: 'eligibility_review',
    startedAtDay: currentDay,
    completedAtDay: null,
    stageResults: [],
  };
  transaction.career.activeProcess = process;
  result.opportunity.status = 'in_process';
  replaceOpportunity(transaction, result.opportunity);
  Object.assign(draft, transaction);
  return true;
}

/** @param draft 状态草稿 @param payload 机会标识 @param currentDay 当前日 @returns 是否已拒绝。 */
export function reduceRejectCareerOpportunity(
  draft: PlayerSave,
  payload: CareerOpportunityPayload,
  currentDay: number,
): boolean {
  const original = draft.career.opportunities.find((item) => item.id === payload.opportunityId);
  const result = original ? rejectCareerOpportunity(original, currentDay) : null;
  if (!result?.success || !result.opportunity) return false;
  replaceOpportunity(draft, result.opportunity);
  return true;
}

/** @param draft 状态草稿 @param payload 机会标识 @param currentDay 当前日 @returns 是否已取消。 */
export function reduceCancelCareerOpportunity(
  draft: PlayerSave,
  payload: CareerOpportunityPayload,
  currentDay: number,
): boolean {
  const original = draft.career.opportunities.find((item) => item.id === payload.opportunityId);
  const result = original ? cancelCareerOpportunity(original, currentDay) : null;
  if (!result?.success || !result.opportunity) return false;
  replaceOpportunity(draft, result.opportunity);
  return true;
}

const SELECTION_STAGES = [
  'eligibility_review',
  'democratic_recommendation',
  'organization_inspection',
  'collective_decision',
  'public_notice',
  'appointment',
] as const;

function appointmentTransition(
  transaction: PlayerSave,
  opportunity: Exclude<CareerOpportunity, { type: 'training' }>,
  process: CareerProcess,
  currentDay: number,
  idFactory: () => string,
  rng: () => number,
): boolean {
  const loader = getConfigLoader();
  const target = loader.getPositionById(opportunity.target.positionId);
  const institution = target ? loader.getInstitutionById(target.institutionId) : null;
  if (
    !target ||
    !institution ||
    hasRunningAction(transaction) ||
    transaction.events.activeBlockingEventId
  )
    return false;
  if (
    target.id !== opportunity.target.positionId ||
    target.institutionId !== opportunity.target.institutionId ||
    target.regionId !== opportunity.target.regionId
  )
    return false;
  if (!isEligibleForAppointment(transaction, opportunity, currentDay)) return false;
  const openExperiences = transaction.career.experiences.filter((item) => item.endedAtDay === null);
  if (
    openExperiences.length !== 1 ||
    openExperiences[0]?.appointmentId !== transaction.career.appointment.appointmentId
  )
    return false;
  const previous = transaction.career.appointment;
  const oldExperience = openExperiences[0]!;
  oldExperience.endedAtDay = currentDay;
  oldExperience.endReason =
    opportunity.appointmentReason === 'initial_assignment'
      ? 'promotion'
      : opportunity.appointmentReason;
  const appointmentId = idFactory();
  const experienceId = idFactory();
  transaction.career.appointment = {
    appointmentId,
    positionId: target.id,
    institutionId: target.institutionId,
    regionId: target.regionId,
    institutionLevel: target.institutionLevel,
    positionDomain: target.positionDomain,
    leadershipRank: target.leadershipRank,
    startedAtDay: currentDay,
    appointmentType: opportunity.appointmentType,
    appointmentReason: opportunity.appointmentReason,
    sourceOpportunityId: opportunity.id,
    probationEndsAtDay: null,
  };
  transaction.career.experiences.push({
    id: experienceId,
    appointmentId,
    positionId: target.id,
    positionNameSnapshot: target.name,
    institutionId: institution.id,
    institutionNameSnapshot: institution.name,
    regionId: target.regionId,
    institutionLevel: target.institutionLevel,
    positionDomain: target.positionDomain,
    leadershipRank: target.leadershipRank,
    appointmentType: opportunity.appointmentType,
    appointmentReason: opportunity.appointmentReason,
    sourceOpportunityId: opportunity.id,
    startedAtDay: currentDay,
    endedAtDay: null,
    endReason: null,
    assessmentResults: [],
  });
  transaction.actions.departmentStates = Object.fromEntries(
    loader.resolvePositionDepartments(target.id).map((department) => [
      department.id,
      {
        id: department.id,
        kpiValues: {},
        monthlyConsumption: 0,
        cumulativeConsumption: 0,
        lastActionDay: currentDay,
        actionCooldownUntilDays: {},
      },
    ]),
  );
  transaction.remainingBudget = target.annualBudget;
  const resolved = resolveCareerOpportunity(opportunity, currentDay, 'appointed').opportunity;
  if (!resolved) return false;
  replaceOpportunity(transaction, resolved);
  process.status = 'completed';
  process.completedAtDay = currentDay;
  archiveCompletedProcess(transaction, process);
  orchestrateSignal(
    transaction,
    {
      signalId: idFactory(),
      signalType: 'appointment.changed',
      occurredAtDay: currentDay,
      data: {
        experienceId,
        positionId: target.id,
        institutionId: target.institutionId,
        regionId: target.regionId,
        previousPositionId: previous.positionId,
      },
    },
    currentDay,
    rng,
    idFactory,
  );
  return true;
}

/** @param draft 状态草稿 @param payload 流程推进参数 @param currentDay 当前日 @returns 是否推进成功。 */
export function reduceAdvanceCareerProcess(
  draft: PlayerSave,
  payload: AdvanceCareerProcessPayload,
  currentDay: number,
): boolean {
  const process = draft.career.activeProcess;
  const original = draft.career.opportunities.find((item) => item.id === payload.opportunityId);
  if (
    !process ||
    !original ||
    process.opportunityId !== original.id ||
    original.status !== 'in_process'
  )
    return false;
  const settlement =
    original.type !== 'training' && original.requiresSelection
      ? settleCareerSelectionStage(
          process.currentStage,
          draft,
          getConfigLoader().getGameConfig().promotion,
          payload._rng ?? Math.random,
        )
      : { outcome: 'passed' as const, score: null, detail: 'Career process stage settled' };
  const outcome = settlement.outcome;
  // Only the final appointment commits a job change. Selection stages can run while
  // ordinary actions or blocking events are active; the final transition rechecks it.
  if (
    outcome === 'passed' &&
    original.type !== 'training' &&
    (!original.requiresSelection || process.currentStage === 'appointment') &&
    (hasRunningAction(draft) || draft.events.activeBlockingEventId)
  )
    return false;
  const transaction = structuredClone(unwrap(draft));
  const txProcess = transaction.career.activeProcess!;
  const opportunity = transaction.career.opportunities.find((item) => item.id === original.id)!;
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('career');
  const rng = payload._rng ?? Math.random;
  txProcess.stageResults.push({
    stage: txProcess.currentStage,
    resolvedAtDay: currentDay,
    outcome,
    score: settlement.score,
    detail: settlement.detail,
  });
  if (outcome !== 'passed') {
    const resolved = resolveCareerOpportunity(
      opportunity,
      currentDay,
      outcome === 'continued' ? 'continued_observation' : 'not_selected',
    ).opportunity;
    if (!resolved) return false;
    replaceOpportunity(transaction, resolved);
    txProcess.status = outcome === 'continued' ? 'completed' : 'failed';
    txProcess.completedAtDay = currentDay;
    archiveCompletedProcess(transaction, txProcess);
  } else if (opportunity.type === 'training' && txProcess.currentStage === 'eligibility_review') {
    txProcess.currentStage = 'finalization';
  } else if (opportunity.type === 'training') {
    const assessment =
      transaction.assessments.annualAssessments[
        transaction.assessments.annualAssessments.length - 1
      ];
    if (!assessment) return false;
    const applied = applyEffects(transaction, opportunity.effects, {
      signal: {
        signalId: opportunity.source.signalId ?? opportunity.id,
        signalType: 'assessment.completed',
        occurredAtDay: currentDay,
        data: {
          year: assessment.year,
          score: assessment.score,
          tier: assessment.tier,
        },
      },
      currentDay,
      attributeBounds: getConfigLoader().getGameConfig().attributeBounds,
      knownInstitutionIds: new Set(
        getConfigLoader()
          .getAllInstitutions()
          .map((item) => item.id),
      ),
      knownRegionIds: new Set(
        getConfigLoader()
          .getAllInstitutions()
          .map((item) => item.regionId),
      ),
    }).applied;
    const resolved = resolveCareerOpportunity(
      opportunity,
      currentDay,
      'training_completed',
    ).opportunity;
    if (!resolved) return false;
    replaceOpportunity(transaction, resolved);
    txProcess.status = 'completed';
    txProcess.completedAtDay = currentDay;
    archiveCompletedProcess(transaction, txProcess);
    const metricSignals = deriveMetricSignalsFromEffects(
      applied,
      { currentDay, policies: transaction.governance.policies },
      idFactory,
    );
    if (metricSignals.length > 0) {
      processCascadeSignalsInTransaction(
        transaction,
        metricSignals,
        currentDay,
        rng,
        idFactory,
        getConfigLoader().getAllEventDefinitions(),
      );
    }
  } else if (opportunity.requiresSelection) {
    const index = SELECTION_STAGES.indexOf(
      txProcess.currentStage as (typeof SELECTION_STAGES)[number],
    );
    if (index < 0) return false;
    if (txProcess.currentStage === 'appointment') {
      if (!appointmentTransition(transaction, opportunity, txProcess, currentDay, idFactory, rng))
        return false;
    } else txProcess.currentStage = SELECTION_STAGES[index + 1]!;
  } else {
    if (!appointmentTransition(transaction, opportunity, txProcess, currentDay, idFactory, rng))
      return false;
  }
  Object.assign(draft, transaction);
  return true;
}
