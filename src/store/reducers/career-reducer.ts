/**
 * 职业机会 Reducer
 *
 * 处理晋升相关动作：
 * - START_PROMOTION
 * - SELECT_PROMOTION_TARGET
 * - RESET_PROMOTION
 * - PROMOTION_RESOLVE_STAGE
 */

import type { PlayerSave, CareerRecord } from '../../types/player';
import type { PromotionContext } from '../../types/game';
import { PromotionStage, OrgInspectResult } from '../../types/enums';
import { getConfigLoader } from '../../config/loader';
import { clamp } from '../../utils/math';
import { hasActiveActions } from '../../engine/core/action';
import { resolveDemocraticVote, resolveOrgInspection } from '../../engine/career/promotion';
import { validatePromotionTarget } from '../../engine/career/promotion-target';
import {
  resolveJointReview,
  resolveCommitteeVote,
  resolvePublicNotice,
  resolveProbation,
} from '../../engine/career/promotion-final';
import { extractPositionIndex, initializeDepartmentStates } from './shared';

/**
 * 从 draft 中提取晋升引擎所需的上下文快照。
 *
 * @param draft 当前游戏状态
 * @returns PromotionContext
 */
function buildPromotionContext(draft: PlayerSave): PromotionContext {
  return {
    playerLevel: draft.currentLevel,
    playerScore: draft.comprehensiveScore,
    yearsInPosition: draft.yearsInCurrentPosition,
    politicalCapital: draft.politicalCapital,
    corruptionRisk: draft.corruptionRisk,
    styleScores: draft.philosophy.scores,
    relations: { colleagues: draft.relations.colleagues },
    assessmentHistory: draft.annualAssessments.map((a) => ({ score: a.score, tier: a.tier })),
    hasDisciplinaryRecord: false,
    hasGrassrootsExperience:
      draft.currentLevel <= 2 || draft.careerHistory.some((r) => r.level <= 2),
    hasMultiRegionExperience: draft.careerHistory.filter((r) => r.archived).length >= 2,
    charisma: draft.charisma,
    superiorFavor: 0,
    performance: draft.performance,
    competence: draft.competence,
    integrity: draft.integrity,
  };
}

/** 非 idle/completed/failed 时禁止执行其他操作 */
function canAct(stage: PromotionStage): boolean {
  return (
    stage === PromotionStage.Idle ||
    stage === PromotionStage.Completed ||
    stage === PromotionStage.Failed
  );
}

/**
 * 处理 START_PROMOTION 动作。
 *
 * @param draft 当前游戏状态
 */
export function reduceStartPromotion(draft: PlayerSave): void {
  if (draft.promotionStage !== PromotionStage.Idle) return;
  if (draft.endgameReached) return;
  if (draft.frozenPeriods > 0) return;
  if (hasActiveActions(draft.slots)) return;

  const nextLevel = draft.currentLevel + 1;
  const lineCfg = getConfigLoader().getCareerLine(draft.currentCareerLine);
  if (!lineCfg) return;
  const nextLevelCfg = lineCfg.levels.find((l) => l.level === nextLevel);
  if (!nextLevelCfg || nextLevelCfg.positions.length === 0) return;

  draft.promotionAttempts += 1;
  draft.promotionStage = PromotionStage.TargetSelection;
  draft.promotionState = {
    targetPositionId: '',
    targetLevel: nextLevel,
    currentStage: PromotionStage.TargetSelection,
    stageResults: {},
  };
}

/**
 * 处理 SELECT_PROMOTION_TARGET 动作。
 *
 * @param draft 当前游戏状态
 * @param positionId 目标职位 ID
 */
export function reduceSelectPromotionTarget(draft: PlayerSave, positionId: string): void {
  if (draft.promotionStage !== PromotionStage.TargetSelection) return;
  const psTarget = draft.promotionState;
  if (!psTarget) return;

  const lineCfgTarget = getConfigLoader().getCareerLine(draft.currentCareerLine);
  if (!lineCfgTarget) return;

  const ctxTarget = buildPromotionContext(draft);
  const validation = validatePromotionTarget(
    positionId,
    draft.currentLevel,
    lineCfgTarget,
    ctxTarget,
  );

  if (!validation.valid) {
    draft.promotionStage = PromotionStage.Failed;
    psTarget.currentStage = PromotionStage.Failed;
    psTarget.targetPositionId = positionId;
    return;
  }

  psTarget.targetPositionId = positionId;
  psTarget.currentStage = PromotionStage.DemocraticVote;
  draft.promotionStage = PromotionStage.DemocraticVote;
}

/**
 * 处理 RESET_PROMOTION 动作。
 *
 * @param draft 当前游戏状态
 */
export function reduceResetPromotion(draft: PlayerSave): void {
  if (
    draft.promotionStage !== PromotionStage.Completed &&
    draft.promotionStage !== PromotionStage.Failed &&
    draft.promotionStage !== PromotionStage.TargetSelection
  ) {
    return;
  }
  draft.promotionStage = PromotionStage.Idle;
  draft.promotionState = null;
}

/** PROMOTION_RESOLVE_STAGE 动作参数 */
export interface PromotionResolvePayload {
  choices?: { useConnections?: boolean; influenceInspectors?: boolean };
  _rng?: () => number;
}

/**
 * 处理 PROMOTION_RESOLVE_STAGE 动作。
 *
 * @param draft 当前游戏状态
 * @param payload 动作参数
 */
export function reducePromotionResolveStage(
  draft: PlayerSave,
  payload: PromotionResolvePayload,
): void {
  const ps = draft.promotionState;
  if (!ps) return;

  const cfgPromoStore = getConfigLoader().getGameConfig();
  const styleSpectrums = getConfigLoader().getLeadershipStyleConfig().styleSpectrums;
  const ctxStore = buildPromotionContext(draft);
  const choices = payload.choices ?? {};
  const rng = payload._rng ?? Math.random;

  switch (ps.currentStage) {
    case PromotionStage.DemocraticVote: {
      const result = resolveDemocraticVote(ctxStore, choices, cfgPromoStore, rng, styleSpectrums);
      ps.stageResults.democraticVotes = result.votes;
      if (result.flaggedForRisk) ps.flaggedForRisk = true;
      if (result.passed) {
        ps.currentStage = PromotionStage.OrgInspection;
        draft.promotionStage = PromotionStage.OrgInspection;
      } else {
        draft.promotionStage = PromotionStage.Failed;
        ps.currentStage = PromotionStage.Failed;
        draft.ambition = clamp(
          (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
          0,
          100,
        );
      }
      break;
    }
    case PromotionStage.OrgInspection: {
      const result = resolveOrgInspection(ctxStore, choices, cfgPromoStore);
      ps.stageResults.inspectionResult = result.result;
      if (result.politicalCost > 0) {
        draft.politicalCapital -= result.politicalCost;
      }
      if (result.passed) {
        ps.currentStage = PromotionStage.JointReview;
        draft.promotionStage = PromotionStage.JointReview;
      } else if (result.result === OrgInspectResult.Rejected) {
        draft.promotionStage = PromotionStage.Failed;
        ps.currentStage = PromotionStage.Failed;
        draft.frozenPeriods = clamp(draft.frozenPeriods + 2, 0, cfgPromoStore.maxFrozenPeriods);
        draft.ambition = clamp(
          (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnRejected,
          0,
          100,
        );
      } else {
        draft.promotionStage = PromotionStage.Failed;
        ps.currentStage = PromotionStage.Failed;
      }
      break;
    }
    case PromotionStage.JointReview: {
      const result = resolveJointReview(ctxStore, cfgPromoStore, rng);
      ps.stageResults.reviewPassedDepts = Object.entries(result.opinions)
        .filter(([, v]) => v)
        .map(([k]) => k);
      ps.stageResults.reviewFailedDepts = Object.entries(result.opinions)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (result.passed) {
        ps.currentStage = PromotionStage.CommitteeVote;
        draft.promotionStage = PromotionStage.CommitteeVote;
      } else {
        draft.promotionStage = PromotionStage.Failed;
        ps.currentStage = PromotionStage.Failed;
        draft.ambition = clamp(
          (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
          0,
          100,
        );
      }
      break;
    }
    case PromotionStage.CommitteeVote: {
      const result = resolveCommitteeVote(ctxStore, cfgPromoStore, rng, styleSpectrums);
      ps.stageResults.committeeForVotes = result.forVotes;
      ps.stageResults.committeeAgainstVotes = result.againstVotes;
      if (result.passed) {
        ps.currentStage = PromotionStage.PublicNotice;
        draft.promotionStage = PromotionStage.PublicNotice;
      } else {
        draft.promotionStage = PromotionStage.Failed;
        ps.currentStage = PromotionStage.Failed;
        draft.ambition = clamp(
          (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
          0,
          100,
        );
      }
      break;
    }
    case PromotionStage.PublicNotice: {
      const result = resolvePublicNotice(ctxStore, cfgPromoStore, rng);
      ps.stageResults.hasComplaint = result.hasComplaint;
      ps.stageResults.sentimentEscalated = result.sentimentEscalated;
      if (result.passed) {
        ps.currentStage = PromotionStage.Appointment;
        draft.promotionStage = PromotionStage.Appointment;
      } else {
        draft.promotionStage = PromotionStage.Failed;
        ps.currentStage = PromotionStage.Failed;
        draft.ambition = clamp(
          (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
          0,
          100,
        );
      }
      break;
    }
    case PromotionStage.Appointment: {
      ps.currentStage = PromotionStage.Probation;
      draft.promotionStage = PromotionStage.Probation;
      break;
    }
    case PromotionStage.Probation: {
      const result = resolveProbation(ctxStore, cfgPromoStore, rng);
      if (result.passed) {
        if (ps.targetLevel !== draft.currentLevel + 1) {
          draft.promotionStage = PromotionStage.Failed;
          ps.currentStage = PromotionStage.Failed;
          break;
        }

        const loader = getConfigLoader();
        const oldPos = loader.getPosition(
          draft.currentCareerLine,
          draft.currentLevel,
          extractPositionIndex(draft.currentPositionId),
        );
        const targetPos = loader.getPosition(
          draft.currentCareerLine,
          ps.targetLevel,
          extractPositionIndex(ps.targetPositionId),
        );
        if (!targetPos || targetPos.id !== ps.targetPositionId) {
          draft.promotionStage = PromotionStage.Failed;
          ps.currentStage = PromotionStage.Failed;
          break;
        }

        const careerRecord: CareerRecord = {
          positionId: draft.currentPositionId,
          positionName: oldPos?.name ?? draft.currentPositionId,
          level: draft.currentLevel,
          careerLine: draft.currentCareerLine,
          startYear: draft.time.year - draft.yearsInCurrentPosition,
          endYear: draft.time.year,
          assessmentResults: draft.annualAssessments.map((assessment) => ({
            ...assessment,
          })),
          archived: false,
        };
        draft.careerHistory.push(careerRecord);
        draft.currentPositionId = ps.targetPositionId;
        draft.currentLevel = ps.targetLevel;
        draft.yearsInCurrentPosition = 0;
        draft.remainingBudget = targetPos.annualBudget;
        draft.annualAssessments = [];
        draft.comprehensiveScore = 0;
        draft.politicalCapital = clamp(
          draft.politicalCapital +
            cfgPromoStore.promotion.progression.politicalCapitalBonusOnSuccess,
          0,
          500,
        );
        initializeDepartmentStates(draft);
        draft.promotionStage = PromotionStage.Completed;
        ps.currentStage = PromotionStage.Completed;
        if (ps.targetLevel >= 11) {
          draft.endgameReached = true;
        }
      } else {
        draft.promotionStage = PromotionStage.Failed;
        ps.currentStage = PromotionStage.Failed;
        draft.ambition = clamp(
          (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
          0,
          100,
        );
      }
      break;
    }
    default:
      break;
  }
}

/**
 * 检查是否可以执行非晋升操作。
 *
 * @param stage 当前晋升阶段
 * @returns 是否可以操作
 */
export { canAct };
