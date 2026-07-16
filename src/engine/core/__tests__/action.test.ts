import { describe, it, expect } from 'vitest';
import { executeAction, getSlotLimits } from '../action';
import { getConfigLoader } from '../../../config/loader';
import type { ActionTemplate } from '../../../types/config';
import type { DepartmentState } from '../../../types/player';

const cfg = getConfigLoader().getGameConfig();

function makeAction(overrides?: Partial<ActionTemplate>): ActionTemplate {
  return {
    id: 'test_action',
    name: '测试行动',
    description: '用于测试',
    slotCost: 1,
    cooldownDays: 2,
    budgetDelta: 10,
    effects: [{ target: 'dept.kpi.test_kpi', operation: 'add', value: 5 }],
    ...overrides,
  };
}

function makeDeptState(overrides?: Partial<DepartmentState>): DepartmentState {
  return {
    id: 'test_dept',
    kpiValues: { test_kpi: 0 },
    monthlyConsumption: 50,
    cumulativeConsumption: 0,
    actionCooldowns: {},
    lastActionDay: 0,
    ...overrides,
  };
}

describe('executeAction', () => {
  describe('successful execution', () => {
    it('消耗槽位并返回效果', () => {
      const result = executeAction(makeAction(), makeDeptState(), 3, 1000, 10, cfg);
      expect(result.success).toBe(true);
      expect(result.slotCost).toBe(1);
      expect(result.kpiChanges).toHaveLength(1);
      expect(result.kpiChanges[0]!.indicatorId).toBe('test_kpi');
      expect(result.kpiChanges[0]!.delta).toBe(5);
    });

    it('消耗资金', () => {
      const result = executeAction(
        makeAction({ budgetDelta: 50 }),
        makeDeptState(),
        3,
        1000,
        10,
        cfg,
      );
      expect(result.success).toBe(true);
      expect(result.budgetDelta).toBe(50);
    });

    it('设置冷却时间', () => {
      const result = executeAction(
        makeAction({ cooldownDays: 5 }),
        makeDeptState(),
        3,
        1000,
        10,
        cfg,
      );
      expect(result.success).toBe(true);
      expect(result.newCooldown.expiresAt).toBe(15); // gameDay(10) + cooldown(5)
    });
  });

  describe('slot validation', () => {
    it('槽位不足时拒绝', () => {
      const result = executeAction(makeAction({ slotCost: 3 }), makeDeptState(), 2, 1000, 10, cfg);
      expect(result.success).toBe(false);
      expect(result.error).toContain('槽位不足');
    });

    it('槽位刚好够时通过', () => {
      const result = executeAction(makeAction({ slotCost: 3 }), makeDeptState(), 3, 1000, 10, cfg);
      expect(result.success).toBe(true);
    });
  });

  describe('cooldown validation', () => {
    it('冷却中时拒绝', () => {
      const deptState = makeDeptState({
        actionCooldowns: { test_action: 15 },
      });
      const result = executeAction(makeAction(), deptState, 3, 1000, 10, cfg);
      expect(result.success).toBe(false);
      expect(result.error).toContain('冷却');
    });

    it('冷却结束后允许', () => {
      const deptState = makeDeptState({
        actionCooldowns: { test_action: 9 },
      });
      const result = executeAction(makeAction(), deptState, 3, 1000, 10, cfg);
      expect(result.success).toBe(true);
    });
  });

  describe('budget validation', () => {
    it('预算不足时拒绝', () => {
      const result = executeAction(
        makeAction({ budgetDelta: 100 }),
        makeDeptState(),
        3,
        50,
        10,
        cfg,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('预算不足');
    });
  });
});

describe('getSlotLimits', () => {
  it('returns correct limits per granularity', () => {
    expect(getSlotLimits('day', cfg)).toBe(3);
    expect(getSlotLimits('week', cfg)).toBe(4);
    expect(getSlotLimits('month', cfg)).toBe(6);
  });
});
