/**
 * 统一时间轴引擎测试
 *
 * 覆盖场景：
 * - 事件按绝对日排序
 * - 同一天内按类型优先级排序
 * - 行动完成在月度结算之前
 * - 跨月、跨年场景
 * - 并发行动各自独立
 */
import { describe, it, expect } from 'vitest';
import { generateTimelineEvents, timeToAbsoluteDay, absoluteDayToTime } from '../timeline';
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

describe('统一时间轴引擎', () => {
  describe('timeToAbsoluteDay / absoluteDayToTime', () => {
    it('正确转换时间到绝对日', () => {
      // 第 1 年 1 月 1 日 = 绝对日 0
      expect(timeToAbsoluteDay({ year: 1, month: 1, day: 1 }, cfg)).toBe(0);
      // 第 1 年 1 月 30 日 = 绝对日 29
      expect(timeToAbsoluteDay({ year: 1, month: 1, day: 30 }, cfg)).toBe(29);
      // 第 1 年 2 月 1 日 = 绝对日 30
      expect(timeToAbsoluteDay({ year: 1, month: 2, day: 1 }, cfg)).toBe(30);
    });

    it('正确转换绝对日到时间', () => {
      expect(absoluteDayToTime(0, cfg)).toEqual({ year: 1, month: 1, day: 1 });
      expect(absoluteDayToTime(29, cfg)).toEqual({ year: 1, month: 1, day: 30 });
      expect(absoluteDayToTime(30, cfg)).toEqual({ year: 1, month: 2, day: 1 });
    });

    it('往返转换保持一致', () => {
      const time = { year: 2024, month: 6, day: 15 };
      const absDay = timeToAbsoluteDay(time, cfg);
      const back = absoluteDayToTime(absDay, cfg);
      expect(back).toEqual(time);
    });
  });

  describe('generateTimelineEvents', () => {
    it('空槽位推进一个月只产生月度结算事件', () => {
      const slots = makeEmptySlots();
      const events = generateTimelineEvents(
        { year: 2024, month: 1, day: 1 },
        30, // 一个月
        0,
        slots,
        1990,
        1,
        cfg,
      );

      // 应该有 1 个月度结算事件
      const monthlyEvents = events.filter((e) => e.type === 'monthly_settlement');
      expect(monthlyEvents.length).toBe(1);
    });

    it('行动完成事件在月度结算之前（同一天）', () => {
      const slots = makeEmptySlots();
      // 行动在第 30 天完成（月末）
      slots.primary.occupants[0] = {
        actionId: 'test',
        deptId: 'dept',
        actionName: '测试',
        category: 'minor',
        startedAtDay: 27,
        durationDays: 3, // 第 30 天完成
        cooldownDays: 7,
      };

      const events = generateTimelineEvents(
        { year: 2024, month: 1, day: 1 },
        30,
        0,
        slots,
        1990,
        1,
        cfg,
      );

      // 找到同一天的行动完成和月度结算事件
      const actionEvent = events.find((e) => e.type === 'action_completion');
      const monthlyEvent = events.find((e) => e.type === 'monthly_settlement');

      expect(actionEvent).toBeDefined();
      expect(monthlyEvent).toBeDefined();

      // 行动完成应该排在月度结算之前
      const actionIdx = events.indexOf(actionEvent!);
      const monthlyIdx = events.indexOf(monthlyEvent!);
      expect(actionIdx).toBeLessThan(monthlyIdx);
    });

    it('跨月推进产生正确数量的月度结算', () => {
      const slots = makeEmptySlots();
      const events = generateTimelineEvents(
        { year: 2024, month: 1, day: 1 },
        90, // 三个月
        0,
        slots,
        1990,
        1,
        cfg,
      );

      const monthlyEvents = events.filter((e) => e.type === 'monthly_settlement');
      expect(monthlyEvents.length).toBe(3);
    });

    it('跨年推进产生年度考核事件', () => {
      const slots = makeEmptySlots();
      const events = generateTimelineEvents(
        { year: 2024, month: 1, day: 1 },
        360, // 12 个月
        0,
        slots,
        1990,
        1,
        cfg,
      );

      const annualEvents = events.filter((e) => e.type === 'annual_assessment');
      expect(annualEvents.length).toBe(1);
    });

    it('多个并发行动各自产生独立事件', () => {
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

      const events = generateTimelineEvents(
        { year: 2024, month: 1, day: 1 },
        15,
        0,
        slots,
        1990,
        1,
        cfg,
      );

      const actionEvents = events.filter((e) => e.type === 'action_completion');
      expect(actionEvents.length).toBe(2);

      // 第一个行动在第 5 天完成，第二个在第 10 天完成
      expect(actionEvents[0]!.absoluteDay).toBe(5);
      expect(actionEvents[1]!.absoluteDay).toBe(10);
    });

    it('行动完成在年度考核之前（年末场景）', () => {
      const slots = makeEmptySlots();
      // 行动在年末最后一天完成
      slots.primary.occupants[0] = {
        actionId: 'year_end_action',
        deptId: 'dept',
        actionName: '年末行动',
        category: 'minor',
        startedAtDay: 357, // 12*30 - 3 = 357
        durationDays: 3, // 第 360 天完成
        cooldownDays: 7,
      };

      const events = generateTimelineEvents(
        { year: 2024, month: 1, day: 1 },
        360,
        0,
        slots,
        1990,
        1,
        cfg,
      );

      const actionEvent = events.find((e) => e.type === 'action_completion');
      const annualEvent = events.find((e) => e.type === 'annual_assessment');

      expect(actionEvent).toBeDefined();
      expect(annualEvent).toBeDefined();

      // 行动完成应该排在年度考核之前
      const actionIdx = events.indexOf(actionEvent!);
      const annualIdx = events.indexOf(annualEvent!);
      expect(actionIdx).toBeLessThan(annualIdx);
    });
  });
});
