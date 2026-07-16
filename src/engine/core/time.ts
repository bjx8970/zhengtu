/**
 * 时间推进引擎
 *
 * 核心职责：
 * 1. 按天数推进游戏时间（每月固定30天，每年12个月）
 * 2. 检测周期边界并生成对应的 TimeTrigger（月度结算/年度考核/两会/退休……）
 * 3. 提供辅助函数：年龄、退休倒计时、跨年判断等
 *
 * 纯函数，不引用全局状态。所有依赖通过参数传入。
 */

import type { TimeState, TimeAdvanceResult, TimeTrigger } from '../../types/game';

const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const RETIREMENT_AGE = 65;

/**
 * 推进游戏时间，逐天检测周期事件。
 *
 * @param current         当前时间状态
 * @param days            推进天数
 * @param playerBirthYear 玩家出生年份（用于退休检测）
 * @param playerLevel     玩家当前级别（用于舆情生成判断：rank4+ 触发）
 * @returns 新时间状态 + 触发的周期事件列表
 */
export function advanceTime(
  current: TimeState,
  days: number,
  playerBirthYear: number,
  playerLevel: number,
): TimeAdvanceResult {
  if (days < 0) {
    throw new Error('Cannot advance by negative days');
  }

  const triggers: TimeTrigger[] = [];
  let { year, month, day } = current;
  const oldYear = year;

  // 逐天推进，边界检测
  for (let i = 0; i < days; i++) {
    day++;
    if (day > DAYS_PER_MONTH) {
      day = 1;
      month++;
      triggers.push({ type: 'monthly_settlement', month });

      // rank4+ 每月触发舆情生成
      if (playerLevel >= 4) {
        triggers.push({ type: 'sentiment_generate', count: 1 });
      }

      if (month > MONTHS_PER_YEAR) {
        month = 1;
        year++;
        triggers.push({ type: 'annual_assessment', year });

        // 每5年触发两会/党代会
        if (year % 5 === 0) {
          triggers.push({ type: 'congress_cycle', year });
        }

        // 65岁强制退休检测
        if (year - playerBirthYear >= RETIREMENT_AGE) {
          triggers.push({ type: 'retirement_check' });
        }
      }
    }
  }

  return {
    newState: { year: Math.max(year, oldYear), month, day },
    triggers,
  };
}

/** 判断是否跨越了月（新日=1 且 旧日>1） */
export function isCrossMonth(current: TimeState, newDay: number): boolean {
  return newDay === 1 && current.day > newDay;
}

/** 判断结果年 > 当前年 */
export function isCrossYear(current: TimeState, result: TimeState): boolean {
  return result.year > current.year;
}

/** 判断是否为两会/党代会年份 */
export function isCongressYear(year: number): boolean {
  return year % 5 === 0;
}

/** 计算当前年龄 */
export function getAge(gameYear: number, birthYear: number): number {
  return gameYear - birthYear;
}

/** 计算距离退休的倒计时年数 */
export function getRetirementCountdown(gameYear: number, birthYear: number): number {
  return Math.max(RETIREMENT_AGE - getAge(gameYear, birthYear), 0);
}
