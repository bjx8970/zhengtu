/**
 * 公务员累计服务年限计算。
 *
 * 合并当前任职与历史履历的重叠区间，避免同一任职同时存在于两处时重复计时。
 */

import type { CareerExperience, CurrentAppointment } from '../../domain/career/state';

/**
 * 计算去重后的公务员职业服务天数。
 *
 * @param appointment 当前任职
 * @param experiences 历史与当前职业履历
 * @param currentDay 当前绝对日
 * @returns 合并重叠区间后的累计服务天数
 */
export function calculateCareerServiceDays(
  appointment: CurrentAppointment,
  experiences: readonly CareerExperience[],
  currentDay: number,
): number {
  const intervals = [
    ...experiences.map((item) => [item.startedAtDay, item.endedAtDay ?? currentDay] as const),
    [appointment.startedAtDay, currentDay] as const,
  ]
    .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && end >= start)
    .sort(([left], [right]) => left - right);
  let total = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (const [nextStart, nextEnd] of intervals) {
    if (start === null || end === null) {
      start = nextStart;
      end = nextEnd;
      continue;
    }
    if (nextStart > end) {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    } else end = Math.max(end, nextEnd);
  }
  return start === null || end === null ? 0 : total + end - start;
}
