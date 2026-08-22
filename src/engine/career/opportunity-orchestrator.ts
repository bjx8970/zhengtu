/**
 * 领域信号驱动的职业机会生成器。
 *
 * 引擎只生成冻结快照和诊断；状态提交由 Store 事务负责。
 */

import type { CareerOpportunity, CareerOpportunitySource } from '../../domain/career/state';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { PlayerSave } from '../../types/player';
import type {
  CareerExperienceQualificationRules,
  CareerOpportunityDefinition,
} from '../../types/config';
import type { InstitutionConfig, PositionConfigV2 } from '../../types/position-v2';
import { evaluateCondition } from '../events/condition-interpreter';

/** 机会生成输入。 */
export interface ProcessCareerOpportunitySignalParams {
  state: Readonly<PlayerSave>;
  signal: DomainSignalSnapshot;
  currentDay: number;
  definitions: readonly CareerOpportunityDefinition[];
  positions: readonly PositionConfigV2[];
  institutions: readonly InstitutionConfig[];
  daysPerYear: number;
  careerExperienceQualificationRules?: Readonly<CareerExperienceQualificationRules>;
  idFactory: () => string;
}

/** 机会生成结果。 */
export interface CareerOpportunityGenerationResult {
  created: CareerOpportunity[];
  skipped: { definitionId: string; reason: string }[];
}

/**
 * 派生机会去重所用的稳定来源实体键。
 *
 * signalId 仅标识一次投递；存档恢复或同一实体后续信号会得到新的 signalId，
 * 因此不能用于 once_per_source。对没有实例 ID 的世界指标，指标本身是最稳定的实体。
 *
 * @param signal 触发机会生成的领域信号
 * @returns 稳定的来源实体键
 */
export function deriveCareerOpportunitySourceKey(signal: DomainSignalSnapshot): string {
  switch (signal.signalType) {
    case 'action.completed':
      return `action:${signal.data.actionInstanceId}`;
    case 'task.completed':
      return `task:${signal.data.taskInstanceId}`;
    case 'assessment.completed':
      return `assessment:${signal.data.year}`;
    case 'policy.approved':
    case 'policy.phase_changed':
    case 'policy.metric_changed':
    case 'policy.status_changed':
      return `policy:${signal.data.policyInstanceId}`;
    case 'event.resolved':
      return `event:${signal.data.eventInstanceId}`;
    case 'appointment.changed':
      return `appointment:${signal.data.experienceId}`;
    case 'civil_service_rank.changed':
      return `rank:${signal.data.rankChangeId}`;
    case 'world.metric_changed':
      return `world_metric:${signal.data.metricId}`;
  }
}

function sourceFor(signal: DomainSignalSnapshot): CareerOpportunitySource {
  const sourceType = signal.signalType.startsWith('assessment')
    ? 'assessment'
    : signal.signalType.startsWith('policy')
      ? 'policy'
      : signal.signalType.startsWith('event')
        ? 'event'
        : 'system';
  return {
    sourceType,
    sourceId: deriveCareerOpportunitySourceKey(signal),
    signalId: signal.signalId,
    description: signal.signalType,
  };
}

function hasOpportunity(
  state: Readonly<PlayerSave>,
  definitionId: string,
  predicate: (opportunity: CareerOpportunity) => boolean,
): boolean {
  return state.career.opportunities.some(
    (opportunity) => opportunity.definitionId === definitionId && predicate(opportunity),
  );
}

function hasNonTerminalOpportunity(state: Readonly<PlayerSave>, definitionId: string): boolean {
  return hasOpportunity(
    state,
    definitionId,
    (opportunity) =>
      opportunity.status === 'available' ||
      opportunity.status === 'accepted' ||
      opportunity.status === 'in_process',
  );
}

/**
 * 根据单个领域信号生成可用机会。
 *
 * @param params 信号、配置和注入依赖
 * @returns 新机会及跳过诊断
 */
export function processCareerOpportunitySignal(
  params: ProcessCareerOpportunitySignalParams,
): CareerOpportunityGenerationResult {
  const created: CareerOpportunity[] = [];
  const skipped: CareerOpportunityGenerationResult['skipped'] = [];
  for (const definition of params.definitions) {
    if (!definition.triggerSignals.includes(params.signal.signalType)) continue;
    const source = sourceFor(params.signal);
    if (
      !definition.conditions.every((condition) =>
        evaluateCondition(condition, {
          state: params.state,
          signal: params.signal,
          currentDay: params.currentDay,
          daysPerYear: params.daysPerYear,
          careerExperienceQualificationRules: params.careerExperienceQualificationRules,
        }),
      )
    ) {
      skipped.push({ definitionId: definition.id, reason: 'condition_failed' });
      continue;
    }
    // A definition represents one actionable process at a time. This remains true
    // for repeatable definitions with a zero-day cooldown, which may recur only
    // after the prior opportunity reaches a terminal state.
    if (hasNonTerminalOpportunity(params.state, definition.id)) {
      skipped.push({ definitionId: definition.id, reason: 'duplicate' });
      continue;
    }
    if (
      definition.repeatPolicy === 'once' &&
      hasOpportunity(params.state, definition.id, () => true)
    ) {
      skipped.push({ definitionId: definition.id, reason: 'duplicate' });
      continue;
    }
    if (
      definition.repeatPolicy === 'once_per_source' &&
      hasOpportunity(
        params.state,
        definition.id,
        (opportunity) => opportunity.source.sourceId === source.sourceId,
      )
    ) {
      skipped.push({ definitionId: definition.id, reason: 'duplicate' });
      continue;
    }
    if (definition.repeatPolicy === 'repeatable' && definition.cooldownDays > 0) {
      const latestAppearance = params.state.career.opportunities
        .filter((opportunity) => opportunity.definitionId === definition.id)
        .reduce<number | null>(
          (latest, opportunity) =>
            Math.max(latest ?? opportunity.appearedAtDay, opportunity.appearedAtDay),
          null,
        );
      if (
        latestAppearance !== null &&
        params.currentDay < latestAppearance + definition.cooldownDays
      ) {
        skipped.push({ definitionId: definition.id, reason: 'cooldown' });
        continue;
      }
    }
    const base = {
      id: params.idFactory(),
      definitionId: definition.id,
      status: 'available' as const,
      source,
      sourceSignal: structuredClone(params.signal),
      appearedAtDay: params.currentDay,
      expiresAtDay:
        definition.expiresAfterDays === null
          ? null
          : params.currentDay + definition.expiresAfterDays,
      acceptedAtDay: null,
      rejectedAtDay: null,
      resolvedAtDay: null,
      cancelledAtDay: null,
      requiresSelection: definition.requiresSelection,
      // Generation-only checks may include the assessment signal. Acceptance checks
      // are appended to the durable snapshot so later revalidation cannot drift with config.
      eligibilityConditions: structuredClone([
        ...definition.conditions,
        ...(definition.acceptanceConditions ?? []),
      ]),
      finalOutcome: null,
      reason: definition.reasonTemplate,
    };
    if (definition.type === 'training') {
      created.push({
        ...base,
        type: 'training',
        target: null,
        appointmentType: null,
        appointmentReason: null,
        trainingDefinitionId: definition.trainingDefinitionId,
        effects: structuredClone(definition.effects),
      });
      continue;
    }
    const position = params.positions.find((item) => item.id === definition.targetPositionId);
    const institution = position
      ? params.institutions.find((item) => item.id === position.institutionId)
      : null;
    if (
      !position ||
      !institution ||
      (definition.type === 'leadership_vacancy' && position.vacancyCount <= 0)
    ) {
      skipped.push({
        definitionId: definition.id,
        reason: !position || !institution ? 'target_not_found' : 'vacancy_unavailable',
      });
      continue;
    }
    created.push({
      ...base,
      type: definition.type,
      appointmentType: definition.appointmentType,
      appointmentReason: definition.appointmentReason,
      target: {
        positionId: position.id,
        positionName: position.name,
        institutionId: institution.id,
        institutionName: institution.name,
        regionId: position.regionId,
        institutionLevel: position.institutionLevel,
        positionDomain: position.positionDomain,
        leadershipRank: position.leadershipRank,
      },
    });
  }
  return { created, skipped };
}
