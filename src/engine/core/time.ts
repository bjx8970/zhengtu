/**
 * 时间推进引擎
 *
 * 核心职责：
 * 1. 按天数推进游戏时间（每月天数、每年月数从 GameConfig 读取）
 * 2. 检测周期边界并生成对应的 TimeTrigger
 * 3. 提供辅助函数：年龄、退休倒计时、跨年判断等
 *
 * 纯函数，所有配置通过参数传入。
 */

import type { TimeState, TimeAdvanceResult, TimeTrigger } from '../../types/game';
import type { GameConfig } from '../../types/config';

/**
 * 推进游戏时间，逐天检测周期事件。
 *
 * @param current         当前时间状态
 * @param days            推进天数
 * @param playerBirthYear 玩家出生年份（用于退休检测）
 * @param playerLevel     玩家当前级别（用于舆情生成判断）
 * @param config          游戏配置常量
 * @returns 新时间状态 + 触发的周期事件列表
 */
export function advanceTime(
  current: TimeState,
  days: number,
  playerBirthYear: number,
  playerLevel: number,
  config: GameConfig,
): TimeAdvanceResult {
  if (days < 0) {
    throw new Error('Cannot advance by negative days');
  }

  const triggers: TimeTrigger[] = [];
  let { year, month, day } = current;

  for (let i = 0; i < days; i++) {
    day++;
    if (day > config.daysPerMonth) {
      day = 1;
      month++;
      triggers.push({ type: 'monthly_settlement', month });

      if (playerLevel >= config.sentimentMinLevel) {
        triggers.push({ type: 'sentiment_generate', count: 1 });
      }

      if (month > config.monthsPerYear) {
        month = 1;
        year++;
        triggers.push({ type: 'annual_assessment', year });

        if (year % config.congressCycleYears === 0) {
          triggers.push({ type: 'congress_cycle', year });
        }

        if (year - playerBirthYear >= config.retirementAge) {
          triggers.push({ type: 'retirement_check' });
        }
      }
    }
  }

  return {
    newState: { year, month, day },
    triggers,
  };
}

/** 判断是否跨越了月（新日=1 且 旧日>1） */
export function isCrossMonth(_current: TimeState, _newDay: number): boolean {
  return _newDay === 1 && _current.day > _newDay;
}

/** 判断结果年 > 当前年 */
export function isCrossYear(_current: TimeState, _result: TimeState): boolean {
  return _result.year > _current.year;
}

/**
 * 判断是否为两会/党代会年份。
 *
 * @param year               年份
 * @param congressCycleYears 周期年数
 */
export function isCongressYear(year: number, congressCycleYears: number): boolean {
  return year % congressCycleYears === 0;
}

/** 计算当前年龄 */
export function getAge(gameYear: number, birthYear: number): number {
  return gameYear - birthYear;
}

/**
 * 计算距离退休的倒计时年数。
 *
 * @param gameYear      当前游戏年份
 * @param birthYear     出生年份
 * @param retirementAge 退休年龄
 */
export function getRetirementCountdown(
  gameYear: number,
  birthYear: number,
  retirementAge: number,
): number {
  return Math.max(retirementAge - getAge(gameYear, birthYear), 0);
}

/**
 * 根据推进粒度返回对应天数。
 *
 * @param granularity 推进粒度
 * @param config      游戏配置
 */
export function getGranularityDays(
  granularity: 'day' | 'week' | 'month',
  config: GameConfig,
): number {
  if (granularity === 'day') return 1;
  if (granularity === 'week') return 7;
  return config.daysPerMonth;
}
