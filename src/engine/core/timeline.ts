/**
 * 统一时间轴引擎
 *
 * 核心模块：将时间推进过程中所有事件（行动完成、月度结算、
 * 年度考核、政治周期）按绝对发生日排序，确保结算顺序正确。
 *
 * 设计原则：
 * - 以 totalDaysPlayed 为唯一绝对日坐标（从开局第 0 天起算）
 * - 行动完成 → 月度结算 → 年度考核 → 政治周期（严格按时间顺序）
 * - 同一天内的事件按类型优先级排序
 * - 月度事件的 month/year 表示"刚结束的月份"
 * - 纯函数，不修改输入参数
 */

import type { TimeState, TimelineEvent } from '../../types/game';
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

/** advanceTimeline 的返回值 */
export interface AdvanceTimelineResult {
  /** 推进后的最终时间状态 */
  newTime: TimeState;
  /** 推进后的绝对日（= startAbsoluteDay + advanceDays） */
  newAbsoluteDay: number;
  /** 按时间排序的事件列表 */
  events: TimelineEvent[];
}

/**
 * 统一时间推进：一次返回最终时间、最终绝对日和排序事件。
 *
 * 替代旧版 advanceTime() + generateTimelineEvents() 的双实现。
 * 绝对日坐标以 totalDaysPlayed 为唯一纪元。
 *
 * @param currentTime 当前时间状态
 * @param advanceDays 推进天数
 * @param startAbsoluteDay 推进起始的绝对日（= draft.totalDaysPlayed）
 * @param slotState 当前槽位状态（用于检测行动完成）
 * @param playerBirthYear 玩家出生年份
 * @param config 游戏配置
 * @returns 最终时间 + 最终绝对日 + 排序事件
 */
export function advanceTimeline(
  currentTime: TimeState,
  advanceDays: number,
  startAbsoluteDay: number,
  slotState: SlotState,
  playerBirthYear: number,
  config: GameConfig,
): AdvanceTimelineResult {
  if (advanceDays < 0) {
    throw new Error('Cannot advance by negative days');
  }

  const events: TimelineEvent[] = [];

  // 1. 收集行动完成事件
  const tierKeys: SlotTierKey[] = ['primary', 'secondary', 'reserve'];
  for (const tierKey of tierKeys) {
    const tier = slotState[tierKey];
    if (!tier) continue;
    for (let i = 0; i < tier.occupants.length; i++) {
      const occupant = tier.occupants[i];
      if (!occupant) continue;
      const completionDay = occupant.startedAtDay + occupant.durationDays;
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

  // 2. 逐天推进检测周期边界
  let { year, month, day } = currentTime;
  let absDay = startAbsoluteDay;

  for (let i = 0; i < advanceDays; i++) {
    day++;
    absDay++;

    if (day > config.daysPerMonth) {
      day = 1;
      // 月度事件：month/year 表示刚结束的月份
      const endedMonth = month;
      const endedYear = year;
      month++;

      events.push({
        type: 'monthly_settlement',
        absoluteDay: absDay,
        month: endedMonth,
        year: endedYear,
      });

      if (month > config.monthsPerYear) {
        month = 1;
        year++;

        events.push({
          type: 'annual_assessment',
          absoluteDay: absDay,
          year: endedYear,
        });

        if (year % config.congressCycleYears === 0) {
          events.push({
            type: 'political_cycle',
            absoluteDay: absDay,
            year,
          });
        }

        if (year - playerBirthYear >= config.retirementAge) {
          events.push({
            type: 'retirement_check',
            absoluteDay: absDay,
          });
        }
      }
    }
  }

  // 3. 排序：先按绝对日，同天按类型优先级
  events.sort((a, b) => {
    if (a.absoluteDay !== b.absoluteDay) return a.absoluteDay - b.absoluteDay;
    return EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type];
  });

  return {
    newTime: { year, month, day },
    newAbsoluteDay: startAbsoluteDay + advanceDays,
    events,
  };
}
