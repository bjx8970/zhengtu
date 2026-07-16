import { describe, it, expect } from 'vitest';
import { advanceTime, getAge, getRetirementCountdown, isCongressYear } from '../time';
import type { TimeState } from '../../../types/game';

function makeState(override?: Partial<TimeState>): TimeState {
  return { year: 2024, month: 6, day: 15, ...override };
}

describe('advanceTime', () => {
  describe('basic advancement', () => {
    it('推进 1 天：日期 +1', () => {
      const result = advanceTime(makeState(), 1, 1990, 3);
      expect(result.newState.day).toBe(16);
      expect(result.newState.month).toBe(6);
      expect(result.newState.year).toBe(2024);
    });

    it('推进 0 天：状态不变化', () => {
      const original = makeState();
      const result = advanceTime(original, 0, 1990, 3);
      expect(result.newState).toEqual(original);
    });
  });

  describe('month boundary', () => {
    it('月末推进触发月度结算', () => {
      const result = advanceTime(makeState({ day: 30 }), 1, 1990, 3);
      expect(result.newState.month).toBe(7);
      expect(result.newState.day).toBe(1);
      expect(result.triggers.some((t) => t.type === 'monthly_settlement')).toBe(true);
    });

    it('29 → 31 → 下月', () => {
      const result = advanceTime(makeState({ day: 29 }), 2, 1990, 3);
      expect(result.newState.day).toBe(1);
      expect(result.newState.month).toBe(7);
    });

    it('月中推进不触发月度结算', () => {
      const result = advanceTime(makeState({ day: 15 }), 5, 1990, 3);
      const monthlyTriggers = result.triggers.filter((t) => t.type === 'monthly_settlement');
      expect(monthlyTriggers).toHaveLength(0);
    });
  });

  describe('year boundary', () => {
    it('年末推进触发年度考核', () => {
      const result = advanceTime(makeState({ month: 12, day: 30 }), 1, 1990, 3);
      expect(result.newState.year).toBe(2025);
      expect(result.newState.month).toBe(1);
      expect(result.triggers.some((t) => t.type === 'annual_assessment')).toBe(true);
    });

    it('跨多年推进：多个年度触发', () => {
      const result = advanceTime(makeState({ month: 12, day: 1 }), 400, 1990, 3);
      const annuals = result.triggers.filter((t) => t.type === 'annual_assessment');
      expect(annuals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5-year cycles', () => {
    it('2025 年（5 的倍数）触发两会', () => {
      const result = advanceTime(makeState({ year: 2024, month: 12, day: 30 }), 1, 1990, 3);
      expect(result.triggers.some((t) => t.type === 'congress_cycle')).toBe(true);
    });

    it('非 5 的倍数年不触发两会', () => {
      const result = advanceTime(makeState({ year: 2023, month: 12, day: 30 }), 1, 1990, 3);
      const congress = result.triggers.filter((t) => t.type === 'congress_cycle');
      expect(congress).toHaveLength(0);
    });
  });

  describe('retirement check', () => {
    it('到 65 岁触发退休', () => {
      const birthYear = 1960;
      const state = makeState({ year: 2024, month: 12, day: 30 });
      const result = advanceTime(state, 1, birthYear, 3);
      expect(result.triggers.some((t) => t.type === 'retirement_check')).toBe(true);
    });

    it('未到 65 岁不触发退休', () => {
      const birthYear = 2000;
      const result = advanceTime(makeState(), 365, birthYear, 3);
      const retirement = result.triggers.filter((t) => t.type === 'retirement_check');
      expect(retirement).toHaveLength(0);
    });
  });

  describe('sentiment generation', () => {
    it('rank4+ 在月边界触发舆情生成', () => {
      const result = advanceTime(makeState({ day: 30 }), 1, 1990, 7);
      const sentiments = result.triggers.filter((t) => t.type === 'sentiment_generate');
      expect(sentiments.length).toBeGreaterThan(0);
    });

    it('rank3 以下不触发舆情', () => {
      const result = advanceTime(makeState({ day: 30 }), 1, 1990, 3);
      const sentiments = result.triggers.filter((t) => t.type === 'sentiment_generate');
      expect(sentiments).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('负天数：抛出异常', () => {
      expect(() => advanceTime(makeState(), -1, 1990, 3)).toThrow();
    });

    it('极大天数：允许快进多年', () => {
      const result = advanceTime(makeState(), 3650, 1990, 3);
      expect(result.newState.year).toBeGreaterThan(2024);
    });

    it('从 12 月 31 日推进 1 天', () => {
      const result = advanceTime(makeState({ month: 12, day: 30 }), 1, 1990, 3);
      expect(result.newState.month).toBe(1);
      expect(result.newState.year).toBe(2025);
    });
  });
});

describe('utility functions', () => {
  it('getAge computes correctly', () => {
    expect(getAge(2024, 1990)).toBe(34);
    expect(getAge(2000, 2000)).toBe(0);
  });

  it('getRetirementCountdown computes correctly', () => {
    expect(getRetirementCountdown(2024, 1990)).toBe(31);
    expect(getRetirementCountdown(2024, 1959)).toBe(0);
  });

  it('isCongressYear detects correctly', () => {
    expect(isCongressYear(2025)).toBe(true);
    expect(isCongressYear(2024)).toBe(false);
    expect(isCongressYear(2030)).toBe(true);
  });
});
