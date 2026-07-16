/**
 * 晋升引擎 — 六阶段状态机（阶段 4~6）
 *
 * 核心职责：
 * 1. resolveCommitteeVote — 常委会票决
 * 2. resolvePublicNotice — 任前公示
 * 3. resolveProbation — 试用期考察
 *
 * 所有函数为纯函数，rng 参数用于注入随机数生成器。
 * 阶段 0~3 见 promotion.ts。
 */

import type { PromotionContext } from '../../types/game';
import type { GameConfig } from '../../types/config';

/**
 * 阶段4 — 常委会票决。
 *
 * 常委人数 = min(7 + floor(level/interval) * sizePerLevel, maxSize)
 * 赞成率 = (平均派系声望 + 上司好感) / 200 - 派系惩罚
 * 每张票独立模拟，赞成过半即通过。
 *
 * @param ctx 晋升上下文
 * @param cfg 晋升配置常量
 * @param rng 随机数生成器（默认 Math.random）
 * @returns 是否通过 + 赞成/反对票数 + 详情
 */
export function resolveCommitteeVote(
  ctx: PromotionContext,
  cfg: GameConfig,
  rng: () => number = Math.random,
): {
  passed: boolean;
  forVotes: number;
  againstVotes: number;
  detail: string;
} {
  const comm = cfg.promotion.committeeVote;
  const committeeSize = Math.min(
    comm.minSize +
      Math.floor(ctx.playerLevel / comm.sizePerLevelInterval) * comm.sizePerLevelInterval,
    comm.maxSize,
  );

  const avgReputation =
    Object.values(ctx.factionReputation).reduce((a, b) => a + b, 0) /
    Math.max(Object.keys(ctx.factionReputation).length, 1);

  const approvalRate = (avgReputation + ctx.superiorFavor) / 200;

  const factionPenalty = calculateFactionDisparity(ctx.factionReputation) / 100;
  const finalRate = Math.max(approvalRate - factionPenalty, 0.1);

  let forVotes = 0;
  for (let i = 0; i < committeeSize; i++) {
    if (rng() < finalRate) forVotes++;
  }

  const againstVotes = committeeSize - forVotes;
  const passed = forVotes > committeeSize / 2;

  return {
    passed,
    forVotes,
    againstVotes,
    detail: passed
      ? `常委会票决通过（${forVotes}:${againstVotes}）`
      : `常委会票决未通过（${forVotes}:${againstVotes}），本次晋升失败`,
  };
}

/**
 * 阶段5 — 任前公示。
 *
 * 实名举报概率 = corruptionRisk × complaintProbPerRisk
 * 舆情发酵概率 = corruptionRisk × sentimentProbPerRisk
 *
 * @param ctx 晋升上下文
 * @param cfg 晋升配置常量
 * @param rng 随机数生成器（默认 Math.random）
 * @returns 是否通过 + 举报/舆情标志 + 详情
 */
export function resolvePublicNotice(
  ctx: PromotionContext,
  cfg: GameConfig,
  rng: () => number = Math.random,
): {
  passed: boolean;
  hasComplaint: boolean;
  sentimentEscalated: boolean;
  detail: string;
} {
  const notice = cfg.promotion.publicNotice;
  const hasComplaint = rng() < ctx.corruptionRisk * notice.complaintProbPerRisk;
  const sentimentEscalated = rng() < ctx.corruptionRisk * notice.sentimentProbPerRisk;

  if (sentimentEscalated) {
    return {
      passed: false,
      hasComplaint,
      sentimentEscalated,
      detail: '网络舆情大面积发酵，撤销拟任决定',
    };
  }
  if (hasComplaint) {
    return {
      passed: false,
      hasComplaint,
      sentimentEscalated,
      detail: '公示期间收到实名举报，暂停任命并重新核查',
    };
  }
  return {
    passed: true,
    hasComplaint: false,
    sentimentEscalated: false,
    detail: '公示5个工作日无异议，进入正式任命',
  };
}

/**
 * 阶段6 — 试用期考核。
 *
 * 得分 = 能力×0.5 + 考核得分×0.3 + 随机因素×0.2 (0~20)
 *
 * @param ctx 晋升上下文
 * @param cfg 晋升配置常量
 * @param rng 随机数生成器（默认 Math.random）
 * @returns 是否通过 + 详情
 */
export function resolveProbation(
  ctx: PromotionContext,
  cfg: GameConfig,
  rng: () => number = Math.random,
): {
  passed: boolean;
  detail: string;
} {
  const probation = cfg.promotion.probation;
  const score = ctx.competence * 0.5 + ctx.playerScore * 0.3 + rng() * 20;
  const passed = score >= probation.passThreshold;

  return {
    passed,
    detail: passed ? '一年试用期考核合格，正式定岗' : '试用期考核不合格，降回原职级',
  };
}

/**
 * 根据派系声望差异计算常委会惩罚系数。
 *
 * @param factionReputation 各派系声望记录
 * @returns 惩罚系数（0~15）
 */
function calculateFactionDisparity(factionReputation: Record<string, number>): number {
  const reputations = Object.values(factionReputation).filter((v) => v > 0);
  if (reputations.length <= 1) return 0;

  const sorted = [...reputations].sort((a, b) => b - a);
  const max = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;

  return Math.round(((max - second) / 100) * 15);
}
