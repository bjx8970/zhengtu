/** 每日政治周期节点顺序与去重回归。 */
import { describe, expect, it } from 'vitest';
import { buildDailyTimelinePlan } from '../daily-timeline-plan';

describe('daily political cycle plan', () => {
  it('leaves first creation to the congress event', () => {
    expect(buildDailyTimelinePlan(1, []).some((node) => node.type === 'political_cycle')).toBe(
      false,
    );
  });

  it('adds a daily node for an existing cycle', () => {
    expect(buildDailyTimelinePlan(91, [], 2015).at(-1)).toEqual({
      type: 'political_cycle',
      absoluteDay: 91,
      year: 2015,
    });
  });

  it('deduplicates congress day and preserves settlement order', () => {
    const nodes = buildDailyTimelinePlan(
      1800,
      [
        { type: 'political_cycle', absoluteDay: 1800, year: 2020 },
        { type: 'annual_assessment', absoluteDay: 1800, year: 2019 },
        { type: 'monthly_settlement', absoluteDay: 1800, month: 12, year: 2019 },
      ],
      2020,
    );
    expect(nodes.filter((node) => node.type === 'political_cycle')).toHaveLength(1);
    expect(nodes.slice(-3).map((node) => node.type)).toEqual([
      'monthly_settlement',
      'annual_assessment',
      'political_cycle',
    ]);
  });
});
