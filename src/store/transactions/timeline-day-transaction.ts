/**
 * 单日时间轴事务执行器。
 *
 * 负责行动完成、政策到期转换、领域信号、计划事件、事件截止和周期节点；
 * 调用方负责在整个 ADVANCE_TIME 外层克隆并最终提交。
 */

import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { resolveActionEffects } from '../../engine/core/action';
import { activateScheduledEvents, expireEventInstances } from '../../engine/events/event-scheduler';
import { activatePolicy, advancePolicyPhase } from '../../engine/governance/policy-lifecycle';
import {
  selectDuePolicyActivations,
  selectDuePolicyMilestones,
} from '../../engine/governance/policy-milestone-selector';
import { monthlySettlement } from '../../engine/governance/budget';
import { calculateKPI, scoreToKPITier } from '../../engine/governance/kpi';
import {
  computeFiveDimensions,
  computeComprehensiveScore,
} from '../../engine/governance/dimensions';
import { annualAssessment as runAnnualAssessment } from '../../engine/governance/assessment';
import { decayStyleScores } from '../../engine/career/style-decay';
import type { ActionCompletionTimelineEvent } from '../../types/game';
import type {
  CompletedActionNotification,
  PlayerSave,
  TimelineContinuationNode,
} from '../../types/player';
import { getConfigLoader } from '../../config/loader';
import { clampAttr } from '../../utils/math';
import {
  advanceBlockingPointer,
  applyEventInstances,
  processCascadeSignalsInTransaction,
} from '../reducers/event-reducer';
import {
  applyPlayerAttr,
  applyStyleDelta,
  getPlayerAttr,
  setPlayerAttrDirect,
} from '../reducers/shared';
import { commitPolicyTransitionInTransaction } from './policy-transition-transaction';

/**
 * 结算当日行动与到期政策，再统一处理它们产生的领域信号。
 *
 * @param draft 可变事务状态
 * @param currentDay 当前绝对日
 * @param actionEvents 当日全部行动完成事件
 * @param rng 随机数生成器
 * @param idFactory 事务共享 ID 工厂
 * @param definitions 事件定义
 * @param notifications 行动完成通知收集器
 * @returns void
 */
export function processDailyFacts(
  draft: PlayerSave,
  currentDay: number,
  actionEvents: readonly ActionCompletionTimelineEvent[],
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
  notifications: CompletedActionNotification[],
): void {
  const signals = actionEvents.map((event) =>
    processActionCompletion(draft, event, rng, notifications, idFactory),
  );
  const activatedIds = new Set<string>();

  for (const policy of selectDuePolicyActivations(draft.governance.policies, currentDay)) {
    const index = draft.governance.policies.findIndex(
      (item) => item.instanceId === policy.instanceId,
    );
    const transition = activatePolicy({ instance: policy, currentDay, idFactory });
    const committed = commitPolicyTransitionInTransaction(
      draft,
      transition,
      index,
      currentDay,
      idFactory,
    );
    if (!committed.success) throw new Error(`Failed to activate policy "${policy.instanceId}"`);
    activatedIds.add(policy.instanceId);
    signals.push(...committed.emittedSignals);
  }

  for (const policy of selectDuePolicyMilestones(draft.governance.policies, currentDay)) {
    if (activatedIds.has(policy.instanceId)) continue;
    const index = draft.governance.policies.findIndex(
      (item) => item.instanceId === policy.instanceId,
    );
    const transition = advancePolicyPhase({ instance: policy, currentDay, idFactory });
    const committed = commitPolicyTransitionInTransaction(
      draft,
      transition,
      index,
      currentDay,
      idFactory,
    );
    if (!committed.success) throw new Error(`Failed to advance policy "${policy.instanceId}"`);
    signals.push(...committed.emittedSignals);
  }

  if (signals.length > 0) {
    processCascadeSignalsInTransaction(draft, signals, currentDay, rng, idFactory, definitions);
  }
}

/**
 * 按固定顺序执行同日剩余节点。
 *
 * @param draft 可变事务状态
 * @param nodes 待执行节点
 * @param rng 随机数生成器
 * @param idFactory 事务共享 ID 工厂
 * @param definitions 事件定义
 * @returns 是否被阻塞以及仍需持久化的节点
 */
export function processTimelineNodes(
  draft: PlayerSave,
  nodes: readonly TimelineContinuationNode[],
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): { interrupted: boolean; remainingNodes: TimelineContinuationNode[] } {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node) continue;
    switch (node.type) {
      case 'scheduled_event_activation':
        activateEventsAtDay(draft, node.absoluteDay, rng, idFactory, definitions);
        if (draft.events.activeBlockingEventId !== null) {
          // 激活器只提交到首个 blocker；其后的同日到期事件仍在 scheduled 中，
          // 因此恢复时必须重试本节点，而不能像已完整提交的年考节点那样跳过。
          return { interrupted: true, remainingNodes: nodes.slice(index) };
        }
        break;
      case 'event_deadline':
        expireEventsAtDay(draft, node.absoluteDay);
        break;
      case 'monthly_settlement':
        processMonthlySettlement(draft);
        break;
      case 'annual_assessment': {
        const signal = processAnnualAssessment(draft, node.year, node.absoluteDay, idFactory);
        processCascadeSignalsInTransaction(
          draft,
          [signal],
          node.absoluteDay,
          rng,
          idFactory,
          definitions,
        );
        if (draft.events.activeBlockingEventId !== null) {
          return { interrupted: true, remainingNodes: nodes.slice(index + 1) };
        }
        break;
      }
      case 'political_cycle':
      case 'retirement_check':
        // 当前阶段仅保证节点顺序与可恢复性；具体职业循环由 #95 接入。
        break;
    }
  }
  return { interrupted: false, remainingNodes: [] };
}

function processActionCompletion(
  draft: PlayerSave,
  event: ActionCompletionTimelineEvent,
  rng: () => number,
  notifications: CompletedActionNotification[],
  idFactory: () => string,
): DomainSignalSnapshot {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const snapshot = event.occupant.executableSnapshot;
  if (
    snapshot.department.id !== event.occupant.deptId ||
    snapshot.action.id !== event.occupant.actionId
  ) {
    throw new Error(`Action snapshot "${event.occupant.instanceId}" is inconsistent`);
  }
  const devMult = event.occupant.runtimeSnapshot?.effectivenessMultiplier ?? 1;
  const result = resolveActionEffects(snapshot.action, rng);
  const labels: string[] = [];
  for (const change of result.kpiChanges) {
    const state = draft.actions.departmentStates[event.occupant.deptId];
    if (!state) throw new Error(`Department state "${event.occupant.deptId}" not found`);
    const current = state.kpiValues[change.indicatorId] ?? 0;
    state.kpiValues[change.indicatorId] =
      change.operation === 'set'
        ? change.delta
        : change.operation === 'multiply'
          ? current * change.delta
          : current + change.delta * devMult;
    labels.push(`${change.indicatorId} ${change.operation} ${change.delta}`);
  }
  for (const change of result.playerChanges) {
    const value =
      change.operation === 'set'
        ? change.delta
        : change.operation === 'multiply'
          ? getPlayerAttr(draft, change.attr) * change.delta
          : getPlayerAttr(draft, change.attr) + change.delta * devMult;
    setPlayerAttrDirect(draft, change.attr, value, cfg.attributeBounds);
    labels.push(`${change.attr} ${change.operation} ${change.delta}`);
  }
  for (const [key, delta] of Object.entries(result.styleDeltas)) {
    applyStyleDelta(draft, key, delta);
  }
  if (event.occupant.runtimeSnapshot?.styleConflictTriggered) {
    applyPlayerAttr(draft, 'vigor', -5, cfg.attributeBounds);
    applyPlayerAttr(draft, 'ambition', -5, cfg.attributeBounds);
  }
  notifications.push({
    actionName: snapshot.action.name,
    deptName: snapshot.department.name,
    effects: labels,
    completedAtDay: event.absoluteDay,
  });
  draft.actions.slots[event.tierKey].occupants[event.slotIndex] = null;
  if (event.occupant.cooldownDays > 0) {
    const state = draft.actions.departmentStates[event.occupant.deptId];
    if (!state) throw new Error(`Department state "${event.occupant.deptId}" not found`);
    state.actionCooldownUntilDays[event.occupant.actionId] =
      event.occupant.startedAtDay + event.occupant.durationDays + event.occupant.cooldownDays;
  }
  return {
    signalId: idFactory(),
    signalType: 'action.completed',
    occurredAtDay: event.absoluteDay,
    data: {
      actionInstanceId: event.occupant.instanceId,
      actionId: event.occupant.actionId,
      deptId: event.occupant.deptId,
      institutionId: event.occupant.originInstitutionId,
      regionId: event.occupant.originRegionId,
    },
  };
}

function processMonthlySettlement(draft: PlayerSave): void {
  const loader = getConfigLoader();
  const departments = loader.resolvePositionDepartments(draft.career.appointment.positionId);
  const result = monthlySettlement(
    draft.actions.departmentStates,
    departments,
    draft.remainingBudget,
  );
  draft.remainingBudget = result.newRemaining;
  for (const [deptId, consumption] of Object.entries(result.deptConsumptions)) {
    const state = draft.actions.departmentStates[deptId];
    if (!state) continue;
    state.monthlyConsumption = consumption;
    state.cumulativeConsumption += consumption;
  }
  draft.character.philosophy.scores = decayStyleScores(
    draft.character.philosophy.scores,
    loader.getLeadershipStyleConfig(),
  );
}

function processAnnualAssessment(
  draft: PlayerSave,
  year: number,
  absoluteDay: number,
  idFactory: () => string,
): DomainSignalSnapshot {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const departments = loader.resolvePositionDepartments(draft.career.appointment.positionId);
  const indicators = departments.flatMap((department) => department.kpiIndicators);
  const kpi = calculateKPI(indicators, draft.actions.departmentStates, cfg);
  const kpiTier = scoreToKPITier(kpi.totalScore, cfg.kpiTierThresholds);
  const dimensions = computeFiveDimensions(
    {
      integrity: draft.character.integrity,
      stability: draft.character.stability,
      ambition: draft.character.ambition,
      competence: draft.character.competence,
      charisma: draft.character.charisma,
      network: draft.character.network,
      diligence: draft.character.diligence,
      vigor: draft.character.vigor,
    },
    kpi.totalScore,
    cfg,
  );
  const score = computeComprehensiveScore(dimensions, cfg);
  const yearsInPosition = Math.floor((absoluteDay - draft.career.appointment.startedAtDay) / 360);
  const annual = runAnnualAssessment(score, kpiTier, yearsInPosition, cfg);
  draft.assessments.comprehensiveScore = score;
  draft.assessments.annualAssessments.push({ year, score, tier: annual.tier, dimensions });
  if (annual.tier === '优秀') {
    draft.character.performance = clampAttr(
      'performance',
      draft.character.performance + 3,
      cfg.attributeBounds,
    );
  } else if (annual.tier === '不称职') {
    draft.character.stability = clampAttr(
      'stability',
      draft.character.stability - 5,
      cfg.attributeBounds,
    );
  }
  return {
    signalId: idFactory(),
    signalType: 'assessment.completed',
    occurredAtDay: absoluteDay,
    data: { year, score, tier: annual.tier },
  };
}

function expireEventsAtDay(draft: PlayerSave, currentDay: number): void {
  const result = expireEventInstances(draft as Readonly<PlayerSave>, currentDay);
  draft.events.history.push(...result.expiredRecords);
  const expired = new Set(result.expiredRecords.map((record) => record.instanceId));
  draft.events.pending = draft.events.pending.filter(
    (instance) => !expired.has(instance.instanceId),
  );
  for (const chain of result.chainsToUpdate) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }
  advanceBlockingPointer(draft);
}

function activateEventsAtDay(
  draft: PlayerSave,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): void {
  const activation = activateScheduledEvents(
    draft as Readonly<PlayerSave>,
    currentDay,
    rng,
    idFactory,
  );
  const blockerIndex = activation.activatedInstances.findIndex(
    (instance) => instance.snapshot.presentation === 'blocking' && instance.status === 'active',
  );
  const instances =
    blockerIndex === -1
      ? activation.activatedInstances
      : activation.activatedInstances.slice(0, blockerIndex + 1);
  const ids = new Set(instances.map((instance) => instance.instanceId));
  draft.events.scheduled = draft.events.scheduled.filter(
    (instance) => !ids.has(instance.instanceId),
  );
  // 防御早期 Schema 4 已写出的计划链节点：激活时补齐缺失的链实例。
  for (const instance of instances) {
    if (!instance.snapshot.chainId || instance.chainInstanceId) continue;
    const existing = Object.values(draft.events.chainInstances).find(
      (chain) =>
        chain.chainId === instance.snapshot.chainId && chain.sourceKey === instance.sourceKey,
    );
    const chain = existing ?? {
      instanceId: idFactory(),
      chainId: instance.snapshot.chainId,
      status: 'active' as const,
      sourceKey: instance.sourceKey,
      activeNodeIds: [],
      completedNodeIds: [],
      startedAtDay: currentDay,
      completedAtDay: null,
    };
    const nodeId = instance.snapshot.nodeId ?? instance.eventId;
    if (!chain.activeNodeIds.includes(nodeId)) chain.activeNodeIds.push(nodeId);
    draft.events.chainInstances[chain.instanceId] = chain;
    instance.chainInstanceId = chain.instanceId;
  }
  const applied = applyEventInstances(draft, instances, currentDay, rng, idFactory, definitions);
  processCascadeSignalsInTransaction(
    draft,
    applied.cascadeSignals,
    currentDay,
    rng,
    idFactory,
    definitions,
  );
}
