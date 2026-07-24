/**
 * 时间推进 Reducer（Schema 2）
 *
 * 处理 ADVANCE_TIME 动作：
 * - 使用统一时间轴确保事件按正确顺序结算
 * - 行动完成 → 月度结算 → 年度考核（严格按时间顺序）
 * - 每个行动使用自己的 runtimeSnapshot 中的偏离倍率
 */

import type { PlayerSave, CompletedActionNotification } from '../../types/player';
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
  handleAutoEventInstance,
  advanceBlockingPointer,
} from './event-reducer';

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

/**
 * 处理 ADVANCE_TIME 动作。
 *
 * @param draft 当前游戏状态（mutable）
 * @param payload 动作参数
 */
export function reduceAdvanceTime(draft: PlayerSave, payload: AdvanceTimePayload): void {
  const cfg = getConfigLoader().getGameConfig();
  const days = getGranularityDays(payload.granularity, cfg);

  // 统一时间推进
  const result = advanceTimeline(
    draft.time,
    days,
    draft.time.totalDaysPlayed,
    draft.actions.slots,
    draft.character.birthYear,
    cfg,
  );

  const notifications: CompletedActionNotification[] = [];
  const rng = payload._rng ?? Math.random;

  // 按时间顺序处理事件
  for (const event of result.events) {
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
  }

  // 更新时间和总天数
  draft.time.year = result.newTime.year;
  draft.time.month = result.newTime.month;
  draft.time.day = result.newTime.day;
  draft.time.granularity = payload.granularity;
  draft.time.totalDaysPlayed += days;

  const currentDay = draft.time.totalDaysPlayed;

  // 激活到期的计划事件
  const definitions = getConfigLoader().getAllEventDefinitions();
  const activationResult = activateScheduledEvents(
    draft as Readonly<PlayerSave>,
    currentDay,
    rng,
    () => `sched_act_${currentDay}_${Date.now()}`,
  );

  // 清理已激活的计划事件
  const activatedIds = new Set(activationResult.activatedInstances.map((i) => i.instanceId));
  draft.events.scheduled = draft.events.scheduled.filter((s) => !activatedIds.has(s.instanceId));

  for (const inst of activationResult.activatedInstances) {
    // 跨链调度：snapshot 有 chainId 但实例无 chainInstanceId，为子链创建链实例
    if (inst.snapshot.chainId && !inst.chainInstanceId) {
      const existingChain = Object.values(draft.events.chainInstances).find(
        (c) => c.chainId === inst.snapshot.chainId && c.sourceKey === inst.sourceKey,
      );
      if (existingChain) {
        inst.chainInstanceId = existingChain.instanceId;
      } else {
        const newChain = {
          instanceId: `chain_${inst.snapshot.chainId}_${inst.sourceKey}`,
          chainId: inst.snapshot.chainId,
          status: 'active' as const,
          sourceKey: inst.sourceKey,
          activeNodeIds: [] as string[],
          completedNodeIds: [] as string[],
          startedAtDay: currentDay,
          completedAtDay: null,
        };
        draft.events.chainInstances[newChain.instanceId] = newChain;
        inst.chainInstanceId = newChain.instanceId;
      }
    }

    if (inst.snapshot.presentation === 'automatic') {
      const { cascadeSignals } = handleAutoEventInstance(
        draft,
        inst,
        currentDay,
        rng,
        () => `auto_${inst.instanceId}`,
        definitions,
      );
      // 处理自动事件产生的级联信号
      processCascadeSignals(
        draft,
        cascadeSignals,
        currentDay,
        rng,
        () => `cascade_auto_${inst.instanceId}`,
        definitions,
      );
    } else {
      draft.events.pending.push(inst);
      if (
        inst.snapshot.presentation === 'blocking' &&
        draft.events.activeBlockingEventId === null
      ) {
        draft.events.activeBlockingEventId = inst.instanceId;
      }
    }
  }

  // 过期事件处理
  const expiryResult = expireEventInstances(draft as Readonly<PlayerSave>, currentDay);
  for (const record of expiryResult.expiredRecords) {
    draft.events.history.push(record);
  }
  for (const history of expiryResult.expiredRecords) {
    const idx = draft.events.pending.findIndex((p) => p.instanceId === history.instanceId);
    if (idx !== -1) draft.events.pending.splice(idx, 1);
  }
  for (const chain of expiryResult.chainsToUpdate) {
    draft.events.chainInstances[chain.instanceId] = chain;
  }

  // 过期事件可能包含当前 activeBlockingEventId，需推进指针避免悬空
  advanceBlockingPointer(draft);

  // 更新最近完成行动通知
  if (notifications.length > 0) {
    draft.actions.lastCompletedActions = [
      ...notifications,
      ...draft.actions.lastCompletedActions,
    ].slice(0, 5);
  }
}
