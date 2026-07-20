/**
 * 事件引擎测试
 *
 * 覆盖场景：
 * - 等级范围条件匹配
 * - 职业线限制
 * - 地区限定
 * - 时间窗口（含跨年）
 * - 前置事件链
 * - 专属职位
 * - 隐藏状态条件
 */
import { describe, it, expect } from 'vitest';
import { evaluateEventTrigger, filterAvailableEvents } from '../event';
import type { EventContext } from '../event';
import type { GameEvent } from '../../../types/game';
import { CareerLine } from '../../../types/enums';

function makeCtx(override?: Partial<EventContext>): EventContext {
  return {
    currentLevel: 3,
    careerLine: CareerLine.Administrative,
    positionId: 'admin_l3_0',
    region: '北京',
    currentMonth: 6,
    completedEventIds: [],
    hiddenStates: {},
    ...override,
  };
}

function makeEvent(override?: Partial<GameEvent>): GameEvent {
  return {
    id: 'test_event',
    title: '测试事件',
    description: '测试描述',
    triggerCondition: {},
    options: [
      { label: '选项1', description: '描述1', effects: [] },
      { label: '选项2', description: '描述2', effects: [] },
      { label: '选项3', description: '描述3', effects: [] },
    ],
    ...override,
  };
}

describe('evaluateEventTrigger', () => {
  describe('等级范围条件', () => {
    it('无等级限制 → 可触发', () => {
      const event = makeEvent({ triggerCondition: {} });
      expect(evaluateEventTrigger(event, makeCtx())).toBe(true);
    });

    it('minLevel 满足 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { minLevel: 3 } });
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 3 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 5 }))).toBe(true);
    });

    it('minLevel 不满足 → 不可触发', () => {
      const event = makeEvent({ triggerCondition: { minLevel: 5 } });
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 3 }))).toBe(false);
    });

    it('maxLevel 满足 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { maxLevel: 5 } });
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 3 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 5 }))).toBe(true);
    });

    it('maxLevel 不满足 → 不可触发', () => {
      const event = makeEvent({ triggerCondition: { maxLevel: 2 } });
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 3 }))).toBe(false);
    });

    it('等级范围 [minLevel, maxLevel] → 边界测试', () => {
      const event = makeEvent({ triggerCondition: { minLevel: 2, maxLevel: 5 } });
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 1 }))).toBe(false);
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 2 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 5 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentLevel: 6 }))).toBe(false);
    });
  });

  describe('职业线限制', () => {
    it('careerLines 包含当前线 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { careerLines: ['admin', 'party'] } });
      expect(evaluateEventTrigger(event, makeCtx())).toBe(true);
    });

    it('careerLines 不包含当前线 → 不可触发', () => {
      const event = makeEvent({ triggerCondition: { careerLines: ['party', 'discipline'] } });
      expect(evaluateEventTrigger(event, makeCtx())).toBe(false);
    });
  });

  describe('地区限定', () => {
    it('regions 包含当前地区 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { regions: ['北京', '上海'] } });
      expect(evaluateEventTrigger(event, makeCtx({ region: '北京' }))).toBe(true);
    });

    it('regions 不包含当前地区 → 不可触发', () => {
      const event = makeEvent({ triggerCondition: { regions: ['上海', '广州'] } });
      expect(evaluateEventTrigger(event, makeCtx({ region: '北京' }))).toBe(false);
    });

    it('regions 为空数组 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { regions: [] } });
      expect(evaluateEventTrigger(event, makeCtx())).toBe(true);
    });
  });

  describe('时间窗口', () => {
    it('普通时间窗口 [6, 9] → 范围内可触发', () => {
      const event = makeEvent({ triggerCondition: { timeWindow: { startMonth: 6, endMonth: 9 } } });
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 5 }))).toBe(false);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 6 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 9 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 10 }))).toBe(false);
    });

    it('跨年时间窗口 [11, 2] → 正确处理', () => {
      const event = makeEvent({
        triggerCondition: { timeWindow: { startMonth: 11, endMonth: 2 } },
      });
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 10 }))).toBe(false);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 11 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 12 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 1 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 2 }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ currentMonth: 3 }))).toBe(false);
    });
  });

  describe('前置事件链', () => {
    it('所有前置事件已完成 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { prerequisiteEvents: ['event_a', 'event_b'] } });
      const ctx = makeCtx({ completedEventIds: ['event_a', 'event_b', 'event_c'] });
      expect(evaluateEventTrigger(event, ctx)).toBe(true);
    });

    it('部分前置事件未完成 → 不可触发', () => {
      const event = makeEvent({ triggerCondition: { prerequisiteEvents: ['event_a', 'event_b'] } });
      const ctx = makeCtx({ completedEventIds: ['event_a'] });
      expect(evaluateEventTrigger(event, ctx)).toBe(false);
    });

    it('前置事件为空 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { prerequisiteEvents: [] } });
      expect(evaluateEventTrigger(event, makeCtx())).toBe(true);
    });
  });

  describe('专属职位', () => {
    it('positionIds 包含当前职位 → 可触发', () => {
      const event = makeEvent({ triggerCondition: { positionIds: ['admin_l3_0', 'admin_l3_1'] } });
      expect(evaluateEventTrigger(event, makeCtx({ positionId: 'admin_l3_0' }))).toBe(true);
    });

    it('positionIds 不包含当前职位 → 不可触发', () => {
      const event = makeEvent({ triggerCondition: { positionIds: ['admin_l4_0', 'admin_l4_1'] } });
      expect(evaluateEventTrigger(event, makeCtx({ positionId: 'admin_l3_0' }))).toBe(false);
    });
  });

  describe('隐藏状态条件', () => {
    it('gt 操作符 → 正确评估', () => {
      const event = makeEvent({
        triggerCondition: {
          hiddenStateConditions: [{ key: 'satisfaction', operator: 'gt', value: 50 }],
        },
      });
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { satisfaction: 60 } }))).toBe(
        true,
      );
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { satisfaction: 50 } }))).toBe(
        false,
      );
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { satisfaction: 40 } }))).toBe(
        false,
      );
    });

    it('lt 操作符 → 正确评估', () => {
      const event = makeEvent({
        triggerCondition: {
          hiddenStateConditions: [{ key: 'tension', operator: 'lt', value: 30 }],
        },
      });
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { tension: 20 } }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { tension: 30 } }))).toBe(false);
    });

    it('eq 操作符 → 正确评估', () => {
      const event = makeEvent({
        triggerCondition: { hiddenStateConditions: [{ key: 'status', operator: 'eq', value: 1 }] },
      });
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { status: 1 } }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { status: 2 } }))).toBe(false);
    });

    it('gte/lte 操作符 → 正确评估', () => {
      const eventGte = makeEvent({
        triggerCondition: { hiddenStateConditions: [{ key: 'score', operator: 'gte', value: 60 }] },
      });
      expect(evaluateEventTrigger(eventGte, makeCtx({ hiddenStates: { score: 60 } }))).toBe(true);
      expect(evaluateEventTrigger(eventGte, makeCtx({ hiddenStates: { score: 59 } }))).toBe(false);

      const eventLte = makeEvent({
        triggerCondition: { hiddenStateConditions: [{ key: 'score', operator: 'lte', value: 60 }] },
      });
      expect(evaluateEventTrigger(eventLte, makeCtx({ hiddenStates: { score: 60 } }))).toBe(true);
      expect(evaluateEventTrigger(eventLte, makeCtx({ hiddenStates: { score: 61 } }))).toBe(false);
    });

    it('隐藏状态不存在时默认为 0', () => {
      const event = makeEvent({
        triggerCondition: {
          hiddenStateConditions: [{ key: 'unknown', operator: 'gt', value: -1 }],
        },
      });
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: {} }))).toBe(true);
    });

    it('多个条件全部满足 → 可触发', () => {
      const event = makeEvent({
        triggerCondition: {
          hiddenStateConditions: [
            { key: 'a', operator: 'gt', value: 10 },
            { key: 'b', operator: 'lt', value: 50 },
          ],
        },
      });
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { a: 20, b: 30 } }))).toBe(true);
      expect(evaluateEventTrigger(event, makeCtx({ hiddenStates: { a: 5, b: 30 } }))).toBe(false);
    });
  });

  describe('组合条件', () => {
    it('多个条件同时满足 → 可触发', () => {
      const event = makeEvent({
        triggerCondition: {
          minLevel: 2,
          maxLevel: 5,
          careerLines: ['admin'],
          regions: ['北京'],
          timeWindow: { startMonth: 1, endMonth: 12 },
        },
      });
      expect(evaluateEventTrigger(event, makeCtx())).toBe(true);
    });

    it('任一条件不满足 → 不可触发', () => {
      const event = makeEvent({
        triggerCondition: {
          minLevel: 2,
          maxLevel: 5,
          careerLines: ['party'], // 不匹配
        },
      });
      expect(evaluateEventTrigger(event, makeCtx())).toBe(false);
    });
  });
});

describe('filterAvailableEvents', () => {
  it('筛选出所有可触发事件', () => {
    const events: GameEvent[] = [
      makeEvent({ id: 'e1', triggerCondition: { minLevel: 1 } }),
      makeEvent({ id: 'e2', triggerCondition: { minLevel: 5 } }),
      makeEvent({ id: 'e3', triggerCondition: { careerLines: ['admin'] } }),
      makeEvent({ id: 'e4', triggerCondition: { careerLines: ['party'] } }),
    ];
    const ctx = makeCtx({ currentLevel: 3 });
    const available = filterAvailableEvents(events, ctx);
    expect(available.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('空事件池 → 返回空数组', () => {
    expect(filterAvailableEvents([], makeCtx())).toEqual([]);
  });
});
