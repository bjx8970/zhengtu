import { describe, expect, it } from 'vitest';
import { completeActions, hasActiveActions, resolveActionEffects, startAction } from '../action';
import type { ActionTemplate } from '../../../types/config';
import type { SlotOccupant, SlotState } from '../../../types/player';
import type { StartActionInput } from '../../../types/game';

function makeAction(overrides?: Partial<ActionTemplate>): ActionTemplate {
  return {
    id: 'test_action',
    name: '测试行动',
    description: '用于测试',
    category: 'minor',
    durationDays: 3,
    cooldownDays: 5,
    budgetDelta: 10,
    effects: [{ target: 'dept.kpi.test_kpi', operation: 'add', value: 5 }],
    ...overrides,
  };
}

function occupant(overrides?: Partial<SlotOccupant>): SlotOccupant {
  return {
    actionId: 'other_action',
    deptId: 'dept_a',
    actionName: '行动',
    category: 'minor',
    startedAtDay: 0,
    durationDays: 3,
    cooldownDays: 5,
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

function makeInput(overrides?: Partial<StartActionInput>): StartActionInput {
  return {
    action: makeAction(),
    slotState: makeSlotState(),
    remainingBudget: 1000,
    currentDay: 10,
    deptId: 'dept_a',
    tierKey: 'primary',
    cooldownUntilDay: 0,
    ...overrides,
  };
}

describe('startAction', () => {
  it.each([
    ['major', 'primary', true],
    ['major', 'secondary', false],
    ['major', 'reserve', false],
    ['minor', 'primary', true],
    ['minor', 'secondary', true],
    ['minor', 'reserve', true],
    ['routine', 'primary', true],
    ['routine', 'secondary', true],
    ['routine', 'reserve', true],
  ] as const)('%s 使用 %s 槽位的结果为 %s', (category, tierKey, success) => {
    const result = startAction(makeInput({ action: makeAction({ category }), tierKey }));
    expect(result.success).toBe(success);
  });

  it('使用玩家指定等级的第一个空位，不自动改用其他等级', () => {
    const slots = makeSlotState({
      secondary: {
        label: '次要',
        count: 2,
        occupants: [occupant({ actionId: 'occupied' }), null],
      },
    });
    expect(startAction(makeInput({ slotState: slots, tierKey: 'secondary' }))).toEqual({
      success: true,
      tierKey: 'secondary',
      slotIndex: 1,
    });

    slots.secondary.occupants[1] = occupant({ actionId: 'occupied_2' });
    expect(startAction(makeInput({ slotState: slots, tierKey: 'secondary' }))).toEqual({
      success: false,
      error: '所选槽位等级无空闲槽位',
    });
  });

  it('routine 允许同部门同行动并行', () => {
    const slots = makeSlotState({
      primary: {
        label: '主要',
        count: 3,
        occupants: [occupant({ actionId: 'test_action', category: 'routine' }), null, null],
      },
    });
    const result = startAction(
      makeInput({ action: makeAction({ category: 'routine' }), slotState: slots }),
    );
    expect(result).toEqual({ success: true, tierKey: 'primary', slotIndex: 1 });
  });

  it('minor 拒绝同部门同行动重复，但允许不同部门的同 ID 行动', () => {
    const slots = makeSlotState({
      primary: {
        label: '主要',
        count: 3,
        occupants: [occupant({ actionId: 'test_action', deptId: 'dept_a' }), null, null],
      },
    });
    expect(startAction(makeInput({ slotState: slots }))).toEqual({
      success: false,
      error: '该部门的行动已在执行中',
    });
    expect(startAction(makeInput({ slotState: slots, deptId: 'dept_b' }))).toEqual({
      success: true,
      tierKey: 'primary',
      slotIndex: 1,
    });
  });

  it('major/minor 在截止日前拒绝，截止日当天允许，routine 忽略冷却', () => {
    expect(startAction(makeInput({ currentDay: 9, cooldownUntilDay: 10 })).success).toBe(false);
    expect(startAction(makeInput({ currentDay: 10, cooldownUntilDay: 10 })).success).toBe(true);
    expect(
      startAction(
        makeInput({
          action: makeAction({ category: 'routine' }),
          currentDay: 1,
          cooldownUntilDay: 100,
        }),
      ).success,
    ).toBe(true);
  });

  it('预算不足时返回准确错误', () => {
    expect(startAction(makeInput({ remainingBudget: 9 }))).toEqual({
      success: false,
      error: '预算不足',
    });
  });

  it('不修改任何输入', () => {
    const input = makeInput();
    const before = structuredClone(input);
    startAction(input);
    expect(input).toEqual(before);
  });
});

describe('action queue helpers', () => {
  it('正确识别活动行动', () => {
    expect(hasActiveActions(makeSlotState())).toBe(false);
    expect(
      hasActiveActions(
        makeSlotState({
          reserve: { label: '备用', count: 1, occupants: [occupant()] },
        }),
      ),
    ).toBe(true);
  });

  it('仅返回达到名义完成日的行动及槽位位置', () => {
    const slots = makeSlotState({
      primary: {
        label: '主要',
        count: 3,
        occupants: [occupant({ actionId: 'done', durationDays: 5 }), null, null],
      },
      secondary: {
        label: '次要',
        count: 2,
        occupants: [occupant({ actionId: 'pending', durationDays: 6 }), null],
      },
    });
    const completed = completeActions(slots, 5);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ tierKey: 'primary', slotIndex: 0 });
    expect(completed[0]?.occupant.actionId).toBe('done');
  });
});

describe('resolveActionEffects', () => {
  it('解析 KPI、玩家及操作类型', () => {
    const result = resolveActionEffects(
      makeAction({
        effects: [
          { target: 'dept.kpi.gdp', operation: 'multiply', value: 1.5 },
          { target: 'player.competence', operation: 'set', value: 80 },
        ],
      }),
    );
    expect(result.kpiChanges[0]).toEqual({
      indicatorId: 'gdp',
      operation: 'multiply',
      delta: 1.5,
    });
    expect(result.playerChanges[0]).toEqual({
      attr: 'competence',
      operation: 'set',
      delta: 80,
    });
  });

  it('使用注入 RNG 解析闭区间范围', () => {
    const action = makeAction({
      effects: [
        { target: 'dept.kpi.gdp', operation: 'add', value: 0, range: { min: 10, max: 20 } },
      ],
    });
    expect(resolveActionEffects(action, () => 0).kpiChanges[0]?.delta).toBe(10);
    expect(resolveActionEffects(action, () => 0.9999).kpiChanges[0]?.delta).toBe(20);
  });
});
