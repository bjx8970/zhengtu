/**
 * Phase 3 可枚举 producer/consumer 图、节奏与基层经济静态审计。
 *
 * 这里使用有限内容目录做保守的固定点分析，不尝试求解任意规则表达式。
 */

import type { ConditionExpression, EffectDefinition } from '../domain/conditions';
import type { EventDefinition } from '../domain/events/definition';
import type { DomainSignal } from '../domain/governance/types';
import { isCivilServiceRankAtLeast } from '../domain/career/types';
import type {
  CareerOpportunityDefinition,
  DepartmentConfig,
  PersonalTaskTemplate,
  PolicyDefinitionConfig,
} from '../types/config';
import type { Phase3AcceptanceConfig } from '../types/phase3';
import type { Phase3TaskReachabilityBound } from '../types/phase3';
import type { PositionConfigV2 } from '../types/position-v2';
import type { CivilServiceRankProgressionRule } from './schemas';

/** Phase 3 可达性静态分析所需的完整正式目录。 */
export interface Phase3ReachabilityCatalog {
  positions: readonly PositionConfigV2[];
  personalTasks: readonly PersonalTaskTemplate[];
  careerOpportunities: readonly CareerOpportunityDefinition[];
  events: readonly EventDefinition[];
  policies: readonly PolicyDefinitionConfig[];
  rankProgressionRules: readonly CivilServiceRankProgressionRule[];
  departmentsByPosition: Readonly<Record<string, readonly DepartmentConfig[]>>;
  /** 配置允许同时执行的工作槽位总数，用于计算任务完成数的时间上界。 */
  totalSlotCount: number;
}

/** 单阶段的可玩内容摘要。 */
export interface Phase3StageSummary {
  stage: keyof Phase3AcceptanceConfig['stagePositionIds'];
  positionId: string;
  personalTaskCount: number;
  actionIds: string[];
  annualBudget: number;
  annualBaseConsumption: number;
}

/** 审查和 CI 可直接展示的 Phase 3 摘要。 */
export interface Phase3ReachabilitySummary {
  formalEntrypointCount: number;
  personalTaskCount: number;
  personalTaskTypes: Record<string, number>;
  reachableEventCount: number;
  reachablePolicyCount: number;
  factProducerCount: number;
  metricProducerCount: number;
  stages: Phase3StageSummary[];
}

/** 静态可达性审计结果。 */
export interface Phase3ReachabilityReport {
  errors: string[];
  summary: Phase3ReachabilitySummary;
}

interface ResourceReferences {
  facts: Set<string>;
  metrics: Set<string>;
  eventHistory: Set<string>;
}

function emptyReferences(): ResourceReferences {
  return { facts: new Set(), metrics: new Set(), eventHistory: new Set() };
}

function collectReferences(
  condition: ConditionExpression | undefined,
  references = emptyReferences(),
): ResourceReferences {
  if (!condition) return references;
  if ('all' in condition) {
    for (const child of condition.all) collectReferences(child, references);
  } else if ('any' in condition) {
    for (const child of condition.any) collectReferences(child, references);
  } else if ('not' in condition) collectReferences(condition.not, references);
  else if ('fact' in condition) references.facts.add(condition.fact);
  else if ('worldMetric' in condition) references.metrics.add(condition.worldMetric);
  else if ('eventHistory' in condition) references.eventHistory.add(condition.eventHistory);
  return references;
}

function eventEffects(event: EventDefinition): EffectDefinition[] {
  return [
    ...event.options.flatMap((option) => option.effects),
    ...(event.automaticOutcome?.effects ?? []),
  ];
}

function eventFollowups(event: EventDefinition): string[] {
  return [
    ...event.options.flatMap((option) => option.schedule ?? []),
    ...(event.automaticOutcome?.schedule ?? []),
  ].map((followup) => followup.eventId);
}

function policyEffects(policy: PolicyDefinitionConfig): EffectDefinition[] {
  return [
    ...policy.approvalEffects,
    ...policy.phases.flatMap((phase) => [...phase.entryEffects, ...phase.completionEffects]),
  ];
}

function addEffects(
  effects: readonly EffectDefinition[],
  producer: string,
  factProducers: Map<string, Set<string>>,
  metricProducers: Map<string, Set<string>>,
): void {
  for (const effect of effects) {
    const collection =
      effect.target === 'world_fact'
        ? factProducers
        : effect.target === 'world_metric'
          ? metricProducers
          : null;
    const id =
      effect.target === 'world_fact'
        ? effect.factId
        : effect.target === 'world_metric'
          ? effect.metricId
          : null;
    if (!collection || !id) continue;
    const producers = collection.get(id) ?? new Set<string>();
    producers.add(producer);
    collection.set(id, producers);
  }
}

function equalityValues(
  condition: ConditionExpression | undefined,
  field: string,
  values = new Set<string>(),
): Set<string> {
  if (!condition) return values;
  if ('all' in condition) {
    for (const child of condition.all) equalityValues(child, field, values);
  } else if ('any' in condition) {
    for (const child of condition.any) equalityValues(child, field, values);
  } else if ('not' in condition) return values;
  else if (
    'signalField' in condition &&
    condition.signalField === field &&
    condition.op === 'eq' &&
    typeof condition.value === 'string'
  )
    values.add(condition.value);
  return values;
}

function intersectsConstraint(candidates: ReadonlySet<string>, constraints: Set<string>): boolean {
  if (constraints.size === 0) return candidates.size > 0;
  return [...constraints].some((value) => candidates.has(value));
}

function resourcesSatisfied(
  condition: ConditionExpression | undefined,
  factProducers: ReadonlyMap<string, ReadonlySet<string>>,
  metricProducers: ReadonlyMap<string, ReadonlySet<string>>,
  reachableEvents: ReadonlySet<string>,
): boolean {
  const references = collectReferences(condition);
  return (
    [...references.facts].every((id) => factProducers.has(id)) &&
    [...references.metrics].every((id) => metricProducers.has(id)) &&
    [...references.eventHistory].every((id) => reachableEvents.has(id))
  );
}

function signalCanOccur(
  signal: DomainSignal,
  condition: ConditionExpression | undefined,
  context: {
    actionIds: ReadonlySet<string>;
    taskIds: ReadonlySet<string>;
    policyIds: ReadonlySet<string>;
    eventIds: ReadonlySet<string>;
    scheduledEventIds: ReadonlySet<string>;
    metricIds: ReadonlySet<string>;
    hasAnnualAssessment: boolean;
    hasRankProgression: boolean;
    hasAppointmentOpportunity: boolean;
  },
  scheduledOnly = false,
): boolean {
  if (scheduledOnly) return context.scheduledEventIds.size > 0;
  switch (signal) {
    case 'action.completed':
      return intersectsConstraint(context.actionIds, equalityValues(condition, 'actionId'));
    case 'task.completed':
      return intersectsConstraint(context.taskIds, equalityValues(condition, 'taskId'));
    case 'assessment.completed':
      return context.hasAnnualAssessment;
    case 'policy.approved':
    case 'policy.phase_changed':
    case 'policy.metric_changed':
    case 'policy.status_changed':
      return intersectsConstraint(context.policyIds, equalityValues(condition, 'policyId'));
    case 'event.resolved':
      return intersectsConstraint(context.eventIds, equalityValues(condition, 'eventId'));
    case 'world.metric_changed':
      return intersectsConstraint(context.metricIds, equalityValues(condition, 'metricId'));
    case 'civil_service_rank.changed':
      return context.hasRankProgression;
    case 'appointment.changed':
      return context.hasAppointmentOpportunity;
  }
}

function directConjunctionLeaves(
  conditions: readonly ConditionExpression[],
): ConditionExpression[] {
  const leaves: ConditionExpression[] = [];
  for (const condition of conditions) {
    if ('all' in condition) leaves.push(...directConjunctionLeaves(condition.all));
    else if (!('any' in condition) && !('not' in condition)) leaves.push(condition);
  }
  return leaves;
}

function contradictionErrors(label: string, conditions: readonly ConditionExpression[]): string[] {
  const equalities = new Map<string, Set<string>>();
  for (const condition of directConjunctionLeaves(conditions)) {
    let key: string | null = null;
    let value: string | null = null;
    if ('signalField' in condition && condition.op === 'eq') {
      key = `signal.${condition.signalField}`;
      value = String(condition.value);
    } else if ('careerCheck' in condition && (condition.op ?? 'eq') === 'eq') {
      key = `career.${condition.careerCheck}`;
      value = String(condition.value);
    } else if ('fact' in condition && (condition.op === 'is_true' || condition.op === 'is_false')) {
      key = `fact.${condition.fact}`;
      value = condition.op;
    }
    if (!key || value === null) continue;
    const values = equalities.get(key) ?? new Set<string>();
    values.add(value);
    equalities.set(key, values);
  }
  return [...equalities.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key, values]) => `${label} has contradictory ${key} values: ${[...values].join(', ')}`);
}

function completedTaskUpperBound(catalog: Phase3ReachabilityCatalog, deadlineDay: number): number {
  const minimumDuration = Math.min(...catalog.personalTasks.map((task) => task.durationDays));
  if (!Number.isFinite(minimumDuration) || minimumDuration <= 0) return 0;
  // 使用全目录最短工期和全部槽位，刻意取宽松上界；超过它在任何玩法路径都不可能完成。
  return Math.floor(deadlineDay / minimumDuration) * catalog.totalSlotCount;
}

function taskAvailabilityErrors(
  task: PersonalTaskTemplate,
  bound: Phase3TaskReachabilityBound,
  catalog: Phase3ReachabilityCatalog,
  producedFacts: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const prerequisites = task.prerequisites;
  if (!prerequisites) return errors;
  if (
    prerequisites.allowedLeadershipRanks &&
    !prerequisites.allowedLeadershipRanks.includes(bound.leadershipRank)
  )
    errors.push(`leadership rank ${bound.leadershipRank} is not allowed`);
  if (
    prerequisites.civilServiceRankMin &&
    !isCivilServiceRankAtLeast(bound.civilServiceRank, prerequisites.civilServiceRankMin)
  )
    errors.push(
      `civil service rank ${bound.civilServiceRank} is below ${prerequisites.civilServiceRankMin}`,
    );
  const completionUpperBound = completedTaskUpperBound(catalog, bound.deadlineDay);
  if (
    prerequisites.minCompletedTasks !== undefined &&
    prerequisites.minCompletedTasks > completionUpperBound
  )
    errors.push(
      `requires ${prerequisites.minCompletedTasks} completed tasks but at most ${completionUpperBound} fit before day ${bound.deadlineDay}`,
    );
  for (const factId of prerequisites.requiredFacts ?? [])
    if (!producedFacts.has(factId))
      errors.push(`required fact ${factId} has no reachable producer`);
  return errors;
}

/**
 * 审计 Phase 3 的正式内容可达性、阶段节奏和基层预算/KPI producer。
 *
 * @param config Phase 3 验收配置
 * @param catalog 当前正式配置目录
 * @returns 可阻断 CI 的错误及审查摘要
 */
export function auditPhase3Reachability(
  config: Phase3AcceptanceConfig,
  catalog: Phase3ReachabilityCatalog,
): Phase3ReachabilityReport {
  const errors: string[] = [];
  const positions = new Map(catalog.positions.map((position) => [position.id, position]));
  const tasks = new Map(catalog.personalTasks.map((task) => [task.id, task]));
  const events = new Map(catalog.events.map((event) => [event.id, event]));
  const policies = new Map(catalog.policies.map((policy) => [policy.id, policy]));
  const opportunities = new Map(
    catalog.careerOpportunities.map((opportunity) => [opportunity.id, opportunity]),
  );
  const rankRules = new Map(catalog.rankProgressionRules.map((rule) => [rule.id, rule]));
  const stagePositions = Object.entries(config.stagePositionIds).flatMap(([stage, id]) => {
    const position = positions.get(id);
    return position ? [{ stage: stage as keyof typeof config.stagePositionIds, position }] : [];
  });
  const leadershipRanks = new Set(stagePositions.map(({ position }) => position.leadershipRank));
  const stageDepartments = stagePositions
    .filter(({ position }) => position.leadershipRank !== 'none')
    .flatMap(({ position }) => catalog.departmentsByPosition[position.id] ?? []);
  const actionIds = new Set(
    stageDepartments.flatMap((department) => department.actions.map((action) => action.id)),
  );
  const factProducers = new Map<string, Set<string>>();
  const metricProducers = new Map<string, Set<string>>();
  const reachableTasks = new Set<string>();
  const reachableEvents = new Set<string>();
  const reachablePolicies = new Set<string>();
  const scheduledEventIds = new Set<string>();
  const phase3RankRuleIds = new Set(
    config.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'rank_progression')
      .map((entrypoint) => entrypoint.contentId),
  );
  const hasAnnualAssessment = config.entrypoints.some(
    (entrypoint) =>
      entrypoint.role === 'producer' &&
      entrypoint.kind === 'timeline_node' &&
      entrypoint.contentId === 'annual_assessment',
  );
  const phaseTaskDeadline = config.milestones.townshipChiefAppointment.maxDay;

  if (hasAnnualAssessment)
    for (const rule of catalog.rankProgressionRules) {
      if (!phase3RankRuleIds.has(rule.id)) continue;
      const quota = rule.quotaRequirement;
      if (!quota || quota.annualGrant <= 0 || quota.grantAssessmentTiers.length === 0) continue;
      const producers = metricProducers.get(quota.metricId) ?? new Set<string>();
      producers.add(`annual_assessment:${rule.id}`);
      metricProducers.set(quota.metricId, producers);
    }

  const maxIterations =
    catalog.personalTasks.length + catalog.events.length + catalog.policies.length;
  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    let changed = false;
    for (const task of catalog.personalTasks) {
      if (reachableTasks.has(task.id)) continue;
      const producedFacts = new Set(factProducers.keys());
      const hasReachableRuntimeContext = [...leadershipRanks].some(
        (leadershipRank) =>
          taskAvailabilityErrors(
            task,
            {
              taskId: task.id,
              leadershipRank,
              civilServiceRank: 'section_member_4',
              deadlineDay: phaseTaskDeadline,
            },
            catalog,
            producedFacts,
          ).length === 0,
      );
      if (!hasReachableRuntimeContext) continue;
      reachableTasks.add(task.id);
      addEffects(task.effects, `personal_task:${task.id}`, factProducers, metricProducers);
      changed = true;
    }
    for (const policy of catalog.policies) {
      if (
        reachablePolicies.has(policy.id) ||
        !resourcesSatisfied(
          policy.availabilityCondition,
          factProducers,
          metricProducers,
          reachableEvents,
        )
      )
        continue;
      reachablePolicies.add(policy.id);
      addEffects(policyEffects(policy), `policy:${policy.id}`, factProducers, metricProducers);
      changed = true;
    }
    for (const eventId of reachableEvents) {
      const event = events.get(eventId);
      for (const followupId of event ? eventFollowups(event) : [])
        if (!scheduledEventIds.has(followupId)) {
          scheduledEventIds.add(followupId);
          changed = true;
        }
    }
    for (const event of catalog.events) {
      if (
        reachableEvents.has(event.id) ||
        !resourcesSatisfied(
          event.trigger.condition,
          factProducers,
          metricProducers,
          reachableEvents,
        )
      )
        continue;
      const context = {
        actionIds,
        taskIds: reachableTasks,
        policyIds: reachablePolicies,
        eventIds: reachableEvents,
        scheduledEventIds: new Set(scheduledEventIds.has(event.id) ? [event.id] : []),
        metricIds: new Set(metricProducers.keys()),
        hasAnnualAssessment,
        hasRankProgression: phase3RankRuleIds.size > 0,
        hasAppointmentOpportunity: opportunities.size > 0,
      };
      if (
        !event.trigger.sources.some((signal) =>
          signalCanOccur(
            signal,
            event.trigger.condition,
            context,
            event.trigger.scheduledOnly === true,
          ),
        )
      )
        continue;
      reachableEvents.add(event.id);
      addEffects(eventEffects(event), `event:${event.id}`, factProducers, metricProducers);
      changed = true;
    }
    if (!changed) break;
  }

  const finalProducedFacts = new Set(factProducers.keys());
  const taskBounds = new Map(config.taskReachabilityBounds.map((bound) => [bound.taskId, bound]));
  for (const bound of config.taskReachabilityBounds) {
    const task = tasks.get(bound.taskId);
    if (!task) {
      errors.push(`Phase 3 task reachability bound references unknown task ${bound.taskId}`);
      continue;
    }
    const availabilityErrors = taskAvailabilityErrors(task, bound, catalog, finalProducedFacts);
    for (const reason of availabilityErrors)
      errors.push(
        `Phase 3 task ${bound.taskId} is not reachable by day ${bound.deadlineDay}: ${reason}`,
      );
  }

  const context = {
    actionIds,
    taskIds: reachableTasks,
    policyIds: reachablePolicies,
    eventIds: reachableEvents,
    scheduledEventIds,
    metricIds: new Set(metricProducers.keys()),
    hasAnnualAssessment,
    hasRankProgression: phase3RankRuleIds.size > 0,
    hasAppointmentOpportunity: opportunities.size > 0,
  };
  const checkResources = (label: string, condition: ConditionExpression | undefined) => {
    const references = collectReferences(condition);
    for (const fact of references.facts)
      if (!factProducers.has(fact))
        errors.push(`${label} references world fact ${fact} without a reachable gameplay producer`);
    for (const metric of references.metrics)
      if (!metricProducers.has(metric))
        errors.push(
          `${label} references world metric ${metric} without a reachable gameplay producer`,
        );
    for (const eventId of references.eventHistory)
      if (!reachableEvents.has(eventId))
        errors.push(`${label} references event history ${eventId} without a reachable event`);
  };

  for (const entrypoint of config.entrypoints) {
    const label = `Phase 3 ${entrypoint.role} ${entrypoint.kind} ${entrypoint.contentId}`;
    if (entrypoint.kind === 'personal_task') {
      if (!taskBounds.has(entrypoint.contentId))
        errors.push(`${label} has no bounded runtime availability context`);
      if (!reachableTasks.has(entrypoint.contentId))
        errors.push(`${label} is not reachable by a stage player`);
    }
    if (entrypoint.kind === 'department_action' && !actionIds.has(entrypoint.contentId))
      errors.push(`${label} is not available to a stage position`);
    if (entrypoint.kind === 'event') {
      const event = events.get(entrypoint.contentId);
      if (!reachableEvents.has(entrypoint.contentId))
        errors.push(`${label} has no reachable trigger`);
      if (event) {
        checkResources(label, event.trigger.condition);
        errors.push(
          ...contradictionErrors(label, event.trigger.condition ? [event.trigger.condition] : []),
        );
      }
    }
    if (entrypoint.kind === 'policy') {
      const policy = policies.get(entrypoint.contentId);
      if (!reachablePolicies.has(entrypoint.contentId))
        errors.push(`${label} has no reachable availability path`);
      if (policy) checkResources(label, policy.availabilityCondition);
    }
    if (entrypoint.kind === 'rank_progression') {
      const rule = rankRules.get(entrypoint.contentId);
      const quota = rule?.quotaRequirement;
      if (!quota || !metricProducers.has(quota.metricId))
        errors.push(`${label} has no annual assessment quota producer`);
      if (rule) {
        for (const condition of rule.additionalConditions) checkResources(label, condition);
        errors.push(...contradictionErrors(label, rule.additionalConditions));
      }
    }
    if (entrypoint.kind === 'career_opportunity') {
      const opportunity = opportunities.get(entrypoint.contentId);
      if (!opportunity) continue;
      const conditions = [...opportunity.conditions, ...(opportunity.acceptanceConditions ?? [])];
      for (const condition of conditions) checkResources(label, condition);
      errors.push(...contradictionErrors(label, conditions));
      if (
        !opportunity.triggerSignals.some((signal) =>
          signalCanOccur(signal, { all: opportunity.conditions }, context),
        )
      )
        errors.push(`${label} has no reachable trigger signal`);
    }
  }

  const expectedTargets = new Map([
    ['township_deputy_leadership_vacancy', config.stagePositionIds.townshipDeputy],
    ['township_chief_leadership_vacancy', config.stagePositionIds.townshipChief],
  ]);
  for (const [opportunityId, positionId] of expectedTargets) {
    const opportunity = opportunities.get(opportunityId);
    if (opportunity?.type !== 'training' && opportunity?.targetPositionId !== positionId)
      errors.push(
        `Phase 3 opportunity ${opportunityId} targets ${opportunity?.targetPositionId ?? 'nothing'} instead of ${positionId}`,
      );
  }

  for (const { stage, position } of stagePositions) {
    const departments = catalog.departmentsByPosition[position.id] ?? [];
    const annualBaseConsumption = departments.reduce(
      (sum, department) =>
        sum + department.baseConsumption * department.consumptionCoefficient * 12,
      0,
    );
    if (position.leadershipRank !== 'none' && annualBaseConsumption > position.annualBudget)
      errors.push(
        `Phase 3 stage ${stage} annual base consumption ${annualBaseConsumption} exceeds budget ${position.annualBudget}`,
      );
    if (position.leadershipRank === 'none') continue;
    const positiveKpis = departments.flatMap((department) =>
      department.kpiIndicators
        .filter((indicator) => indicator.calcType !== 'inverse')
        .map((indicator) => ({ department, indicator })),
    );
    for (const { department, indicator } of positiveKpis)
      if (
        !department.actions.some((action) =>
          action.effects.some((effect) => effect.target === `dept.kpi.${indicator.id}`),
        )
      )
        errors.push(
          `Phase 3 stage ${stage} KPI ${indicator.id} has no action producer in department ${department.id}`,
        );
    const allPositiveIds = new Set(positiveKpis.map(({ indicator }) => indicator.id));
    for (const action of departments.flatMap((department) => department.actions)) {
      const covered = new Set(
        action.effects
          .map((effect) => effect.target.replace(/^dept\.kpi\./, ''))
          .filter((id) => allPositiveIds.has(id)),
      );
      if (allPositiveIds.size > 1 && covered.size === allPositiveIds.size)
        errors.push(
          `Phase 3 stage ${stage} action ${action.id} can solve every positive KPI alone`,
        );
    }
  }

  const milestones = config.milestones;
  const orderedMilestones: Array<[string, number]> = [
    ['probationPassed', milestones.probationPassed.minDay],
    ['firstRankPromotion', milestones.firstRankPromotion.minDay],
    ['townshipDeputyOpportunity', milestones.townshipDeputyOpportunity.minDay],
    ['townshipDeputyAppointment', milestones.townshipDeputyAppointment.minDay],
    ['townshipDeputyGovernance', milestones.townshipDeputyGovernance.minDay],
    ['sectionMember4Promotion', milestones.sectionMember4Promotion.minDay],
    ['townshipChiefOpportunity', milestones.townshipChiefOpportunity.minDay],
    ['townshipChiefAppointment', milestones.townshipChiefAppointment.minDay],
  ];
  for (let index = 1; index < orderedMilestones.length; index++) {
    const previous = orderedMilestones[index - 1];
    const current = orderedMilestones[index];
    if (previous && current && current[1] < previous[1])
      errors.push(`Phase 3 milestone ${current[0]} occurs before ${previous[0]}`);
  }
  if (
    milestones.townshipChiefAppointment.minDay - milestones.townshipDeputyAppointment.minDay <
    360
  )
    errors.push('Phase 3 township leadership stages can be crossed in less than one year');

  const personalTaskTypes: Record<string, number> = {};
  for (const taskId of reachableTasks) {
    const type = tasks.get(taskId)?.type;
    if (type) personalTaskTypes[type] = (personalTaskTypes[type] ?? 0) + 1;
  }
  const stages: Phase3StageSummary[] = stagePositions.map(({ stage, position }) => {
    const departments = catalog.departmentsByPosition[position.id] ?? [];
    return {
      stage,
      positionId: position.id,
      personalTaskCount: [...reachableTasks].filter((taskId) => {
        const allowed = tasks.get(taskId)?.prerequisites?.allowedLeadershipRanks;
        return !allowed || allowed.includes(position.leadershipRank);
      }).length,
      actionIds:
        position.leadershipRank === 'none'
          ? []
          : [
              ...new Set(
                departments.flatMap((department) => department.actions.map((action) => action.id)),
              ),
            ],
      annualBudget: position.annualBudget,
      annualBaseConsumption:
        position.leadershipRank === 'none'
          ? 0
          : departments.reduce(
              (sum, department) =>
                sum + department.baseConsumption * department.consumptionCoefficient * 12,
              0,
            ),
    };
  });
  return {
    errors: [...new Set(errors)],
    summary: {
      formalEntrypointCount: config.entrypoints.length,
      personalTaskCount: reachableTasks.size,
      personalTaskTypes,
      reachableEventCount: reachableEvents.size,
      reachablePolicyCount: reachablePolicies.size,
      factProducerCount: factProducers.size,
      metricProducerCount: metricProducers.size,
      stages,
    },
  };
}
