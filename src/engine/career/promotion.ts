/**
 * 晋升引擎 — 六阶段状态机（阶段 0~3）
 *
 * 核心职责：
 * 1. checkPrerequisites — 门槛校验（服务年限/考核次数/处分/特殊条件）
 * 2. resolveDemocraticVote — 民主推荐（玩家可拉票）
 * 3. resolveOrgInspection — 组织考察（玩家可引导考察组）
 * 4. resolveJointReview — 多部门联审（纪委/公安/信访/审计/网信）
 *
 * 所有函数为纯函数，rng 参数用于注入随机数生成器（默认 Math.random）。
 * 阶段 4~6 见 promotion-final.ts。
 */

import type { PromotionContext } from '../../types/game';
import type { PromotionRequirement, GameConfig } from '../../types/config';
import { OrgInspectResult } from '../../types/enums';

/**
 * 晋升门槛校验。
 *
 * @param ctx 晋升上下文（玩家属性快照）
 * @param req 目标职位的晋升要求
 * @returns 是否通过 + 不满足的条件列表
 */
export function checkPrerequisites(
  ctx: PromotionContext,
  req: PromotionRequirement,
): { eligible: boolean; missing: string[] } {
  const missing: string[] = [];

  if (ctx.yearsInPosition < req.minYearsInService) {
    missing.push(`任职年限不足（需${req.minYearsInService}年，当前${ctx.yearsInPosition}年）`);
  }

  const passCount = ctx.assessmentHistory.filter((a) => a.tier !== '不称职').length;
  if (passCount < req.minAssessmentPasses) {
    missing.push(`考核称职次数不足（需${req.minAssessmentPasses}次，当前${passCount}次）`);
  }

  if (ctx.hasDisciplinaryRecord) {
    missing.push('存在党纪处分记录');
  }

  if (req.specialConditions?.includes('grassroots') && !ctx.hasGrassrootsExperience) {
    missing.push('缺少基层主官任职经历');
  }

  if (req.specialConditions?.includes('multi_region') && !ctx.hasMultiRegionExperience) {
    missing.push('缺少跨地区历练履历');
  }

  return { eligible: missing.length === 0, missing };
}

/**
 * 阶段1 — 民主推荐。
 *
 * 得票 = 考核得分×0.4 + 魅力×0.3 + 上司好感×0.3
 * 玩家可动用人脉拉票 (+10 分，30% 概率留负面记录)。
 *
 * @param ctx     晋升上下文
 * @param choices 玩家选择 { useConnections }
 * @param cfg     晋升配置常量
 * @param rng     随机数生成器（默认 Math.random）
 * @returns 是否通过 + 得票数 + 详情 + 可能的负面标记
 */
export function resolveDemocraticVote(
  ctx: PromotionContext,
  choices: { useConnections?: boolean },
  cfg: GameConfig,
  rng: () => number = Math.random,
): {
  passed: boolean;
  votes: number;
  detail: string;
  flaggedForRisk?: boolean;
} {
  const promo = cfg.promotion.democraticVote;
  let baseScore = ctx.playerScore * 0.4 + ctx.charisma * 0.3 + ctx.superiorFavor * 0.3;

  let flaggedForRisk = false;

  if (choices.useConnections) {
    baseScore += promo.connectionsBonus;
    if (rng() < promo.connectionsRiskProbability) {
      flaggedForRisk = true;
    }
  }

  const factionPenalty = calculateFactionPenalty(ctx.factionReputation);
  baseScore -= factionPenalty;

  const passed = baseScore >= promo.passThreshold;

  return {
    passed,
    votes: Math.round(baseScore),
    detail: passed
      ? `民主推荐通过，得票${Math.round(baseScore)}分，进入组织考察名单`
      : `民主推荐未通过，得票${Math.round(baseScore)}分，未进入前2名`,
    flaggedForRisk: flaggedForRisk || undefined,
  };
}

/**
 * 阶段2 — 组织考察。
 *
 * 得分 = 政绩×0.3 + 能力×0.3 + 考核得分×0.2 + 廉洁×0.2
 * 玩家可引导考察组（消耗 politicalCapital，加 8 分）。
 *
 * @param ctx     晋升上下文
 * @param choices 玩家选择 { influenceInspectors }
 * @param cfg     晋升配置常量
 * @returns 考察结论 + 详情
 */
export function resolveOrgInspection(
  ctx: PromotionContext,
  choices: { influenceInspectors?: boolean },
  cfg: GameConfig,
): {
  passed: boolean;
  result: OrgInspectResult;
  detail: string;
  politicalCost: number;
} {
  const promo = cfg.promotion.orgInspection;
  let score =
    ctx.performance * 0.3 + ctx.competence * 0.3 + ctx.playerScore * 0.2 + ctx.integrity * 0.2;

  let politicalCost = 0;

  if (choices.influenceInspectors && ctx.politicalCapital >= promo.influencePoliticalCost) {
    score += promo.influenceScoreBonus;
    politicalCost = promo.influencePoliticalCost;
  }

  let result: OrgInspectResult;
  if (score >= promo.excellentThreshold) {
    result = OrgInspectResult.Excellent;
  } else if (score >= promo.qualifiedThreshold) {
    result = OrgInspectResult.Qualified;
  } else if (score >= promo.suspendedThreshold) {
    result = OrgInspectResult.Suspended;
  } else {
    result = OrgInspectResult.Rejected;
  }

  const passed = result === OrgInspectResult.Excellent || result === OrgInspectResult.Qualified;

  return {
    passed,
    result,
    detail: `组织考察结论：${result}`,
    politicalCost,
  };
}

/**
 * 阶段3 — 多部门联审。
 *
 * 纪委（廉政审查）/ 公安 / 信访 / 审计 / 网信 五部门逐一审核。
 * corruptionRisk 影响纪委和信访的通过率。
 *
 * @param ctx 晋升上下文
 * @param cfg 晋升配置常量
 * @param rng 随机数生成器（默认 Math.random）
 * @returns 是否全过 + 各部门意见 + 详情
 */
export function resolveJointReview(
  ctx: PromotionContext,
  _cfg: GameConfig,
  rng: () => number = Math.random,
): {
  passed: boolean;
  opinions: Record<string, boolean>;
  detail: string;
} {
  const departments = ['纪委', '公安', '信访', '审计', '网信'];
  const opinions: Record<string, boolean> = {};

  for (const dept of departments) {
    if (dept === '纪委') {
      opinions[dept] = ctx.corruptionRisk < 50;
    } else if (dept === '信访') {
      opinions[dept] = rng() < 1 - ctx.corruptionRisk / 200;
    } else {
      opinions[dept] = rng() < 0.85;
    }
  }

  const passed = Object.values(opinions).every((v) => v);
  const failedDepts = Object.entries(opinions)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    passed,
    opinions,
    detail: passed ? '多部门联审全部通过' : `${failedDepts.join('、')}出具负面意见，提拔程序终止`,
  };
}

/**
 * 从派系声望计算惩罚值。
 *
 * 对立派系的声望加权求和得到负向影响。
 * 目前为简化实现：声望越高对立派系，惩罚越大。
 *
 * @param factionReputation 各派系声望
 * @returns 惩罚分（0~30）
 */
export function calculateFactionPenalty(factionReputation: Record<string, number>): number {
  const reputations = Object.values(factionReputation).filter((v) => v > 0);
  if (reputations.length <= 1) return 0;

  const sorted = [...reputations].sort((a, b) => b - a);
  const max = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;

  return Math.round(((max - second) / 100) * 15);
}
