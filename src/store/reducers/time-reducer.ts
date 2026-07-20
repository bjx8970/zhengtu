/**
 * 时间推进 Reducer
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
import { clamp, clampAttr } from '../../utils/math';
import {
  applyPlayerAttr,
  setPlayerAttrDirect,
  getPlayerAttr,
  applyStyleDelta,
  extractPositionIndex,
} from './shared';

/**
 * 处理行动完成时间轴事件。
 *
 * @param draft 游戏状态
 * @param event 行动完成事件
 * @param rng 随机数生成器
 * @param notifications 通知收集数组
 */
function processActionCompletion(
  draft: PlayerSave,
  event: ActionCompletionTimelineEvent,
  rng: () => number,
  notifications: CompletedActionNotification[],
): void {
  const cfg = getConfigLoader().getGameConfig();
  const posIdx = extractPositionIndex(draft.currentPositionId);
  const currentPosition = getConfigLoader().getPosition(
    draft.currentCareerLine,
    draft.currentLevel,
    posIdx,
  );

  const occupant = event.occupant;
  const deptCfg = currentPosition?.departments.find((d) => d.id === occupant.deptId);
  const aCfg = deptCfg?.actions.find((a) => a.id === occupant.actionId);
  const deptName = deptCfg?.name ?? occupant.deptId;

  // v4: 从行动实例的 runtimeSnapshot 获取偏离倍率
  const devMult = occupant.runtimeSnapshot?.effectivenessMultiplier ?? 1;
  const styleConflictTriggered = occupant.runtimeSnapshot?.styleConflictTriggered ?? false;

  if (aCfg) {
    const effects = resolveActionEffects(aCfg, rng);
    const deptState = draft.departmentStates[occupant.deptId];

    if (deptState) {
      // 写入冷却
      if (occupant.category !== 'routine') {
        deptState.actionCooldownUntilDays[occupant.actionId] =
          occupant.startedAtDay + occupant.durationDays + occupant.cooldownDays;
      }

      // 应用 KPI 变更（使用行动自己的偏离倍率）
      for (const kpi of effects.kpiChanges) {
        const cur = deptState.kpiValues[kpi.indicatorId] ?? 0;
        if (kpi.operation === 'multiply') {
          deptState.kpiValues[kpi.indicatorId] = cur * kpi.delta;
        } else if (kpi.operation === 'set') {
          deptState.kpiValues[kpi.indicatorId] = kpi.delta;
        } else {
          deptState.kpiValues[kpi.indicatorId] = cur + kpi.delta * devMult;
        }
      }
    }

    // 应用玩家属性变更（使用行动自己的偏离倍率）
    for (const change of effects.playerChanges) {
      if (change.operation === 'add') {
        applyPlayerAttr(draft, change.attr, change.delta * devMult, cfg.attributeBounds);
      } else if (change.operation === 'multiply' || change.operation === 'set') {
        const cur = getPlayerAttr(draft, change.attr);
        const newVal = change.operation === 'multiply' ? cur * change.delta : change.delta;
        setPlayerAttrDirect(draft, change.attr, newVal, cfg.attributeBounds);
      }
    }

    // 应用风格增量
    if (effects.styleDeltas) {
      for (const [styleId, delta] of Object.entries(effects.styleDeltas)) {
        applyStyleDelta(draft, styleId, delta);
      }
    }

    // v4: 处理风格冲突（从行动实例读取，不再使用玩家级标记）
    if (styleConflictTriggered) {
      draft.vigor = clampAttr('vigor', (draft.vigor ?? 100) - 5, cfg.attributeBounds);
      draft.ambition = clampAttr('ambition', (draft.ambition ?? 100) - 5, cfg.attributeBounds);
    }

    notifications.push({
      actionName: occupant.actionName,
      deptName,
      effects: [
        ...effects.kpiChanges.map((k) =>
          k.operation === 'multiply'
            ? `KPI×${k.delta}`
            : k.operation === 'set'
              ? `KPI=${k.delta}`
              : `KPI${k.delta >= 0 ? '+' : ''}${k.delta}`,
        ),
        ...effects.playerChanges.map((p) =>
          p.operation === 'multiply'
            ? `${p.attr}×${p.delta}`
            : p.operation === 'set'
              ? `${p.attr}=${p.delta}`
              : `${p.attr}${p.delta >= 0 ? '+' : ''}${p.delta}`,
        ),
      ],
      completedAtDay: occupant.startedAtDay + occupant.durationDays,
    });
  }

  // 清空槽位
  draft.slots[event.tierKey].occupants[event.slotIndex] = null;
}

/**
 * 处理月度结算时间轴事件。
 *
 * @param draft 游戏状态
 */
function processMonthlySettlement(draft: PlayerSave): void {
  const loader = getConfigLoader();
  const position = loader.getPosition(
    draft.currentCareerLine,
    draft.currentLevel,
    extractPositionIndex(draft.currentPositionId),
  );
  if (!position) return;

  const settlement = monthlySettlement(
    draft.departmentStates,
    position.departments,
    draft.remainingBudget,
  );
  draft.remainingBudget = settlement.newRemaining;

  for (const dept of position.departments) {
    const ds = draft.departmentStates[dept.id];
    if (ds) {
      ds.monthlyConsumption = settlement.deptConsumptions[dept.id] ?? 0;
      ds.cumulativeConsumption += settlement.deptConsumptions[dept.id] ?? 0;
    }
  }

  // 月度风格衰减
  const styleCfg = loader.getLeadershipStyleConfig();
  draft.philosophy.scores = decayStyleScores(draft.philosophy.scores, styleCfg);
}

/**
 * 处理年度考核时间轴事件。
 *
 * @param draft 游戏状态
 * @param year 考核年份
 */
function processAnnualAssessment(draft: PlayerSave, year: number): void {
  const loader = getConfigLoader();
  const cfg = loader.getGameConfig();
  const position = loader.getPosition(
    draft.currentCareerLine,
    draft.currentLevel,
    extractPositionIndex(draft.currentPositionId),
  );
  if (!position) return;

  const kpiResult = calculateKPI(position.kpiIndicators, draft.departmentStates, cfg);
  const dimensions = computeFiveDimensions(
    {
      integrity: draft.integrity,
      stability: draft.stability,
      ambition: draft.ambition,
      competence: draft.competence,
      charisma: draft.charisma,
      network: draft.network,
      diligence: draft.diligence,
      vigor: draft.vigor,
    },
    kpiResult.totalScore,
    cfg,
  );
  const comprehensiveScore = computeComprehensiveScore(dimensions, cfg);
  const tier = scoreToKPITier(comprehensiveScore, cfg.kpiTierThresholds);
  const assessment = runAnnualAssessment(
    comprehensiveScore,
    tier,
    draft.yearsInCurrentPosition,
    cfg,
  );

  draft.comprehensiveScore = assessment.score;
  if (draft.frozenPeriods > 0) draft.frozenPeriods -= 1;
  draft.frozenPeriods += assessment.frozenPeriods;
  draft.frozenPeriods = clamp(draft.frozenPeriods, 0, cfg.maxFrozenPeriods);
  draft.annualAssessments.push({
    year,
    score: assessment.score,
    tier: assessment.tier,
    dimensions,
  });
  draft.yearsInCurrentPosition += 1;
}

/**
 * 处理 ADVANCE_TIME 动作。
 *
 * v4 核心变更：使用统一时间轴，确保行动完成在月度/年度结算之前处理。
 *
 * @param draft 当前游戏状态（mutable）
 * @param payload 动作参数
 */
export function reduceAdvanceTime(draft: PlayerSave, payload: AdvanceTimePayload): void {
  const cfg = getConfigLoader().getGameConfig();
  const days = getGranularityDays(payload.granularity, cfg);
  const rng = payload._rng ?? Math.random;

  // v4: 统一时间推进，一次返回最终时间 + 排序事件
  const result = advanceTimeline(
    draft.time,
    days,
    draft.totalDaysPlayed,
    draft.slots,
    draft.birthYear,
    cfg,
  );

  draft.time = {
    ...draft.time,
    year: result.newTime.year,
    month: result.newTime.month,
    day: result.newTime.day,
  };
  draft.totalDaysPlayed = result.newAbsoluteDay;

  // 按时间轴顺序处理所有事件
  const notifications: CompletedActionNotification[] = [];

  for (const event of result.events) {
    switch (event.type) {
      case 'action_completion':
        processActionCompletion(draft, event, rng, notifications);
        break;
      case 'monthly_settlement':
        processMonthlySettlement(draft);
        break;
      case 'annual_assessment':
        processAnnualAssessment(draft, event.year);
        break;
      case 'political_cycle':
        // Phase 3+ 实现
        break;
      case 'retirement_check':
        // Phase 3+ 实现
        break;
    }
  }

  if (notifications.length > 0) {
    draft.lastCompletedActions = [...notifications, ...draft.lastCompletedActions].slice(0, 5);
  }

  draft.updatedAt = Date.now();
}
