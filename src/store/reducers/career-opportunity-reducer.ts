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
import {
  evaluateCareerOpportunityAcceptanceEligibility,
  evaluateCareerOpportunityAppointmentEligibility,
  hasRunningCareerAction,
} from '../../engine/career/career-opportunity-eligibility';
import { applyEffects } from '../../engine/events/effect-executor';
import { deriveMetricSignalsFromEffects } from '../../engine/events/metric-signal-bridge';
import { processCascadeSignalsInTransaction } from './event-reducer';
import { createRuntimeIdFactory } from '../runtime-id';
import { fillVacancyInTransaction } from '../transactions/vacancy-transaction';
import { transitionPlayerSeat } from '../transactions/organization-seat-transaction';
import {
  createRelativeSelectionInTransaction,
  getRelativeSelection,
  selectionHasPlayer,
} from '../transactions/selection-transaction';
import { appointNpcSelectionWinnerInTransaction } from '../transactions/npc-appointment-transaction';
import { advanceRelativeSelectionStage } from '../../engine/career/relative-selection-lifecycle';
import { RELATIVE_SELECTION_STAGES } from '../../domain/career/state';
import { beginVacancySelection } from '../../engine/organization/vacancy-selection-lifecycle';

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
  if (!original) return false;
  const loader = getConfigLoader();
  // Selection eligibility is frozen from the complete candidate pool at accept
  // time; a disciplinary restriction excludes the candidate, but must not block
  // creation of the auditable no-qualified Selection itself.
  const eligibilityState =
    original.type !== 'training' && original.requiresSelection
      ? {
          ...draft,
          career: {
            ...draft.career,
            // The Selection snapshot records the restriction and can therefore
            // become a structured no-qualified terminal; only bypass that one
            // player gate while accepting, preserving unrelated freezes.
            restrictions: draft.career.restrictions.filter(
              (restriction) => restriction.type !== 'disciplinary_action',
            ),
          },
        }
      : draft;
  const config = loader.getGameConfig();
  const eligibility = evaluateCareerOpportunityAcceptanceEligibility({
    opportunity: original,
    state: eligibilityState,
    currentDay,
    daysPerYear: config.daysPerMonth * config.monthsPerYear,
    targetPosition:
      original.type === 'training' ? null : loader.getPositionById(original.target.positionId),
    careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
  });
  if (!eligibility.eligible) return false;
  const result = acceptCareerOpportunity(original, currentDay);
  if (!result.success || !result.opportunity) return false;
  const transaction = structuredClone(unwrap(draft));
  replaceOpportunity(transaction, result.opportunity);
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('career');
  const processId = idFactory();
  if (result.opportunity.type !== 'training' && result.opportunity.requiresSelection) {
    const selection = createRelativeSelectionInTransaction(
      transaction,
      result.opportunity,
      processId,
      currentDay,
      idFactory,
      payload._rng ?? Math.random,
    );
    if (!selection.success) return false;
    Object.assign(draft, selection.state);
    return true;
  }
  const process: CareerProcess = {
    id: processId,
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
  // Schema 14 persists explicit nulls for processes which do not own a Selection.
  Object.assign(process, {
    selectionId: null,
    vacancyId: result.opportunity.vacancyId,
    winnerId: null,
    failure: null,
  });
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
    hasRunningCareerAction(transaction) ||
    transaction.events.activeBlockingEventId
  )
    return false;
  const config = loader.getGameConfig();
  const eligibility = evaluateCareerOpportunityAppointmentEligibility({
    opportunity,
    state: transaction,
    currentDay,
    daysPerYear: config.daysPerMonth * config.monthsPerYear,
    targetPosition: target,
    careerExperienceQualificationRules: loader.getCareerExperienceQualificationRules(),
  });
  if (!eligibility.eligible) return false;
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
    status: 'active',
    endedAtDay: null,
    endReason: null,
    probation: null,
  };
  let vacancyFilledSignals: DomainSignalSnapshot[] = [];
  if (opportunity.type === 'leadership_vacancy') {
    if (!opportunity.vacancyId) return false;
    const vacancy = transaction.organization.vacancies.find(
      (item) => item.vacancyId === opportunity.vacancyId,
    );
    if (!vacancy) return false;
    const filled = fillVacancyInTransaction(transaction, {
      vacancyId: opportunity.vacancyId,
      occupant: { type: 'player', id: 'player' },
      appointmentId,
      previousAppointmentId: previous.appointmentId,
      releasedSeatReason:
        opportunity.appointmentReason === 'lateral_transfer'
          ? 'lateral_transfer'
          : opportunity.appointmentReason === 'rotation'
            ? 'rotation'
            : 'promotion',
      selectionId: vacancy.selectionId,
      opportunityId: opportunity.id,
      currentDay,
      idFactory,
    });
    if (!filled.success) return false;
    vacancyFilledSignals = filled.emittedSignals;
  } else {
    // 非 Vacancy 任职仍沿用玩家 Seat 事务；动态岗位必须走上面的原子消费接口。
    if (
      !transitionPlayerSeat(
        transaction.organization,
        previous.appointmentId,
        transaction.career.appointment,
      )
    )
      return false;
  }
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
  if (opportunity.type !== 'leadership_vacancy') {
    const resolved = resolveCareerOpportunity(opportunity, currentDay, 'appointed').opportunity;
    if (!resolved) return false;
    replaceOpportunity(transaction, resolved);
  }
  process.status = 'completed';
  process.completedAtDay = currentDay;
  archiveCompletedProcess(transaction, process);
  for (const signal of vacancyFilledSignals) {
    orchestrateSignal(transaction, signal, currentDay, rng, idFactory);
  }
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

function appendRelativeStageResult(
  process: CareerProcess,
  stage: (typeof RELATIVE_SELECTION_STAGES)[number],
  resolvedAtDay: number,
  selection: import('../../types/organization').RelativeStaffingSelection,
): void {
  if (process.stageResults.some((result) => result.stage === stage)) return;
  const result = selection.stageResults.find((item) => item.stage === stage);
  if (!result) return;
  const player = result.candidates.find((candidate) => candidate.candidateId === 'player');
  process.stageResults.push({
    stage,
    resolvedAtDay,
    outcome: player && !player.eliminated ? 'passed' : 'failed',
    score: player?.score ?? null,
    detail: player
      ? player.eliminated
        ? `玩家在${stage}阶段淘汰（排名 ${player.rank}）`
        : `玩家在${stage}阶段保留（排名 ${player.rank}）`
      : '玩家不在本阶段候选结果中',
    candidateResults: structuredClone(result.candidates),
    survivingCandidateIds: [...result.survivingCandidateIds],
  });
}

function resolveRelativeSelectionFailure(
  transaction: PlayerSave,
  opportunity: Exclude<CareerOpportunity, { type: 'training' }>,
  process: CareerProcess,
  selection: import('../../types/organization').RelativeStaffingSelection,
  currentDay: number,
): void {
  const vacancy = transaction.organization.vacancies.find(
    (item) => item.vacancyId === selection.vacancyId,
  );
  if (vacancy && (vacancy.status === 'selecting' || vacancy.status === 'open')) {
    vacancy.status = 'open';
    vacancy.selectionId = null;
  }
  const resolved = resolveCareerOpportunity(opportunity, currentDay, 'not_selected').opportunity;
  if (resolved) replaceOpportunity(transaction, resolved);
  process.status = selection.winnerId === null ? 'failed' : 'completed';
  process.completedAtDay = currentDay;
  process.winnerId = selection.winnerId;
  process.failure = selection.failure;
  archiveCompletedProcess(transaction, process);
}

function appointRelativeSelectionNpcWinner(
  transaction: PlayerSave,
  opportunity: Exclude<CareerOpportunity, { type: 'training' }>,
  process: CareerProcess,
  selection: import('../../types/organization').RelativeStaffingSelection,
  currentDay: number,
  payload: AdvanceCareerProcessPayload,
): boolean {
  const winnerId = selection.winnerId;
  if (!winnerId || winnerId === 'player') return false;
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('career');
  const rng = payload._rng ?? Math.random;
  process.currentStage = 'appointment';
  const vacancy = transaction.organization.vacancies.find(
    (item) => item.vacancyId === selection.vacancyId,
  );
  if (!vacancy) return false;

  if (hasRunningCareerAction(transaction) || transaction.events.activeBlockingEventId) {
    // A terminal winner is frozen while appointment is blocked. Detach the
    // Vacancy so other world transactions see a legal open Seat; the process
    // keeps the completed Selection identity for deterministic rebinding.
    if (vacancy.status === 'selecting') {
      vacancy.status = 'open';
      vacancy.selectionId = null;
    }
    return true;
  }

  let boundSelection = getRelativeSelection(transaction.organization, selection.selectionId);
  if (!boundSelection) return false;
  if (vacancy.status === 'open') {
    // beginVacancySelection only accepts a live Selection. This temporary
    // state change exists solely on the transaction copy; the NPC transaction
    // below receives the canonical completed terminal Selection.
    boundSelection.status = 'active';
    const rebound = beginVacancySelection({
      organization: transaction.organization,
      currentDay,
      idFactory,
      vacancyId: vacancy.vacancyId,
      selectionId: boundSelection.selectionId,
    });
    if (!rebound.success || !rebound.vacancy) return false;
    transaction.organization = rebound.organization;
    boundSelection = getRelativeSelection(transaction.organization, selection.selectionId);
    if (!boundSelection) return false;
    boundSelection.status = 'completed';
  }

  const appointed = appointNpcSelectionWinnerInTransaction(transaction, {
    selectionId: boundSelection.selectionId,
    vacancyId: boundSelection.vacancyId,
    cadreId: winnerId,
    currentDay,
    idFactory,
  });
  if (!appointed.success) return false;
  // The NPC transaction commits by replacing the caller's top-level save;
  // reacquire nested references before archiving the player process.
  const committedProcess = transaction.career.activeProcess;
  const committedSelection = getRelativeSelection(transaction.organization, selection.selectionId);
  const committedOpportunity = transaction.career.opportunities.find(
    (item) => item.id === opportunity.id,
  );
  if (!committedProcess || !committedSelection || !committedOpportunity) return false;
  const resolved = resolveCareerOpportunity(
    committedOpportunity,
    currentDay,
    'not_selected',
  ).opportunity;
  if (!resolved) return false;
  replaceOpportunity(transaction, resolved);
  committedProcess.currentStage = 'appointment';
  committedProcess.status = 'completed';
  committedProcess.completedAtDay = currentDay;
  committedProcess.winnerId = winnerId;
  committedProcess.failure = committedSelection.failure;
  archiveCompletedProcess(transaction, committedProcess);
  // Resolve/archive before delivering vacancy.filled. The signal consumer
  // invalidates linked active processes, which must not cancel this success.
  for (const signal of appointed.emittedSignals)
    orchestrateSignal(transaction, signal, currentDay, rng, idFactory);
  return true;
}

function advanceRelativeSelectionProcess(
  draft: PlayerSave,
  opportunity: Exclude<CareerOpportunity, { type: 'training' }>,
  process: CareerProcess,
  currentDay: number,
  payload: AdvanceCareerProcessPayload,
): boolean {
  if (!process.selectionId || !process.vacancyId) return false;
  const transaction = structuredClone(unwrap(draft));
  const txProcess = transaction.career.activeProcess;
  const txOpportunity = transaction.career.opportunities.find((item) => item.id === opportunity.id);
  if (!txOpportunity || txOpportunity.type === 'training') return false;
  const selection = txProcess
    ? getRelativeSelection(transaction.organization, process.selectionId)
    : null;
  if (!txProcess || !selection || selection.vacancyId !== process.vacancyId) return false;
  if (selection.status === 'active') {
    const advanced = advanceRelativeSelectionStage({
      selection,
      resolvedAtDay: currentDay,
      rules: getConfigLoader().getRelativeSelectionConfig(),
    });
    if (!advanced.success) return false;
    let updated = advanced.selection;
    transaction.organization.selections = transaction.organization.selections.map((item) =>
      item.selectionId === updated.selectionId ? updated : item,
    );
    appendRelativeStageResult(
      txProcess,
      updated.stageResults.at(-1)?.stage ??
        (txProcess.currentStage as (typeof RELATIVE_SELECTION_STAGES)[number]),
      currentDay,
      updated,
    );
    txProcess.currentStage = updated.currentStage;
    if (updated.status === 'active' && !selectionHasPlayer(updated)) {
      // 玩家已淘汰：继续有限次数结算剩余固定阶段，避免递归和重复抽签。
      for (
        let index = updated.stageResults.length;
        index < RELATIVE_SELECTION_STAGES.length;
        index += 1
      ) {
        const continued = advanceRelativeSelectionStage({
          selection: updated,
          resolvedAtDay: currentDay,
          rules: getConfigLoader().getRelativeSelectionConfig(),
        });
        if (!continued.success) return false;
        updated = continued.selection;
        transaction.organization.selections = transaction.organization.selections.map((item) =>
          item.selectionId === updated.selectionId ? updated : item,
        );
        appendRelativeStageResult(
          txProcess,
          updated.stageResults.at(-1)?.stage ??
            (txProcess.currentStage as (typeof RELATIVE_SELECTION_STAGES)[number]),
          currentDay,
          updated,
        );
        txProcess.currentStage = updated.currentStage;
        if (updated.status !== 'active') break;
      }
    }
    const finalSelection = getRelativeSelection(transaction.organization, process.selectionId);
    if (!finalSelection) return false;
    if (finalSelection.status === 'failed') {
      resolveRelativeSelectionFailure(
        transaction,
        txOpportunity,
        txProcess,
        finalSelection,
        currentDay,
      );
      Object.assign(draft, transaction);
      return true;
    }
    if (finalSelection.status === 'completed') {
      txProcess.winnerId = finalSelection.winnerId;
      if (finalSelection.winnerId !== 'player') {
        if (
          !appointRelativeSelectionNpcWinner(
            transaction,
            txOpportunity,
            txProcess,
            finalSelection,
            currentDay,
            payload,
          )
        )
          return false;
        Object.assign(draft, transaction);
        return true;
      }
      txProcess.currentStage = 'appointment';
      if (hasRunningCareerAction(transaction) || transaction.events.activeBlockingEventId) {
        // Terminal Selection cannot remain attached to a selecting Vacancy: the
        // vacancy is reopened until the existing appointment continuation can fill it.
        const vacancy = transaction.organization.vacancies.find(
          (item) => item.vacancyId === finalSelection.vacancyId,
        );
        if (vacancy) {
          vacancy.status = 'open';
          vacancy.selectionId = null;
        }
        Object.assign(draft, transaction);
        return true;
      }
      finalSelection.status = 'active';
      if (
        !appointmentTransition(
          transaction,
          txOpportunity,
          txProcess,
          currentDay,
          payload._idFactory ?? createRuntimeIdFactory('career'),
          payload._rng ?? Math.random,
        )
      )
        return false;
      Object.assign(draft, transaction);
      return true;
    }
    Object.assign(draft, transaction);
    return true;
  }
  if (selection.status === 'completed' && selection.winnerId !== null) {
    txProcess.currentStage = 'appointment';
    if (selection.winnerId !== 'player') {
      if (
        !appointRelativeSelectionNpcWinner(
          transaction,
          txOpportunity,
          txProcess,
          selection,
          currentDay,
          payload,
        )
      )
        return false;
      Object.assign(draft, transaction);
      return true;
    }
    if (hasRunningCareerAction(transaction) || transaction.events.activeBlockingEventId)
      return false;
    selection.status = 'active';
    const vacancy = transaction.organization.vacancies.find(
      (item) => item.vacancyId === selection.vacancyId,
    );
    if (!vacancy) return false;
    if (vacancy.status === 'open') {
      const rebound = beginVacancySelection({
        organization: transaction.organization,
        currentDay,
        idFactory: payload._idFactory ?? createRuntimeIdFactory('career'),
        vacancyId: vacancy.vacancyId,
        selectionId: selection.selectionId,
      });
      if (!rebound.success || !rebound.vacancy) return false;
      transaction.organization = rebound.organization;
    }
    if (
      !appointmentTransition(
        transaction,
        txOpportunity,
        txProcess,
        currentDay,
        payload._idFactory ?? createRuntimeIdFactory('career'),
        payload._rng ?? Math.random,
      )
    )
      return false;
    Object.assign(draft, transaction);
    return true;
  }
  return false;
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
  ) {
    return false;
  }
  if (original.type !== 'training' && original.requiresSelection)
    return advanceRelativeSelectionProcess(draft, original, process, currentDay, payload);
  const settlement = { outcome: 'passed' as const, score: null, detail: '职业流程阶段已完成' };
  const outcome = settlement.outcome;
  // Only the final appointment commits a job change. Selection stages can run while
  // ordinary actions or blocking events are active; the final transition rechecks it.
  if (
    outcome === 'passed' &&
    original.type !== 'training' &&
    (!original.requiresSelection || process.currentStage === 'appointment') &&
    (hasRunningCareerAction(draft) || draft.events.activeBlockingEventId)
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
    // Effects are evaluated against the event that created the opportunity, not a
    // later assessment (and not an invented assessment for non-assessment sources).
    if (!opportunity.sourceSignal) return false;
    const applied = applyEffects(transaction, opportunity.effects, {
      signal: structuredClone(unwrap(opportunity.sourceSignal)),
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
