/**
 * 高考分数生成与判定引擎
 *
 * 纯函数，用于建档流程中：
 * 1. 根据省份统计参数生成正态分布随机高考分数
 * 2. 根据省份分数线判定院校档次
 * 3. 处理民族加分和预科班特殊规则
 *
 * 所有阈值来自 regions.json，通过参数传入。
 */

import { normalRandom } from './math';
import type { ProvinceConfig } from '../types/config';

/** 高考分数生成结果 */
export interface GaokaoResult {
  /** 原始分数（不含加分） */
  rawScore: number;
  /** 含民族加分的有效分数 */
  effectiveScore: number;
  /** 民族加分 */
  ethnicBonus: number;
  /** 判定档次（985 / 211 / 本科 / 专科） */
  tier: string;
  /** 该档次分数线 */
  tierThreshold: number;
  /** 是否可申请预科班 */
  canPreparatory: boolean;
  /** 所有档次分数线 */
  thresholds: Record<string, number>;
}

/**
 * 生成一次高考成绩。
 *
 * @param province 省份配置
 * @returns 分数 + 档次判定结果
 */
export function generateGaokaoScore(province: ProvinceConfig): GaokaoResult {
  const dist = province.scoreDistribution;
  const rawScore = Math.round(normalRandom(dist.mean, dist.stddev));
  const clampedScore = Math.max(dist.minScore, Math.min(dist.maxScore, rawScore));
  const ethnicBonus = province.ethnicBonus;
  const effectiveScore = clampedScore + ethnicBonus;

  return determineTier(clampedScore, effectiveScore, ethnicBonus, province);
}

/**
 * 根据分数判定院校档次。
 *
 * @param rawScore       原始分数
 * @param effectiveScore 有效分数（含民族加分）
 * @param ethnicBonus    民族加分
 * @param province       省份配置
 * @returns 档次判定结果
 */
export function determineTier(
  rawScore: number,
  effectiveScore: number,
  ethnicBonus: number,
  province: ProvinceConfig,
): GaokaoResult {
  const thresholds = province.gaokaoThresholds;
  const tierOrder = ['985', '211', '本科', '专科'];

  let tier = '专科';
  let tierThreshold = thresholds['专科'] ?? 200;

  for (const t of tierOrder) {
    if (effectiveScore >= (thresholds[t] ?? 0)) {
      tier = t;
      tierThreshold = thresholds[t] ?? 0;
      break;
    }
  }

  return {
    rawScore,
    effectiveScore,
    ethnicBonus,
    tier,
    tierThreshold,
    canPreparatory: province.hasPreparatoryProgram,
    thresholds,
  };
}

/**
 * 获取可选的院校档次列表（从最高可达档次向下至专科）。
 *
 * @param tier 最高可达档次
 * @returns 可选档次名称数组
 */
export function getAvailableTiers(tier: string): string[] {
  const tierOrder = ['985', '211', '本科', '专科', '预科'];
  const startIdx = tierOrder.indexOf(tier);
  if (startIdx < 0) return [];
  return tierOrder.slice(startIdx);
}
