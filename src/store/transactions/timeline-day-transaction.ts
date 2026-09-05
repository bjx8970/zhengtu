/**
 * 单日时间轴事务执行器。
 *
 * 负责行动完成、政策到期转换、领域信号、计划事件、事件截止和周期节点；
 * 调用方负责在整个 ADVANCE_TIME 外层克隆并最终提交。
 */

import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { resolveActionEffects } from '../../engine/core/action';
import {
  applyPersonalTaskKpiEffects,
  isPersonalTaskOccupant,
} from '../../engine/tasks/personal-task';
import { applyEffects } from '../../engine/events/effect-executor';
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
import { computeCorruptionReport } from '../../engine/governance/corruption-report';
import { computeFloodRiskMonthDelta } from '../../engine/world/flood-risk';
import { decayStyleScores } from '../../engine/career/style-decay';
import type { ActionCompletionTimelineEvent } from '../../types/game';
import type {
  CompletedActionNotification,
  PersonalTaskExecutableSnapshot,
  PlayerSave,
  TimelineContinuationNode,
} from '../../types/player';
import { getConfigLoader } from '../../config/loader';
import { clampAttr } from '../../utils/math';
import { releasePlayerSeat } from './organization-seat-transaction';
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
import { expireCareerOpportunity } from '../../engine/career/career-opportunity-lifecycle';
import { evaluateProbation } from '../../engine/career/probation-evaluation';
import { grantAnnualCivilServiceRankQuota } from '../../engine/career/rank-quota';
import { settleNpcLifecycle } from '../../engine/organization/npc-lifecycle';
import {
  consumeCadreDeparturesInTransaction,
  producePoliticalCycleVacanciesInTransaction,
} from './vacancy-transaction';
import {
  advancePoliticalCycles,
  createPoliticalCycle,
} from '../../engine/organization/political-cycle';

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
 * @returns 是否被阻塞/终止，以及仍需持久化的节点
 */
export function processTimelineNodes(
  draft: PlayerSave,
  nodes: readonly TimelineContinuationNode[],
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): { interrupted: boolean; terminal: boolean; remainingNodes: TimelineContinuationNode[] } {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node) continue;
    switch (node.type) {
      case 'probation_evaluation':
        processProbationEvaluation(draft, node.absoluteDay);
        if (draft.career.appointment.probation?.status === 'failed')
          return { interrupted: false, terminal: true, remainingNodes: [] };
        break;
      case 'career_opportunity_expiry':
        expireCareerOpportunitiesAtDay(draft, node.absoluteDay);
        break;
      case 'scheduled_event_activation':
        activateEventsAtDay(draft, node.absoluteDay, rng, idFactory, definitions);
        // 截止处理必须与计划激活同属一个不可分割节点；否则 blocker 会让刚刚
        // 越过截止日的旧 pending 实例滞留到下一次 ADVANCE_TIME。
        expireEventsAtDay(draft, node.absoluteDay);
        if (draft.events.activeBlockingEventId !== null) {
          const hasRemainingDueEvent = draft.events.scheduled.some(
            (event) => event.activateAtDay <= node.absoluteDay,
          );
          // 激活器只提交到首个 blocker；仅当其后仍有同日到期事件时才保留本节点。
          // 已完整提交的节点必须跳过，避免恢复时重复无效编排。
          return {
            interrupted: true,
            terminal: false,
            remainingNodes: nodes.slice(hasRemainingDueEvent ? index : index + 1),
          };
        }
        break;
      case 'event_deadline':
        expireEventsAtDay(draft, node.absoluteDay);
        break;
      case 'monthly_settlement': {
        const monthlySignal = processMonthlySettlement(
          draft,
          node.month,
          node.absoluteDay,
          idFactory,
        );
        if (monthlySignal) {
          processCascadeSignalsInTransaction(
            draft,
            [monthlySignal],
            node.absoluteDay,
            rng,
            idFactory,
            definitions,
          );
          if (draft.events.activeBlockingEventId !== null) {
            return {
              interrupted: true,
              terminal: false,
              remainingNodes: nodes.slice(index + 1),
            };
          }
        }
        break;
      }
      case 'annual_assessment': {
        const producerKey = `npc-annual:${node.year}`;
        if (!draft.organization.processedProducerKeys.includes(producerKey)) {
          const npcSettlement = settleNpcLifecycle({
            organization: draft.organization,
            currentDay: node.absoluteDay,
            currentYear: node.year,
            daysPerYear:
              getConfigLoader().getGameConfig().daysPerMonth *
              getConfigLoader().getGameConfig().monthsPerYear,
            config: getConfigLoader().getGameConfig().npcLifecycle,
            rankProgressionRules: getConfigLoader().getAllCivilServiceRankProgressionRules(),
            rng,
          });
          draft.organization = npcSettlement.organization;
          draft.organization.processedProducerKeys.push(producerKey);
        }
        // 年度玩家事实先完整落盘；随后消费 departure ledger。两者的信号必须合并到
        // 一次 cascade，避免 Vacancy blocker 让 annual node 中途恢复而重复生产。
        const signals = processAnnualAssessment(draft, node.year, node.absoluteDay, idFactory);
        const vacancyProduction = consumeCadreDeparturesInTransaction(
          draft,
          node.absoluteDay,
          idFactory,
        );
        if (!vacancyProduction.success)
          throw new Error(
            `Vacancy producer failed (${vacancyProduction.error}): ${vacancyProduction.detail}`,
          );
        signals.push(...vacancyProduction.emittedSignals);
        processCascadeSignalsInTransaction(
          draft,
          signals,
          node.absoluteDay,
          rng,
          idFactory,
          definitions,
        );
        if (draft.events.activeBlockingEventId !== null) {
          return {
            interrupted: true,
            terminal: false,
            remainingNodes: nodes.slice(index + 1),
          };
        }
        break;
      }
      case 'political_cycle':
        processPoliticalCycle(draft, node.absoluteDay, rng, idFactory, definitions);
        if (draft.events.activeBlockingEventId !== null) {
          return {
            interrupted: true,
            terminal: false,
            remainingNodes: nodes.slice(index + 1),
          };
        }
        break;
      case 'retirement_check':
        // NPC 退休已在同年 annual_assessment 内结算；保留该兼容节点为无副作用占位，
        // 避免旧存档 continuation 改变顺序，也避免未来重复关闭任职。
        break;
    }
  }
  return { interrupted: false, terminal: false, remainingNodes: [] };
}

/**
 * 提交政治周期的阶段推进与届期评估。
 *
 * 首届在 congress 节点创建，此后每日推进并在届期边界连续创建下一届，
 * 因而 continuation 重放不会重复创建周期事实。
 *
 * @param draft 完整存档事务草稿
 * @param currentDay 当前绝对日
 * @param rng 事件信号处理使用的随机源
 * @param idFactory 事务共享的稳定 ID 工厂
 * @param definitions 事件定义目录
 * @returns void
 */
export function processPoliticalCycle(
  draft: PlayerSave,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
): void {
  const config = getConfigLoader().getGameConfig();
  let latest = draft.world.activeCycles
    .filter((cycle) => cycle.type === 'party_congress')
    .reduce<(typeof draft.world.activeCycles)[number] | undefined>(
      (previous, cycle) => (!previous || cycle.termNumber > previous.termNumber ? cycle : previous),
      undefined,
    );
  const cycleDays =
    Math.max(1, config.congressCycleYears) * config.daysPerMonth * config.monthsPerYear;
  // 使用上一届的结束日衔接，既覆盖等号边界，也补齐旧存档已经错过的届期。
  while (!latest || latest.endsAtDay <= currentDay) {
    const startedAtDay = latest?.endsAtDay ?? currentDay;
    latest = createPoliticalCycle(
      'party_congress',
      (latest?.termNumber ?? 0) + 1,
      startedAtDay,
      startedAtDay + cycleDays,
    );
    draft.world.activeCycles.push(latest);
  }
  const advanced = advancePoliticalCycles(
    draft.world,
    currentDay,
    config.politicalCyclePhaseDurations,
  );
  draft.world.activeCycles = advanced.world.activeCycles;
  const completedCycles = advanced.evaluations.filter(
    (evaluation) =>
      evaluation.completed &&
      !draft.organization.processedProducerKeys.includes(
        `political-cycle:${evaluation.cycle.type}:${evaluation.cycle.termNumber}`,
      ),
  );
  for (const evaluation of completedCycles) {
    const seatIds = draft.organization.seats
      .filter(
        (seat) =>
          seat.occupant === null &&
          seat.currentAppointmentId === null &&
          seat.occupiedAtDay === null &&
          !draft.organization.vacancies.some(
            (vacancy) =>
              vacancy.seatId === seat.seatId &&
              (vacancy.status === 'open' || vacancy.status === 'selecting'),
          ),
      )
      .map((seat) => seat.seatId);
    const produced = producePoliticalCycleVacanciesInTransaction(
      draft,
      { cycle: evaluation.cycle, seatIds },
      idFactory,
    );
    if (!produced.success)
      throw new Error(
        `Political cycle Vacancy producer failed (${produced.error}): ${produced.detail}`,
      );
    draft.organization.processedProducerKeys.push(
      `political-cycle:${evaluation.cycle.type}:${evaluation.cycle.termNumber}`,
    );
    if (produced.emittedSignals.length > 0) {
      processCascadeSignalsInTransaction(
        draft,
        produced.emittedSignals,
        currentDay,
        rng,
        idFactory,
        definitions,
      );
    }
  }
}

function processProbationEvaluation(draft: PlayerSave, currentDay: number): void {
  const probation = draft.career.appointment.probation;
  const result = evaluateProbation({
    currentDay,
    probation,
    attributes: {
      competence: draft.character.competence,
      diligence: draft.character.diligence,
      integrity: draft.character.integrity,
      stability: draft.character.stability,
    },
    restrictions: draft.career.restrictions,
    config: getConfigLoader().getGameConfig().probation,
  });
  if (!result.success) {
    if (result.failure === 'not_active' || result.failure === 'not_due') return;
    throw new Error(`Probation evaluation failed safely: ${result.failure}`);
  }
  draft.career.appointment.probation = result.probation;
  if (result.outcome !== 'failed') return;
  const openExperiences = draft.career.experiences.filter(
    (experience) => experience.endedAtDay === null,
  );
  if (
    openExperiences.length !== 1 ||
    openExperiences[0]?.appointmentId !== draft.career.appointment.appointmentId
  )
    throw new Error('Probation failure cannot close an inconsistent appointment experience');
  if (!releasePlayerSeat(draft.organization, draft.career.appointment.appointmentId))
    throw new Error('Probation failure cannot release the player organization seat');
  openExperiences[0].endedAtDay = currentDay;
  openExperiences[0].endReason = 'probation_failed';
  draft.career.appointment.status = 'ended';
  draft.career.appointment.endedAtDay = currentDay;
  draft.career.appointment.endReason = 'probation_failed';
}

function expireCareerOpportunitiesAtDay(draft: PlayerSave, currentDay: number): void {
  const due = draft.career.opportunities
    .filter(
      (opportunity) =>
        opportunity.status === 'available' &&
        opportunity.expiresAtDay !== null &&
        opportunity.expiresAtDay <= currentDay,
    )
    .sort(
      (left, right) => left.expiresAtDay! - right.expiresAtDay! || left.id.localeCompare(right.id),
    );
  for (const opportunity of due) {
    const result = expireCareerOpportunity(opportunity, currentDay);
    if (!result.success || !result.opportunity) continue;
    const index = draft.career.opportunities.findIndex((item) => item.id === opportunity.id);
    if (index >= 0) draft.career.opportunities[index] = result.opportunity;
  }
}

function processActionCompletion(
  draft: PlayerSave,
  event: ActionCompletionTimelineEvent,
  rng: () => number,
  notifications: CompletedActionNotification[],
  idFactory: () => string,
): DomainSignalSnapshot {
  if (isPersonalTaskOccupant(event.occupant)) {
    return processPersonalTaskCompletion(draft, event, notifications, idFactory);
  }
  const snapshot = event.occupant.executableSnapshot;
  if (!('action' in snapshot)) {
    throw new Error(`Action snapshot "${event.occupant.instanceId}" is inconsistent`);
  }
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
    setPlayerAttrDirect(draft, change.attr, value, snapshot.attributeBounds);
    labels.push(`${change.attr} ${change.operation} ${change.delta}`);
  }
  for (const [key, delta] of Object.entries(result.styleDeltas)) {
    applyStyleDelta(draft, key, delta);
  }
  if (event.occupant.runtimeSnapshot?.styleConflictTriggered) {
    applyPlayerAttr(draft, 'vigor', -5, snapshot.attributeBounds);
    applyPlayerAttr(draft, 'ambition', -5, snapshot.attributeBounds);
  }
  notifications.push({
    actionName: snapshot.action.name,
    deptName: snapshot.department.name,
    effects: labels,
    completedAtDay: event.absoluteDay,
  });
  incrementProbationCompletedActions(draft, event.occupant, event.absoluteDay);
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

/**
 * 结算到期的个人任务：统一效果通道 + KPI 隐藏台账 + task.completed 信号。
 *
 * 效果经 applyEffects 两阶段原子执行（任一目标非法即抛错回滚整个时间推进），
 * 信号先于效果构建以充当 EffectExecutionContext.signal。
 */
function processPersonalTaskCompletion(
  draft: PlayerSave,
  event: ActionCompletionTimelineEvent,
  notifications: CompletedActionNotification[],
  idFactory: () => string,
): DomainSignalSnapshot {
  const snapshot = event.occupant.executableSnapshot as PersonalTaskExecutableSnapshot;
  const task = snapshot.task;
  if (
    snapshot.department.id !== event.occupant.deptId ||
    task.id !== event.occupant.actionId ||
    task.name !== event.occupant.actionName ||
    task.durationDays !== event.occupant.durationDays ||
    task.cooldownDays !== event.occupant.cooldownDays
  ) {
    throw new Error(`Task snapshot "${event.occupant.instanceId}" is inconsistent`);
  }

  const signal: DomainSignalSnapshot = {
    signalId: idFactory(),
    signalType: 'task.completed',
    occurredAtDay: event.absoluteDay,
    data: {
      taskInstanceId: event.occupant.instanceId,
      taskId: task.id,
      taskType: task.type,
      institutionId: event.occupant.originInstitutionId,
      regionId: event.occupant.originRegionId,
    },
  };

  const loader = getConfigLoader();
  const institutions = loader.getAllInstitutions();
  const result = applyEffects(draft, task.effects, {
    signal,
    currentDay: event.absoluteDay,
    attributeBounds: snapshot.attributeBounds,
    knownInstitutionIds: new Set(institutions.map((institution) => institution.id)),
    knownRegionIds: new Set(institutions.map((institution) => institution.regionId)),
  });
  const labels = result.applied.map(
    (record) =>
      `${record.targetDescription} ${String(record.previousValue)}→${String(record.newValue)}`,
  );
  labels.push(
    ...applyPersonalTaskKpiEffects(draft.actions.departmentStates, task.kpiEffects ?? []),
  );

  notifications.push({
    actionName: task.name,
    deptName: snapshot.department.name,
    effects: labels,
    completedAtDay: event.absoluteDay,
  });
  incrementProbationCompletedActions(draft, event.occupant, event.absoluteDay);
  draft.actions.slots[event.tierKey].occupants[event.slotIndex] = null;

  const taskRuntime = draft.actions.personalTasks;
  if (event.occupant.cooldownDays > 0) {
    taskRuntime.cooldownUntilDays[task.id] =
      event.occupant.startedAtDay + event.occupant.durationDays + event.occupant.cooldownDays;
  }
  taskRuntime.completedCounts[task.id] = (taskRuntime.completedCounts[task.id] ?? 0) + 1;
  taskRuntime.totalCompleted += 1;
  return signal;
}

/** 试用期内完成的槽位工作计入转正考核的行动数（部门行动与个人任务同规）。 */
function incrementProbationCompletedActions(
  draft: PlayerSave,
  occupant: { startedAtDay: number },
  absoluteDay: number,
): void {
  const probation = draft.career.appointment.probation;
  if (
    probation?.status === 'active' &&
    occupant.startedAtDay >= probation.startedAtDay &&
    absoluteDay <= probation.endsAtDay
  )
    probation.completedActionCount += 1;
}

/**
 * 执行月度结算：预算扣除 + 风格衰减 + 防汛风险自动变化。
 *
 * @param draft      可变事务状态
 * @param endedMonth 刚结束的月份 (1-12)
 * @param absoluteDay 当前绝对日
 * @param idFactory   事务共享 ID 工厂
 * @returns 若 flood_risk 发生变化则返回 world.metric_changed 信号，否则 null
 */
function processMonthlySettlement(
  draft: PlayerSave,
  endedMonth: number,
  absoluteDay: number,
  idFactory: () => string,
): DomainSignalSnapshot | null {
  const loader = getConfigLoader();
  const departments = loader.resolvePositionDepartments(draft.career.appointment.positionId);
  // 无领导职务阶段无法操作这些部门，也不掌握部门运转预算；个人任务成本已在
  // START_PERSONAL_TASK 时独立扣除，不能再让只读部门产生隐性月度开支。
  const chargedDepartments = draft.career.appointment.leadershipRank === 'none' ? [] : departments;
  const result = monthlySettlement(
    draft.actions.departmentStates,
    chargedDepartments,
    draft.remainingBudget,
  );
  draft.remainingBudget = result.newRemaining;
  for (const department of departments) {
    const state = draft.actions.departmentStates[department.id];
    if (!state) continue;
    const consumption = result.deptConsumptions[department.id] ?? 0;
    state.monthlyConsumption = consumption;
    state.cumulativeConsumption += consumption;
  }
  draft.character.philosophy.scores = decayStyleScores(
    draft.character.philosophy.scores,
    loader.getLeadershipStyleConfig(),
  );

  const cfg = loader.getGameConfig().floodRiskByMonth;
  const previous = draft.world.metrics.flood_risk ?? 0;
  const delta = computeFloodRiskMonthDelta(
    previous,
    endedMonth,
    cfg.rainyMonths,
    cfg.monthlyRise,
    cfg.monthlyFall,
  );
  // 清除准备标记的时机：仅当风险从 ≥80 降回 <80（确有汛情才消耗准备）。
  // 不再按月份清除——旱季提前准备应延续至首次真正汛情，而非被日历清零。
  if (draft.world.facts.flood_prepared === true) {
    const crossedDown = previous >= 80 && delta.next < 80;
    if (crossedDown) {
      draft.world.facts.flood_prepared = false;
    }
  }
  if (delta.next === delta.previous) return null;
  draft.world.metrics.flood_risk = delta.next;
  return {
    signalId: idFactory(),
    signalType: 'world.metric_changed',
    occurredAtDay: absoluteDay,
    data: { metricId: 'flood_risk', value: delta.next },
  };
}

/**
 * 执行年度考核：综合评分 + 等次 + 奖惩 + 腐败举报指数更新。
 *
 * @param draft      可变事务状态
 * @param year       考核年份
 * @param absoluteDay 当前绝对日
 * @param idFactory   事务共享 ID 工厂
 * @returns 包含考核、职数与年度世界指标变化的信号数组
 */
function processAnnualAssessment(
  draft: PlayerSave,
  year: number,
  absoluteDay: number,
  idFactory: () => string,
): DomainSignalSnapshot[] {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  // 与工作台和 KPI 页面共用同一权威入口，确保玩家看到的责任指标
  // 与年终实际结算完全一致。
  const indicators = loader.resolvePositionKpis(draft.career.appointment.positionId);
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
  const assessmentRecord = { year, score, tier: annual.tier, dimensions };
  draft.assessments.annualAssessments.push(assessmentRecord);
  const currentExperience = draft.career.experiences.find(
    (experience) =>
      experience.appointmentId === draft.career.appointment.appointmentId &&
      experience.endedAtDay === null,
  );
  if (!currentExperience)
    throw new Error(
      `Current appointment ${draft.career.appointment.appointmentId} has no open experience`,
    );
  // 先写入任内履历再发出 assessment.completed，确保同日机会资格读取到本次结果。
  currentExperience.assessmentResults.push({ year, score, tier: annual.tier });
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

  const signals: DomainSignalSnapshot[] = [
    {
      signalId: idFactory(),
      signalType: 'assessment.completed',
      occurredAtDay: absoluteDay,
      data: { year, score, tier: annual.tier },
    },
  ];

  const rankRule = loader.getCivilServiceRankProgressionRule(draft.career.civilServiceRank);
  const quotaMetricId = rankRule?.quotaRequirement?.metricId;
  const quotaGrant = grantAnnualCivilServiceRankQuota(
    rankRule,
    annual.tier,
    quotaMetricId ? (draft.world.metrics[quotaMetricId] ?? 0) : 0,
  );
  if (quotaGrant && quotaGrant.currentValue !== quotaGrant.previousValue) {
    draft.world.metrics[quotaGrant.metricId] = quotaGrant.currentValue;
    signals.push({
      signalId: idFactory(),
      signalType: 'world.metric_changed',
      occurredAtDay: absoluteDay,
      data: { metricId: quotaGrant.metricId, value: quotaGrant.currentValue },
    });
  }

  const newReport = computeCorruptionReport({
    integrity: draft.character.integrity,
    corruptionRisk: draft.character.corruptionRisk,
    stability: draft.character.stability,
  });
  // 即使值未变也每年发出信号，确保惰性玩家（属性长期不变）的举报链每年可达。
  // investigation_start 的 once_per_source 以 signalId 为 key，每年新信号可触发一次。
  draft.world.metrics.corruption_report = newReport;
  signals.push({
    signalId: idFactory(),
    signalType: 'world.metric_changed',
    occurredAtDay: absoluteDay,
    data: { metricId: 'corruption_report', value: newReport },
  });

  // 年度考核是财政年度提交点：下一年度重新取得当前职位年度预算，同时清零
  // 部门运转消费台账。KPI、行动冷却和个人任务完成记录属于持续进度，不重置。
  const position = loader.getPositionById(draft.career.appointment.positionId);
  if (!position)
    throw new Error(
      `Cannot reset annual budget for unknown position ${draft.career.appointment.positionId}`,
    );
  draft.remainingBudget = position.annualBudget;
  for (const departmentState of Object.values(draft.actions.departmentStates)) {
    departmentState.monthlyConsumption = 0;
    departmentState.cumulativeConsumption = 0;
  }

  return signals;
}

/**
 * 将当前绝对日之前已到期的待处理事件提交为过期历史。
 *
 * @param draft 可变事务状态
 * @param currentDay 当前绝对日
 * @param rng 领域信号编排使用的随机源
 * @param idFactory 事务共享稳定 ID 工厂
 * @param definitions 事件定义快照
 * @returns void
 */
export function expireEventsAtDay(draft: PlayerSave, currentDay: number): void {
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
  for (const instance of activation.activatedInstances) {
    // 每次只提交一个实例，让它产生的级联信号有机会在消费同日兄弟实例前中断时间轴。
    draft.events.scheduled = draft.events.scheduled.filter(
      (scheduled) => scheduled.instanceId !== instance.instanceId,
    );
    // 防御早期 Schema 4 已写出的计划链节点：激活时补齐缺失的链实例。
    if (instance.snapshot.chainId && !instance.chainInstanceId) {
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

    const applied = applyEventInstances(draft, [instance], currentDay, rng, idFactory, definitions);
    processCascadeSignalsInTransaction(
      draft,
      applied.cascadeSignals,
      currentDay,
      rng,
      idFactory,
      definitions,
    );
    if (draft.events.activeBlockingEventId !== null) return;
  }
}
