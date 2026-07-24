/**
 * 时间推进 Reducer（Schema 2）
 *
 * 处理 ADVANCE_TIME 动作：
 * - 使用统一时间轴确保事件按正确顺序结算
 * - 行动完成 → 月度结算 → 年度考核（严格按时间顺序）
 * - 每个行动使用自己的 runtimeSnapshot 中的偏离倍率
 */

import type { PlayerSave, CompletedActionNotification } from '../../types/player';
import { unwrap } from 'solid-js/store';
import type { ActionCompletionTimelineEvent } from '../../types/game';
import type { AdvanceTimePayload } from '../../types/actions';
import { getGranularityDays } from '../../engine/core/time';
import { advanceTimeline } from '../../engine/core/timeline';
import { resolveActionEffects } from '../../engine/core/action';
import { monthlySettlement } from '../../engine/governance/budget';
import { calculateKPI, scoreToKPITier } from '../../engine/governance/kpi';
import {
  computeFiveDimensions,
  computeComprehensiveScore,
} from '../../engine/governance/dimensions';
import { annualAssessment as runAnnualAssessment } from '../../engine/governance/assessment';
import { decayStyleScores } from '../../engine/career/style-decay';
import { getConfigLoader } from '../../config/loader';
import { clampAttr } from '../../utils/math';
import { activateScheduledEvents, expireEventInstances } from '../../engine/events/event-scheduler';
import {
  processCascadeSignals,
  applyEventInstances,
  advanceBlockingPointer,
} from './event-reducer';
import { createRuntimeIdFactory } from '../runtime-id';

/**
 * 处理行动完成时间轴事件。
 */
function processActionCompletion(
  draft: PlayerSave,
  event: ActionCompletionTimelineEvent,
  rng: () => number,
  notifications: CompletedActionNotification[],
): void {
  const cfg = getConfigLoader().getGameConfig();
  const positionId = draft.career.appointment.positionId;
  const departments = getConfigLoader().resolvePositionDepartments(positionId);
  const deptCfg = departments.find((d) => d.id === event.occupant.deptId);
  const aCfg = deptCfg?.actions.find((a) => a.id === event.occupant.actionId);
  const deptName = deptCfg?.name ?? event.occupant.deptId;

  // 从行动实例的 runtimeSnapshot 获取偏离倍率
  const devMult = event.occupant.runtimeSnapshot?.effectivenessMultiplier ?? 1;
  const styleConflictTriggered = event.occupant.runtimeSnapshot?.styleConflictTriggered ?? false;

  if (aCfg) {
    const result = resolveActionEffects(aCfg, rng);
    const effectLabels: string[] = [];

    // 应用 KPI 变化（仅 add 操作应用偏离倍率）
    for (const change of result.kpiChanges) {
      const deptState = draft.actions.departmentStates[event.occupant.deptId];
      if (deptState) {
        const current = deptState.kpiValues[change.indicatorId] ?? 0;
        let newVal: number;
        if (change.operation === 'set') {
          newVal = change.delta;
        } else if (change.operation === 'multiply') {
          // multiply 不应用偏离倍率，直接使用原始因子
          newVal = current * change.delta;
        } else {
          // add 应用偏离倍率
          newVal = current + change.delta * devMult;
        }
        deptState.kpiValues[change.indicatorId] = newVal;
        effectLabels.push(`${change.indicatorId} ${change.operation} ${change.delta}`);
      }
    }

    // 应用玩家属性变化（仅 add 操作应用偏离倍率）
    for (const change of result.playerChanges) {
      const char = draft.character as unknown as Record<string, unknown>;
      const current = typeof char[change.attr] === 'number' ? (char[change.attr] as number) : 0;
      let newVal: number;
      if (change.operation === 'set') {
        newVal = change.delta;
      } else if (change.operation === 'multiply') {
        // multiply 不应用偏离倍率
        newVal = current * change.delta;
      } else {
        // add 应用偏离倍率
        newVal = current + change.delta * devMult;
      }
      char[change.attr] = clampAttr(change.attr, newVal, cfg.attributeBounds);
      effectLabels.push(`${change.attr} ${change.operation} ${change.delta}`);
    }

    // 应用理念变化
    for (const [key, delta] of Object.entries(result.styleDeltas)) {
      const scores = draft.character.philosophy.scores;
      scores[key] = Math.max(0, Math.min(100, (scores[key] ?? 50) + delta));
    }

    // 处理风格冲突
    if (styleConflictTriggered) {
      draft.character.vigor = clampAttr('vigor', draft.character.vigor - 5, cfg.attributeBounds);
      draft.character.ambition = clampAttr(
        'ambition',
        draft.character.ambition - 5,
        cfg.attributeBounds,
      );
    }

    notifications.push({
      actionName: event.occupant.actionName,
      deptName,
      effects: effectLabels,
      completedAtDay: event.absoluteDay,
    });
  }

  // 释放槽位
  draft.actions.slots[event.tierKey].occupants[event.slotIndex] = null;

  // 写入冷却（使用行动实例的 cooldownDays 快照，而非重新读取配置）
  if (event.occupant.cooldownDays > 0) {
    const deptState = draft.actions.departmentStates[event.occupant.deptId];
    if (deptState) {
      const completesAtDay = event.occupant.startedAtDay + event.occupant.durationDays;
      deptState.actionCooldownUntilDays[event.occupant.actionId] =
        completesAtDay + event.occupant.cooldownDays;
    }
  }
}

/**
 * 处理月度结算时间轴事件。
 */
function processMonthlySettlement(draft: PlayerSave): void {
  const loader = getConfigLoader();
  const positionId = draft.career.appointment.positionId;
  const deptConfigs = loader.resolvePositionDepartments(positionId);

  const result = monthlySettlement(
    draft.actions.departmentStates,
    deptConfigs,
    draft.remainingBudget,
  );
  draft.remainingBudget = result.newRemaining;

  for (const [deptId, consumption] of Object.entries(result.deptConsumptions)) {
    const deptState = draft.actions.departmentStates[deptId];
    if (deptState) {
      deptState.monthlyConsumption = consumption;
      deptState.cumulativeConsumption += consumption;
    }
  }

  // 理念衰减
  const styleCfg = loader.getLeadershipStyleConfig();
  draft.character.philosophy.scores = decayStyleScores(draft.character.philosophy.scores, styleCfg);
}

/**
 * 处理年度考核时间轴事件。
 *
 * @param draft 游戏状态
 * @param assessmentYear 考核年度（从事件中获取，而非 draft.time）
 * @param absoluteDay 事件发生的绝对游戏日
 */
function processAnnualAssessment(
  draft: PlayerSave,
  assessmentYear: number,
  absoluteDay: number,
): void {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const positionId = draft.career.appointment.positionId;
  const deptConfigs = loader.resolvePositionDepartments(positionId);
  const year = assessmentYear;

  // 收集所有 KPI 指标
  const allIndicators = deptConfigs.flatMap((d) => d.kpiIndicators);

  // 计算 KPI 得分
  const assessResult = calculateKPI(allIndicators, draft.actions.departmentStates, cfg);
  const kpiTier = scoreToKPITier(assessResult.totalScore, cfg.kpiTierThresholds);

  // 五维考核
  const playerSnapshot = {
    integrity: draft.character.integrity,
    stability: draft.character.stability,
    ambition: draft.character.ambition,
    competence: draft.character.competence,
    charisma: draft.character.charisma,
    network: draft.character.network,
    diligence: draft.character.diligence,
    vigor: draft.character.vigor,
  };
  const dimensions = computeFiveDimensions(playerSnapshot, assessResult.totalScore, cfg);
  const comprehensiveScore = computeComprehensiveScore(dimensions, cfg);

  // 年度考核
  const yearsInPosition = Math.floor((absoluteDay - draft.career.appointment.startedAtDay) / 360);
  const annualResult = runAnnualAssessment(comprehensiveScore, kpiTier, yearsInPosition, cfg);

  draft.assessments.comprehensiveScore = comprehensiveScore;
  draft.assessments.annualAssessments.push({
    year,
    score: comprehensiveScore,
    tier: annualResult.tier,
    dimensions,
  });

  // 考核结果影响属性
  if (annualResult.tier === '优秀') {
    draft.character.performance = clampAttr(
      'performance',
      draft.character.performance + 3,
      cfg.attributeBounds,
    );
  } else if (annualResult.tier === '不称职') {
    draft.character.stability = clampAttr(
      'stability',
      draft.character.stability - 5,
      cfg.attributeBounds,
    );
  }
}

function expireEventsAtDay(draft: PlayerSave, currentDay: number): void {
  const expiryResult = expireEventInstances(draft as Readonly<PlayerSave>, currentDay);
  draft.events.history.push(...expiryResult.expiredRecords);
  const expiredIds = new Set(expiryResult.expiredRecords.map((record) => record.instanceId));
  draft.events.pending = draft.events.pending.filter(
    (instance) => !expiredIds.has(instance.instanceId),
  );
  for (const chain of expiryResult.chainsToUpdate) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }
  advanceBlockingPointer(draft);
}

function activateEventsAtDay(
  draft: PlayerSave,
  currentDay: number,
  rng: () => number,
  idFactory: () => string,
): void {
  const definitions = getConfigLoader().getAllEventDefinitions();
  const activation = activateScheduledEvents(
    draft as Readonly<PlayerSave>,
    currentDay,
    rng,
    idFactory,
  );
  // 同一批到期事件依序处理；首个新 blocking 事件暂停当天其余工作。
  const blockerIndex = activation.activatedInstances.findIndex(
    (item) => item.snapshot.presentation === 'blocking' && item.status === 'active',
  );
  const activatedInstances =
    blockerIndex === -1
      ? activation.activatedInstances
      : activation.activatedInstances.slice(0, blockerIndex + 1);
  const activatedIds = new Set(activatedInstances.map((item) => item.instanceId));
  draft.events.scheduled = draft.events.scheduled.filter(
    (item) => !activatedIds.has(item.instanceId),
  );

  // 防御旧存档：新版调度在创建时已物化目标链，旧数据在激活时补齐。
  for (const instance of activatedInstances) {
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

  const applied = applyEventInstances(
    draft,
    activatedInstances,
    currentDay,
    rng,
    idFactory,
    definitions,
  );
  processCascadeSignals(draft, applied.cascadeSignals, currentDay, rng, idFactory, definitions);
}

/**
 * 处理 ADVANCE_TIME 动作。
 *
 * @param draft 当前游戏状态（mutable）
 * @param payload 动作参数
 */
export function reduceAdvanceTime(draft: PlayerSave, payload: AdvanceTimePayload): void {
  // 时间推进可触发多层自动事件；预算失败时保留推进前的完整状态。
  const transaction = structuredClone(unwrap(draft));
  reduceAdvanceTimeInternal(transaction, payload);
  Object.assign(draft, transaction);
}

function reduceAdvanceTimeInternal(draft: PlayerSave, payload: AdvanceTimePayload): void {
  const cfg = getConfigLoader().getGameConfig();
  const days = getGranularityDays(payload.granularity, cfg);
  const notifications: CompletedActionNotification[] = [];
  const rng = payload._rng ?? Math.random;
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('timeline-event');

  // 先处理当前日已经到期的计划/过期事件；未解决 blocker 会暂停时间。
  activateEventsAtDay(draft, draft.time.totalDaysPlayed, rng, idFactory);
  expireEventsAtDay(draft, draft.time.totalDaysPlayed);

  for (let elapsed = 0; elapsed < days && draft.events.activeBlockingEventId === null; elapsed++) {
    const daily = advanceTimeline(
      draft.time,
      1,
      draft.time.totalDaysPlayed,
      draft.actions.slots,
      draft.character.birthYear,
      cfg,
    );

    // 先落到当天的时间坐标，计划事件与同日 timeline 节点使用同一个绝对日。
    draft.time.year = daily.newTime.year;
    draft.time.month = daily.newTime.month;
    draft.time.day = daily.newTime.day;
    draft.time.totalDaysPlayed = daily.newAbsoluteDay;

    let scheduledProcessed = false;
    for (const event of daily.events) {
      // 行动完成仍保持最高优先级；计划事件是正式同日节点，必须早于月结/年考。
      if (!scheduledProcessed && event.type !== 'action_completion') {
        activateEventsAtDay(draft, daily.newAbsoluteDay, rng, idFactory);
        expireEventsAtDay(draft, daily.newAbsoluteDay);
        scheduledProcessed = true;
        if (draft.events.activeBlockingEventId !== null) break;
      }
      switch (event.type) {
        case 'action_completion':
          processActionCompletion(draft, event, rng, notifications);
          break;
        case 'monthly_settlement':
          processMonthlySettlement(draft);
          break;
        case 'annual_assessment':
          processAnnualAssessment(draft, event.year, event.absoluteDay);
          break;
        default:
          break;
      }
      if (draft.events.activeBlockingEventId !== null) break;
    }

    // 没有周期节点的普通日也需要激活到期事件。
    if (!scheduledProcessed && draft.events.activeBlockingEventId === null) {
      activateEventsAtDay(draft, daily.newAbsoluteDay, rng, idFactory);
      expireEventsAtDay(draft, daily.newAbsoluteDay);
    }
  }
  draft.time.granularity = payload.granularity;

  // 更新最近完成行动通知
  if (notifications.length > 0) {
    draft.actions.lastCompletedActions = [
      ...notifications,
      ...draft.actions.lastCompletedActions,
    ].slice(0, 5);
  }
}
