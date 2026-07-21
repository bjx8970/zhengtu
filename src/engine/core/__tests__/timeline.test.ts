/**
 * 统一时间轴引擎测试
 *
 * 覆盖场景：
 * - 事件按绝对日排序
 * - 同一天内按类型优先级排序（行动完成 < 月度结算 < 年度考核）
 * - 月度事件 month 表示刚结束的月份（不出现 month=13）
 * - 跨月、跨年场景
 * - 并发行动各自独立
 * - 年末行动完成在年度考核之前
 */
import { describe, it, expect } from 'vitest';
import { advanceTimeline } from '../timeline';
import type { SlotState } from '../../../types/player';
import { getConfigLoader } from '../../../config/loader';

const cfg = getConfigLoader().getGameConfig();

/** 创建空槽位状态 */
function makeEmptySlots(): SlotState {
  return {
    primary: { label: '主要', count: 3, occupants: [null, null, null] },
    secondary: { label: '次要', count: 2, occupants: [null, null] },
    reserve: { label: '备用', count: 1, occupants: [null] },
  };
}

describe('advanceTimeline', () => {
  it('空槽位推进一个月只产生月度结算事件', () => {
    const result = advanceTimeline(
      { year: 2024, month: 1, day: 1 },
      30,
      0,
      makeEmptySlots(),
      1990,
      cfg,
    );

    const monthlyEvents = result.events.filter((e) => e.type === 'monthly_settlement');
    expect(monthlyEvents.length).toBe(1);
    // 月度事件的 month 表示刚结束的月份
    if (monthlyEvents[0]!.type === 'monthly_settlement') {
      expect(monthlyEvents[0]!.month).toBe(1);
      expect(monthlyEvents[0]!.year).toBe(2024);
    }
    // 最终时间正确
    expect(result.newTime).toEqual({ year: 2024, month: 2, day: 1 });
    expect(result.newAbsoluteDay).toBe(30);
  });

  it('行动完成事件在月度结算之前（同一天）', () => {
    const slots = makeEmptySlots();
    slots.primary.occupants[0] = {
      actionId: 'test',
      deptId: 'dept',
      actionName: '测试',
      category: 'minor',
      startedAtDay: 27,
      durationDays: 3, // 第 30 天完成（月末）
      cooldownDays: 7,
    };

    const result = advanceTimeline({ year: 2024, month: 1, day: 1 }, 30, 0, slots, 1990, cfg);

    const actionEvent = result.events.find((e) => e.type === 'action_completion');
    const monthlyEvent = result.events.find((e) => e.type === 'monthly_settlement');

    expect(actionEvent).toBeDefined();
    expect(monthlyEvent).toBeDefined();

    const actionIdx = result.events.indexOf(actionEvent!);
    const monthlyIdx = result.events.indexOf(monthlyEvent!);
    expect(actionIdx).toBeLessThan(monthlyIdx);
  });

  it('跨月推进产生正确数量的月度结算且 month 合法', () => {
    const result = advanceTimeline(
      { year: 2024, month: 1, day: 1 },
      90,
      0,
      makeEmptySlots(),
      1990,
      cfg,
    );

    const monthlyEvents = result.events.filter((e) => e.type === 'monthly_settlement');
    expect(monthlyEvents.length).toBe(3);

    // 所有月度事件的 month 都在 1-12 范围内
    for (const event of monthlyEvents) {
      if (event.type === 'monthly_settlement') {
        expect(event.month).toBeGreaterThanOrEqual(1);
        expect(event.month).toBeLessThanOrEqual(12);
      }
    }
  });

  it('跨年推进产生年度考核且 month 不为 13', () => {
    const result = advanceTimeline(
      { year: 2024, month: 1, day: 1 },
      360,
      0,
      makeEmptySlots(),
      1990,
      cfg,
    );

    const annualEvents = result.events.filter((e) => e.type === 'annual_assessment');
    expect(annualEvents.length).toBe(1);

    // 验证没有 month=13 的事件
    const monthlyEvents = result.events.filter((e) => e.type === 'monthly_settlement');
    for (const event of monthlyEvents) {
      if (event.type === 'monthly_settlement') {
        expect(event.month).not.toBe(13);
      }
    }

    // 年度考核的 year 表示刚结束的年份
    if (annualEvents[0]!.type === 'annual_assessment') {
      expect(annualEvents[0]!.year).toBe(2024);
    }
  });

  it('多个并发行动各自产生独立事件并按时间排序', () => {
    const slots = makeEmptySlots();
    slots.primary.occupants[0] = {
      actionId: 'action1',
      deptId: 'dept1',
      actionName: '行动1',
      category: 'minor',
      startedAtDay: 0,
      durationDays: 5,
      cooldownDays: 7,
    };
    slots.primary.occupants[1] = {
      actionId: 'action2',
      deptId: 'dept2',
      actionName: '行动2',
      category: 'minor',
      startedAtDay: 0,
      durationDays: 10,
      cooldownDays: 7,
    };

    const result = advanceTimeline({ year: 2024, month: 1, day: 1 }, 15, 0, slots, 1990, cfg);

    const actionEvents = result.events.filter((e) => e.type === 'action_completion');
    expect(actionEvents.length).toBe(2);
    expect(actionEvents[0]!.absoluteDay).toBe(5);
    expect(actionEvents[1]!.absoluteDay).toBe(10);
  });

  it('行动完成在年度考核之前（年末场景）', () => {
    const slots = makeEmptySlots();
    slots.primary.occupants[0] = {
      actionId: 'year_end_action',
      deptId: 'dept',
      actionName: '年末行动',
      category: 'minor',
      startedAtDay: 357,
      durationDays: 3, // 第 360 天完成
      cooldownDays: 7,
    };

    const result = advanceTimeline({ year: 2024, month: 1, day: 1 }, 360, 0, slots, 1990, cfg);

    const actionEvent = result.events.find((e) => e.type === 'action_completion');
    const annualEvent = result.events.find((e) => e.type === 'annual_assessment');

    expect(actionEvent).toBeDefined();
    expect(annualEvent).toBeDefined();

    const actionIdx = result.events.indexOf(actionEvent!);
    const annualIdx = result.events.indexOf(annualEvent!);
    expect(actionIdx).toBeLessThan(annualIdx);
  });

  it('推进 0 天不产生事件', () => {
    const result = advanceTimeline(
      { year: 2024, month: 6, day: 15 },
      0,
      100,
      makeEmptySlots(),
      1990,
      cfg,
    );

    expect(result.events.length).toBe(0);
    expect(result.newTime).toEqual({ year: 2024, month: 6, day: 15 });
    expect(result.newAbsoluteDay).toBe(100);
  });

  it('负天数抛出异常', () => {
    expect(() =>
      advanceTimeline({ year: 2024, month: 1, day: 1 }, -1, 0, makeEmptySlots(), 1990, cfg),
    ).toThrow('Cannot advance by negative days');
  });
});
