/**
 * 统一时间轴引擎
 *
 * v4 基础工程核心模块：将时间推进过程中所有事件（行动完成、月度结算、
 * 年度考核、政治周期）按绝对发生日排序，确保结算顺序正确。
 *
 * 设计原则：
 * - 行动完成 → 月度结算 → 年度考核 → 政治周期（严格按时间顺序）
 * - 同一天内的事件按类型优先级排序
 * - 纯函数，不修改输入参数
 */

import type { TimeState, TimelineEvent, TimeTrigger } from '../../types/game';
import type { SlotState, SlotOccupant, SlotTierKey } from '../../types/player';
import type { GameConfig } from '../../types/config';

/** 同一天内事件类型的处理优先级（数值越小越先处理） */
const EVENT_PRIORITY: Record<TimelineEvent['type'], number> = {
  action_completion: 0,
  monthly_settlement: 1,
  annual_assessment: 2,
  political_cycle: 3,
  retirement_check: 4,
};

/**
 * 计算时间推进的绝对天数偏移。
 *
 * @param startDay 起始绝对日
 * @param time 当前时间状态
 * @param config 游戏配置
 * @returns 当前时间对应的绝对日
 */
export function timeToAbsoluteDay(time: TimeState, config: GameConfig): number {
  return (
    (time.year - 1) * config.monthsPerYear * config.daysPerMonth +
    (time.month - 1) * config.daysPerMonth +
    (time.day - 1)
  );
}

/**
 * 将绝对日转换回时间状态。
 *
 * @param absoluteDay 绝对日
 * @param config 游戏配置
 * @returns 时间状态
 */
export function absoluteDayToTime(absoluteDay: number, config: GameConfig): TimeState {
  const totalDays = config.daysPerMonth;
  const totalMonths = config.monthsPerYear;

  const day = (absoluteDay % totalDays) + 1;
  const monthIndex = Math.floor(absoluteDay / totalDays);
  const month = (monthIndex % totalMonths) + 1;
  const year = Math.floor(monthIndex / totalMonths) + 1;

  return { year, month, day };
}

/**
 * 生成时间推进期间的所有时间轴事件，按绝对日排序。
 *
 * 核心逻辑：
 * 1. 逐天推进，检测月度/年度边界
 * 2. 检测行动完成时间点
 * 3. 所有事件按 absoluteDay 排序，同天按类型优先级排序
 *
 * @param currentTime 当前时间状态
 * @param advanceDays 推进天数
 * @param startAbsoluteDay 推进起始的绝对日
 * @param slotState 当前槽位状态（用于检测行动完成）
 * @param playerBirthYear 玩家出生年份
 * @param playerLevel 玩家当前级别
 * @param config 游戏配置
 * @returns 排序后的时间轴事件列表
 */
export function generateTimelineEvents(
  currentTime: TimeState,
  advanceDays: number,
  startAbsoluteDay: number,
  slotState: SlotState,
  playerBirthYear: number,
  _playerLevel: number,
  config: GameConfig,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // 收集行动完成事件
  const tierKeys: SlotTierKey[] = ['primary', 'secondary', 'reserve'];
  for (const tierKey of tierKeys) {
    const tier = slotState[tierKey];
    if (!tier) continue;
    for (let i = 0; i < tier.occupants.length; i++) {
      const occupant = tier.occupants[i];
      if (!occupant) continue;
      const completionDay = occupant.startedAtDay + occupant.durationDays;
      // 只收集在本次推进范围内完成的事件
      if (completionDay > startAbsoluteDay && completionDay <= startAbsoluteDay + advanceDays) {
        events.push({
          type: 'action_completion',
          absoluteDay: completionDay,
          tierKey,
          slotIndex: i,
          occupant: occupant as SlotOccupant,
        });
      }
    }
  }

  // 逐天推进检测周期事件
  let { year, month, day } = currentTime;
  let currentAbsoluteDay = startAbsoluteDay;

  for (let i = 0; i < advanceDays; i++) {
    day++;
    currentAbsoluteDay++;

    if (day > config.daysPerMonth) {
      day = 1;
      month++;

      // 月度结算事件
      events.push({
        type: 'monthly_settlement',
        absoluteDay: currentAbsoluteDay,
        month,
        year,
      });

      if (month > config.monthsPerYear) {
        month = 1;
        year++;

        // 年度考核事件
        events.push({
          type: 'annual_assessment',
          absoluteDay: currentAbsoluteDay,
          year,
        });

        // 政治周期事件
        if (year % config.congressCycleYears === 0) {
          events.push({
            type: 'political_cycle',
            absoluteDay: currentAbsoluteDay,
            year,
          });
        }

        // 退休检测事件
        if (year - playerBirthYear >= config.retirementAge) {
          events.push({
            type: 'retirement_check',
            absoluteDay: currentAbsoluteDay,
          });
        }
      }
    }
  }

  // 排序：先按绝对日，同天按类型优先级
  events.sort((a, b) => {
    if (a.absoluteDay !== b.absoluteDay) {
      return a.absoluteDay - b.absoluteDay;
    }
    return EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type];
  });

  return events;
}

/**
 * 将旧版 TimeTrigger 列表转换为时间轴事件（兼容层）。
 *
 * @param triggers 旧版触发器列表
 * @param startAbsoluteDay 起始绝对日
 * @param config 游戏配置
 * @returns 时间轴事件列表
 */
export function triggersToTimelineEvents(
  triggers: TimeTrigger[],
  startAbsoluteDay: number,
  _config: GameConfig,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const trigger of triggers) {
    switch (trigger.type) {
      case 'monthly_settlement':
        events.push({
          type: 'monthly_settlement',
          absoluteDay: startAbsoluteDay, // 简化：使用起始日
          month: trigger.month ?? 1,
          year: trigger.year ?? 1,
        });
        break;
      case 'annual_assessment':
        events.push({
          type: 'annual_assessment',
          absoluteDay: startAbsoluteDay,
          year: trigger.year ?? 1,
        });
        break;
      case 'congress_cycle':
        events.push({
          type: 'political_cycle',
          absoluteDay: startAbsoluteDay,
          year: trigger.year ?? 1,
        });
        break;
      case 'retirement_check':
        events.push({
          type: 'retirement_check',
          absoluteDay: startAbsoluteDay,
        });
        break;
      default:
        // sentiment_generate 等暂不处理
        break;
    }
  }

  return events;
}
