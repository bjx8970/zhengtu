/**
 * 领域信号驱动的职业机会生成器。
 *
 * 引擎只生成冻结快照和诊断；状态提交由 Store 事务负责。
 */

import type { CareerOpportunity, CareerOpportunitySource } from '../../domain/career/state';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { PlayerSave } from '../../types/player';
import type { CareerOpportunityDefinition } from '../../types/config';
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
  idFactory: () => string;
}

/** 机会生成结果。 */
export interface CareerOpportunityGenerationResult {
  created: CareerOpportunity[];
  skipped: { definitionId: string; reason: string }[];
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
    sourceId: signal.signalId,
    signalId: signal.signalId,
    description: signal.signalType,
  };
}

function hasOpenDuplicate(
  state: Readonly<PlayerSave>,
  definitionId: string,
  sourceId: string,
): boolean {
  return state.career.opportunities.some(
    (opportunity) =>
      opportunity.definitionId === definitionId &&
      opportunity.source.sourceId === sourceId &&
      !['rejected', 'expired', 'resolved', 'cancelled'].includes(opportunity.status),
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
    if (
      !definition.conditions.every((condition) =>
        evaluateCondition(condition, {
          state: params.state,
          signal: params.signal,
          currentDay: params.currentDay,
          daysPerYear: params.daysPerYear,
        }),
      )
    ) {
      skipped.push({ definitionId: definition.id, reason: 'condition_failed' });
      continue;
    }
    if (
      definition.repeatPolicy === 'once' &&
      params.state.career.opportunities.some((item) => item.definitionId === definition.id)
    ) {
      skipped.push({ definitionId: definition.id, reason: 'duplicate' });
      continue;
    }
    if (hasOpenDuplicate(params.state, definition.id, params.signal.signalId)) {
      skipped.push({ definitionId: definition.id, reason: 'duplicate' });
      continue;
    }
    const source = sourceFor(params.signal);
    const base = {
      id: params.idFactory(),
      definitionId: definition.id,
      status: 'available' as const,
      source,
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
      eligibilityConditions: structuredClone(definition.conditions),
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
