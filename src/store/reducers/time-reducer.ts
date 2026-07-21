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

    // 应用 KPI 变化（乘以偏离倍率）
    for (const change of result.kpiChanges) {
      const deptState = draft.actions.departmentStates[event.occupant.deptId];
      if (deptState) {
        const delta = change.delta * devMult;
        const current = deptState.kpiValues[change.indicatorId] ?? 0;
        deptState.kpiValues[change.indicatorId] = current + delta;
        effectLabels.push(`${change.indicatorId} +${delta.toFixed(1)}`);
      }
    }

    // 应用玩家属性变化
    for (const change of result.playerChanges) {
      const char = draft.character as unknown as Record<string, unknown>;
      const current = typeof char[change.attr] === 'number' ? (char[change.attr] as number) : 0;
      char[change.attr] = clampAttr(
        change.attr,
        current + change.delta * devMult,
        cfg.attributeBounds,
      );
      effectLabels.push(`${change.attr} +${(change.delta * devMult).toFixed(1)}`);
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

  // 写入冷却
  if (aCfg && aCfg.cooldownDays > 0) {
    const deptState = draft.actions.departmentStates[event.occupant.deptId];
    if (deptState) {
      const completesAtDay = event.occupant.startedAtDay + event.occupant.durationDays;
      deptState.actionCooldownUntilDays[event.occupant.actionId] =
        completesAtDay + aCfg.cooldownDays;
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
 */
function processAnnualAssessment(draft: PlayerSave): void {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const positionId = draft.career.appointment.positionId;
  const deptConfigs = loader.resolvePositionDepartments(positionId);
  const year = draft.time.year;

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
  const yearsInPosition = Math.floor(
    (draft.time.totalDaysPlayed - draft.career.appointment.startedAtDay) / 360,
  );
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
        processAnnualAssessment(draft);
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

  // 更新最近完成行动通知
  if (notifications.length > 0) {
    draft.actions.lastCompletedActions = [
      ...notifications,
      ...draft.actions.lastCompletedActions,
    ].slice(0, 5);
  }
}
