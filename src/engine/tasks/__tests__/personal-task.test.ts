/** 个人任务制引擎纯函数测试：前置条件、承接校验与 KPI 台账。 */

import { describe, expect, it } from 'vitest';
import {
  applyPersonalTaskKpiEffects,
  describePersonalTaskAvailability,
  isPersonalTaskOccupant,
  taskAllowsParallel,
  validatePersonalTaskStart,
} from '../personal-task';
import type { PersonalTaskTemplate } from '../../../types/config';
import {
  PERSONAL_TASK_LEDGER_ID,
  type DepartmentState,
  type SlotOccupant,
  type SlotState,
} from '../../../types/player';
import type { PersonalTaskStartInput } from '../../../types/game';

function makeTask(overrides?: Partial<PersonalTaskTemplate>): PersonalTaskTemplate {
  return {
    id: 'task_test',
    name: '测试任务',
    type: 'drafting',
    durationDays: 5,
    category: 'minor',
    cooldownDays: 7,
    budgetDelta: 10,
    effects: [{ target: 'character', field: 'competence', operation: 'add', value: 2 }],
    repeatPolicy: 'repeatable',
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

function runningTaskOccupant(taskId: string): SlotOccupant {
  const task = makeTask({ id: taskId });
  return {
    instanceId: `running-${taskId}`,
    actionId: task.id,
    deptId: PERSONAL_TASK_LEDGER_ID,
    actionName: task.name,
    originPositionId: 'position-a',
    originInstitutionId: 'institution-a',
    originRegionId: 'region-a',
    category: task.category,
    startedAtDay: 0,
    durationDays: task.durationDays,
    cooldownDays: task.cooldownDays,
    executableSnapshot: {
      contentVersion: 'test',
      department: { id: PERSONAL_TASK_LEDGER_ID, name: '个人任务' },
      task,
      attributeBounds: {},
    },
  };
}

function makeInput(overrides?: Partial<PersonalTaskStartInput>): PersonalTaskStartInput {
  return {
    task: makeTask(),
    slotState: makeSlotState(),
    remainingBudget: 1000,
    currentDay: 10,
    tierKey: 'primary',
    cooldownUntilDay: 0,
    completedCount: 0,
    ...overrides,
  };
}

describe('describePersonalTaskAvailability', () => {
  const baseContext = {
    leadershipRank: 'none' as const,
    civilServiceRank: 'clerk_2' as const,
    totalCompletedTasks: 0,
    facts: {} as Record<string, boolean | number | string | null>,
  };

  it('无前置条件时任何阶段均可承接', () => {
    expect(describePersonalTaskAvailability(makeTask(), baseContext)).toEqual({
      available: true,
    });
  });

  it('领导职务不在允许列表时拒绝', () => {
    const task = makeTask({
      prerequisites: { allowedLeadershipRanks: ['none'] },
    });
    const result = describePersonalTaskAvailability(task, {
      ...baseContext,
      leadershipRank: 'township_chief',
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('当前职务阶段不可承接');
  });

  it('职级未达最低要求时拒绝', () => {
    const task = makeTask({ prerequisites: { civilServiceRankMin: 'clerk_1' } });
    const below = describePersonalTaskAvailability(task, baseContext);
    expect(below.available).toBe(false);
    const equal = describePersonalTaskAvailability(task, {
      ...baseContext,
      civilServiceRank: 'clerk_1',
    });
    expect(equal.available).toBe(true);
  });

  it('完成任务数不足时拒绝并给出数量提示', () => {
    const task = makeTask({ prerequisites: { minCompletedTasks: 3 } });
    const result = describePersonalTaskAvailability(task, {
      ...baseContext,
      totalCompletedTasks: 2,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain('3');
  });

  it('必需事实缺失、为空或为 false 时均拒绝（契约：必须为真）', () => {
    const task = makeTask({ prerequisites: { requiredFacts: ['assigned_project_delivered'] } });
    expect(describePersonalTaskAvailability(task, baseContext).available).toBe(false);
    expect(
      describePersonalTaskAvailability(task, {
        ...baseContext,
        facts: { assigned_project_delivered: null },
      }).available,
    ).toBe(false);
    expect(
      describePersonalTaskAvailability(task, {
        ...baseContext,
        facts: { assigned_project_delivered: false },
      }).available,
    ).toBe(false);
    expect(
      describePersonalTaskAvailability(task, {
        ...baseContext,
        facts: { assigned_project_delivered: '2026' },
      }).available,
    ).toBe(false);
    expect(
      describePersonalTaskAvailability(task, {
        ...baseContext,
        facts: { assigned_project_delivered: true },
      }).available,
    ).toBe(true);
  });
});

describe('taskAllowsParallel', () => {
  it('once 任务恒不允许并行（契约优先于配置）', () => {
    expect(taskAllowsParallel(makeTask({ repeatPolicy: 'once' }))).toBe(false);
    expect(taskAllowsParallel(makeTask({ repeatPolicy: 'once', allowParallel: true }))).toBe(false);
  });

  it('缺省按分类推导：routine 可并行、major/minor 不可', () => {
    expect(taskAllowsParallel(makeTask({ category: 'routine' }))).toBe(true);
    expect(taskAllowsParallel(makeTask({ category: 'minor' }))).toBe(false);
    expect(taskAllowsParallel(makeTask({ category: 'major' }))).toBe(false);
  });

  it('allowParallel 显式覆盖分类缺省', () => {
    expect(taskAllowsParallel(makeTask({ category: 'minor', allowParallel: true }))).toBe(true);
    expect(taskAllowsParallel(makeTask({ category: 'routine', allowParallel: false }))).toBe(false);
  });
});

describe('validatePersonalTaskStart', () => {
  it('常规输入返回主要槽位空位', () => {
    expect(validatePersonalTaskStart(makeInput())).toEqual({
      success: true,
      tierKey: 'primary',
      slotIndex: 0,
    });
  });

  it('重大任务只能使用主要槽位', () => {
    const result = validatePersonalTaskStart(
      makeInput({ task: makeTask({ category: 'major' }), tierKey: 'secondary' }),
    );
    expect(result).toEqual({ success: false, error: '重大任务只能使用主要槽位' });
  });

  it('预算不足时拒绝', () => {
    const result = validatePersonalTaskStart(makeInput({ remainingBudget: 5 }));
    expect(result).toEqual({ success: false, error: '预算不足' });
  });

  it('once 任务完成后不可再次承接', () => {
    const result = validatePersonalTaskStart(
      makeInput({ task: makeTask({ repeatPolicy: 'once' }), completedCount: 1 }),
    );
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain('不可再次承接');
  });

  it('同任务在办时拒绝重复承接', () => {
    const slotState = makeSlotState({
      secondary: {
        label: '次要',
        count: 2,
        occupants: [runningTaskOccupant('task_test'), null],
      },
    });
    const result = validatePersonalTaskStart(makeInput({ slotState, tierKey: 'primary' }));
    expect(result).toEqual({ success: false, error: '该任务已在执行中' });
  });

  it('routine+once 任务在首份完成前不可并行承接（回归：初任培训）', () => {
    const onceRoutine = makeTask({ category: 'routine', cooldownDays: 0, repeatPolicy: 'once' });
    const slotState = makeSlotState({
      primary: {
        label: '主要',
        count: 3,
        occupants: [runningTaskOccupant('task_test'), null, null],
      },
    });
    const result = validatePersonalTaskStart(
      makeInput({ task: onceRoutine, slotState, completedCount: 0 }),
    );
    expect(result).toEqual({ success: false, error: '该任务已在执行中' });
  });

  it('allowParallel=true 的次要任务可在另一槽位并行承接', () => {
    const parallelTask = makeTask({ category: 'minor', allowParallel: true });
    const slotState = makeSlotState({
      secondary: {
        label: '次要',
        count: 2,
        occupants: [runningTaskOccupant('task_test'), null],
      },
    });
    const result = validatePersonalTaskStart(
      makeInput({ task: parallelTask, slotState, tierKey: 'secondary' }),
    );
    expect(result).toEqual({ success: true, tierKey: 'secondary', slotIndex: 1 });
  });

  it('冷却未结束时拒绝', () => {
    const result = validatePersonalTaskStart(makeInput({ currentDay: 10, cooldownUntilDay: 20 }));
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain('冷却中');
  });

  it('所选槽位等级无空位时拒绝', () => {
    const slotState = makeSlotState({
      primary: {
        label: '主要',
        count: 1,
        occupants: [runningTaskOccupant('other_task')],
      },
    });
    const result = validatePersonalTaskStart(makeInput({ slotState }));
    expect(result).toEqual({ success: false, error: '所选槽位等级无空闲槽位' });
  });

  it('日常任务跳过重复与冷却检查', () => {
    const routine = makeTask({ category: 'routine', cooldownDays: 0 });
    const slotState = makeSlotState({
      secondary: { label: '次要', count: 2, occupants: [runningTaskOccupant('task_test'), null] },
    });
    const result = validatePersonalTaskStart(
      makeInput({
        task: routine,
        slotState,
        tierKey: 'secondary',
        cooldownUntilDay: 999,
      }),
    );
    expect(result).toEqual({ success: true, tierKey: 'secondary', slotIndex: 1 });
  });
});

describe('applyPersonalTaskKpiEffects', () => {
  it('缺失时惰性创建台账并应用贡献', () => {
    const departmentStates: Record<string, DepartmentState> = {};
    const labels = applyPersonalTaskKpiEffects(departmentStates, [
      { indicatorId: 'office_efficiency', operation: 'add', value: 6 },
    ]);
    const ledger = departmentStates[PERSONAL_TASK_LEDGER_ID];
    expect(ledger).toBeDefined();
    if (!ledger) return;
    expect(ledger.kpiValues).toEqual({ office_efficiency: 6 });
    expect(labels).toEqual(['office_efficiency add 6']);
  });

  it('多次应用按操作类型累积', () => {
    const departmentStates: Record<string, DepartmentState> = {};
    applyPersonalTaskKpiEffects(departmentStates, [
      { indicatorId: 'data_accuracy', operation: 'add', value: 5 },
    ]);
    applyPersonalTaskKpiEffects(departmentStates, [
      { indicatorId: 'data_accuracy', operation: 'multiply', value: 2 },
      { indicatorId: 'livelihood_score', operation: 'set', value: 10 },
    ]);
    const ledger = departmentStates[PERSONAL_TASK_LEDGER_ID];
    expect(ledger).toBeDefined();
    if (!ledger) return;
    expect(ledger.kpiValues).toEqual({
      data_accuracy: 10,
      livelihood_score: 10,
    });
  });
});

describe('isPersonalTaskOccupant', () => {
  it('按台账部门与任务快照判别', () => {
    expect(isPersonalTaskOccupant(runningTaskOccupant('task_test'))).toBe(true);
    const departmentOccupant: SlotOccupant = {
      ...runningTaskOccupant('task_test'),
      deptId: 'admin_l1_0_dept_0',
      executableSnapshot: {
        contentVersion: 'test',
        department: { id: 'admin_l1_0_dept_0', name: '综合办公室' },
        action: {
          id: 'task_test',
          name: '测试任务',
          category: 'minor',
          durationDays: 5,
          cooldownDays: 7,
          budgetDelta: 0,
          effects: [],
        },
        attributeBounds: {},
      },
    };
    expect(isPersonalTaskOccupant(departmentOccupant)).toBe(false);
  });
});
