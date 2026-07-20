/**
 * 晋升引擎 — 六阶段状态机（阶段 3~6）
 *
 * 核心职责：
 * 1. resolveJointReview — 多部门联审（纪委/公安/信访/审计/网信）
 * 2. resolveCommitteeVote — 常委会票决
 * 3. resolvePublicNotice — 任前公示
 * 4. resolveProbation — 试用期考察
 *
 * 所有函数为纯函数，rng 参数用于注入随机数生成器。
 * 阶段 0~2 见 promotion.ts。
 */

import type { PromotionContext } from '../../types/game';
import type { GameConfig } from '../../types/config';
import { calculateStyleFuzzinessPenalty } from './philosophy-imbalance';

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
  cfg: GameConfig,
  rng: () => number = Math.random,
): {
  passed: boolean;
  opinions: Record<string, boolean>;
  detail: string;
} {
  const jr = cfg.promotion.jointReview;
  const departments = ['纪委', '公安', '信访', '审计', '网信'];
  const opinions: Record<string, boolean> = {};

  for (const dept of departments) {
    if (dept === '纪委') {
      opinions[dept] = ctx.corruptionRisk < jr.disciplineCorruptionThreshold;
    } else if (dept === '信访') {
      opinions[dept] = rng() < 1 - ctx.corruptionRisk / 200;
    } else {
      opinions[dept] = rng() < jr.otherDepartmentsPassRate;
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
 * 阶段4 — 常委会票决。
 *
 * 常委人数 = min(7 + floor(level/interval) * sizePerLevel, maxSize)
 * 赞成率 = 平均风格评分 / 100 - 风格失衡修正
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

  const avgStyleScore =
    Object.values(ctx.styleScores).reduce((a, b) => a + b, 0) /
    Math.max(Object.keys(ctx.styleScores).length, 1);

  const approvalRate = avgStyleScore / 100;

  const fuzziness = calculateStyleFuzzinessPenalty(ctx.styleScores);
  const finalRate = Math.max(approvalRate - fuzziness, 0.1);

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
