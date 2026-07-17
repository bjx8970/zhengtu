import { describe, it, expect } from 'vitest';
import { startAction, completeActions, resolveActionEffects } from '../action';
import type { ActionTemplate } from '../../../types/config';
import type { SlotState, SlotOccupant } from '../../../types/player';

function makeAction(overrides?: Partial<ActionTemplate>): ActionTemplate {
  return {
    id: 'test_action',
    name: '测试行动',
    description: '用于测试',
    durationDays: 3,
    minTier: 'primary',
    budgetDelta: 10,
    effects: [{ target: 'dept.kpi.test_kpi', operation: 'add', value: 5 }],
    ...overrides,
  };
}

function makeSlotState(overrides?: Partial<SlotState>): SlotState {
  return {
    primary: { label: '主要', count: 3, occupants: [null, null, null] },
    secondary: { label: '次要', count: 2, occupants: [null, null] },
    reserve: { label: '备用', count: 1, occupants: [null] },
    ...overrides,
  };
}

function occ(
  actionId = 'a',
  startedAtDay = 0,
  durationDays = 3,
  deptId = 'd',
  actionName = 'A',
): SlotOccupant {
  return { actionId, deptId, actionName, startedAtDay, durationDays };
}

describe('startAction', () => {
  describe('slot allocation', () => {
    it('分配到主要槽位', () => {
      const result = startAction(makeAction(), makeSlotState(), 1000, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.tierKey).toBe('primary');
        expect(result.slotIndex).toBe(0);
      }
    });

    it('找到主要中第一个空位', () => {
      const state = makeSlotState({
        primary: { label: '主要', count: 3, occupants: [occ('a'), null, null] },
      });
      const result = startAction(makeAction(), state, 1000, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.tierKey).toBe('primary');
        expect(result.slotIndex).toBe(1);
      }
    });

    it('主要满时分配到次要', () => {
      const state = makeSlotState({
        primary: { label: '主要', count: 3, occupants: [occ('a'), occ('b'), occ('c')] },
      });
      const result = startAction(makeAction({ minTier: 'secondary' }), state, 1000, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.tierKey).toBe('secondary');
      }
    });

    it('主要和次要满时分配到备用', () => {
      const state = makeSlotState({
        primary: { label: '主要', count: 3, occupants: [occ('a'), occ('b'), occ('c')] },
        secondary: { label: '次要', count: 2, occupants: [occ('d'), occ('e')] },
      });
      const result = startAction(makeAction({ minTier: 'reserve' }), state, 1000, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.tierKey).toBe('reserve');
      }
    });

    it('所有槽位满时返回无空闲槽位', () => {
      const state = makeSlotState({
        primary: { label: '主要', count: 3, occupants: [occ('a'), occ('b'), occ('c')] },
        secondary: { label: '次要', count: 2, occupants: [occ('d'), occ('e')] },
        reserve: { label: '备用', count: 1, occupants: [occ('f')] },
      });
      const result = startAction(makeAction({ minTier: 'reserve' }), state, 1000, 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('无空闲槽位');
      }
    });
  });

  describe('tier filtering', () => {
    it('primary 行动只能放主要槽位', () => {
      const state = makeSlotState({
        primary: { label: '主要', count: 3, occupants: [occ('a'), occ('b'), occ('c')] },
      });
      const result = startAction(makeAction({ minTier: 'primary' }), state, 1000, 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('无空闲槽位');
      }
    });

    it('secondary 行动可放主要或次要', () => {
      const state = makeSlotState();
      const result = startAction(makeAction({ minTier: 'secondary' }), state, 1000, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.tierKey).toBe('primary');
      }
    });
  });

  describe('budget check', () => {
    it('预算不足时拒绝', () => {
      const result = startAction(makeAction({ budgetDelta: 100 }), makeSlotState(), 50, 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('预算不足');
      }
    });

    it('预算刚好够时通过', () => {
      const result = startAction(makeAction({ budgetDelta: 50 }), makeSlotState(), 50, 0);
      expect(result.success).toBe(true);
    });
  });

  describe('duplicate check', () => {
    it('已在执行中的行动不能重复启动', () => {
      const state = makeSlotState({
        primary: {
          label: '主要',
          count: 3,
          occupants: [occ('test_action', 0, 5, 'dept_a'), null, null],
        },
      });
      const result = startAction(makeAction(), state, 1000, 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('已在执行中');
      }
    });

    it('同一行动在不同部门先执行时不能重复启动', () => {
      const state = makeSlotState({
        primary: {
          label: '主要',
          count: 3,
          occupants: [null, null, null],
        },
        secondary: {
          label: '次要',
          count: 2,
          occupants: [occ('test_action', 0, 5, 'other_dept'), null],
        },
      });
      const result = startAction(makeAction(), state, 1000, 0);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('已在执行中');
      }
    });

    it('不同行动可以同时执行', () => {
      const state = makeSlotState({
        primary: { label: '主要', count: 3, occupants: [occ('other_action'), null, null] },
      });
      const result = startAction(makeAction(), state, 1000, 0);
      expect(result.success).toBe(true);
    });
  });
});

describe('completeActions', () => {
  it('返回已完成行动', () => {
    const state = makeSlotState({
      primary: { label: '主要', count: 3, occupants: [occ('a', 0, 5), null, null] },
    });
    const completed = completeActions(state, 5);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.occupant.actionId).toBe('a');
    expect(completed[0]!.tierKey).toBe('primary');
    expect(completed[0]!.slotIndex).toBe(0);
  });

  it('不返回未完成行动', () => {
    const state = makeSlotState({
      primary: { label: '主要', count: 3, occupants: [occ('a', 0, 5), null, null] },
    });
    const completed = completeActions(state, 4);
    expect(completed).toHaveLength(0);
  });

  it('边界值：等于 durationDays 时完成', () => {
    const state = makeSlotState({
      primary: { label: '主要', count: 3, occupants: [occ('a', 0, 5), null, null] },
    });
    const completed = completeActions(state, 5);
    expect(completed).toHaveLength(1);
  });

  it('返回多个 tier 中已完成行动', () => {
    const state = makeSlotState({
      primary: { label: '主要', count: 3, occupants: [occ('a', 0, 3), null, null] },
      secondary: { label: '次要', count: 2, occupants: [occ('b', 0, 5), null] },
    });
    const completed = completeActions(state, 4);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.occupant.actionId).toBe('a');
  });

  it('跳过空槽位', () => {
    const state = makeSlotState();
    const completed = completeActions(state, 100);
    expect(completed).toHaveLength(0);
  });
});

describe('resolveActionEffects', () => {
  it('解析 KPI 效果', () => {
    const action = makeAction({
      effects: [{ target: 'dept.kpi.gdp', operation: 'add', value: 10 }],
    });
    const result = resolveActionEffects(action);
    expect(result.kpiChanges).toHaveLength(1);
    expect(result.kpiChanges[0]!.indicatorId).toBe('gdp');
    expect(result.kpiChanges[0]!.delta).toBe(10);
    expect(result.playerChanges).toHaveLength(0);
  });

  it('解析 Player 效果', () => {
    const action = makeAction({
      effects: [{ target: 'player.competence', operation: 'add', value: 5 }],
    });
    const result = resolveActionEffects(action);
    expect(result.playerChanges).toHaveLength(1);
    expect(result.playerChanges[0]!.attr).toBe('competence');
    expect(result.playerChanges[0]!.delta).toBe(5);
    expect(result.kpiChanges).toHaveLength(0);
  });

  it('混合效果', () => {
    const action = makeAction({
      effects: [
        { target: 'dept.kpi.gdp', operation: 'add', value: 10 },
        { target: 'player.competence', operation: 'add', value: 5 },
      ],
    });
    const result = resolveActionEffects(action);
    expect(result.kpiChanges).toHaveLength(1);
    expect(result.playerChanges).toHaveLength(1);
  });

  it('空效果列表', () => {
    const action = makeAction({ effects: [] });
    const result = resolveActionEffects(action);
    expect(result.kpiChanges).toHaveLength(0);
    expect(result.playerChanges).toHaveLength(0);
  });
});
