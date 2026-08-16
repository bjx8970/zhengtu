/** 个人任务制 Store 集成测试：承接、结算、信号、封禁与存档迁移。 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventDefinition } from '../../domain/events/definition';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import { getConfigLoader } from '../../config/loader';
import { createInitialState, createTestStore } from '../game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';
import { PERSONAL_TASK_LEDGER_ID } from '../../types/player';

function eventDefinition(id: string, source: DomainSignalSnapshot['signalType']): EventDefinition {
  return {
    id,
    chainId: null,
    nodeId: null,
    title: id,
    description: '',
    category: 'career',
    priority: 'normal',
    presentation: 'inbox',
    trigger: { sources: [source], probability: 1 },
    repeatPolicy: { mode: 'once' },
    activation: {},
    options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('personal task start', () => {
  it('科职员无法启动部门治理行动（双重封禁的引擎侧）', () => {
    const state = createInitialState();
    expect(state.career.appointment.leadershipRank).toBe('none');
    const store = createTestStore(state);
    const before = store.getRawState().actions.totalActions;
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l1_0_dept_0',
      actionId: 'document_processing',
      tierKey: 'primary',
    });
    expect(store.getRawState().actions.totalActions).toBe(before);
    expect(store.getRawState().actions.slots.primary.occupants[0]).toBeNull();
  });

  it('科员可承接个人任务并占用槽位、扣减预算', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    const budgetBefore = store.getRawState().remainingBudget;
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_draft_material',
      tierKey: 'primary',
      _idFactory: () => 'task-instance-1',
    });
    const occupant = store.getRawState().actions.slots.primary.occupants[0];
    expect(occupant).toMatchObject({
      instanceId: 'task-instance-1',
      actionId: 'task_draft_material',
      deptId: PERSONAL_TASK_LEDGER_ID,
      actionName: '乡镇工作汇报材料',
      category: 'minor',
      durationDays: 7,
    });
    expect('task' in (occupant?.executableSnapshot ?? {})).toBe(true);
    expect(store.getRawState().remainingBudget).toBe(budgetBefore - 10);
  });

  it('领导职务只能承接不限阶段的本人任务', () => {
    const state = createInitialState();
    state.career.appointment.leadershipRank = 'township_deputy';
    const store = createTestStore(state);

    store.dispatch({ type: 'START_PERSONAL_TASK', taskId: 'task_window_duty', tierKey: 'primary' });
    expect(store.getRawState().actions.slots.primary.occupants[0]).toBeNull();

    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_study',
      tierKey: 'primary',
    });
    expect(store.getRawState().actions.slots.primary.occupants[0]).not.toBeNull();
  });

  it('前置条件未满足时拒绝承接', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    // 上级交办专项要求先完成 3 项任务
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_assigned_special',
      tierKey: 'primary',
    });
    expect(store.getRawState().actions.slots.primary.occupants[0]).toBeNull();
  });
});

describe('personal task settlement', () => {
  it('到期结算：效果、KPI 台账、通知、冷却与完成计数', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_draft_material',
      tierKey: 'primary',
      _idFactory: () => 'settle-task-1',
    });
    const competenceBefore = store.getRawState().character.competence;

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'week' });
    // 乡镇工作汇报材料 7 天，推进一周后恰好在第 7 天完成
    const settled = store.getRawState();
    expect(settled.actions.slots.primary.occupants[0]).toBeNull();
    expect(settled.character.competence).toBe(competenceBefore + 2);
    expect(settled.assessments.comprehensiveScore).toBe(1);
    expect(settled.actions.departmentStates[PERSONAL_TASK_LEDGER_ID]?.kpiValues).toMatchObject({
      office_efficiency: 6,
    });
    expect(settled.actions.personalTasks).toMatchObject({
      completedCounts: { task_draft_material: 1 },
      totalCompleted: 1,
    });
    expect(settled.actions.personalTasks.cooldownUntilDays.task_draft_material).toBe(0 + 7 + 7);
    expect(settled.actions.lastCompletedActions[0]).toMatchObject({
      actionName: '乡镇工作汇报材料',
      deptName: '个人任务',
    });
  });

  it('完成信号恰好一次并可路由事件', () => {
    const loader = getConfigLoader();
    const taskEvent = eventDefinition('task-completed-test', 'task.completed');
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      taskEvent,
    ]);
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_study',
      tierKey: 'primary',
      _idFactory: () => 'signal-task-1',
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'week' });
    // 再推进一个月，信号不应重复投递
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });

    const settled = store.getRawState();
    expect(settled.actions.personalTasks.completedCounts.task_policy_study).toBe(1);
    expect(settled.actions.personalTasks.totalCompleted).toBe(1);
    const triggered = [
      ...settled.events.pending.map((item) => item.eventId),
      ...settled.events.history.map((item) => item.eventId),
    ].filter((eventId) => eventId === 'task-completed-test');
    expect(triggered).toHaveLength(1);
  });

  it('大步推进并行完成多个任务且快照隔离', () => {
    const loader = getConfigLoader();
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_brief',
      tierKey: 'primary',
      _idFactory: () => 'multi-task-1',
    });
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_monthly_report',
      tierKey: 'secondary',
      _idFactory: () => 'multi-task-2',
    });

    // 启动后内容配置漂移：完成结算必须使用冻结快照而非当前配置
    const competenceBefore = store.getRawState().character.competence;
    const drifted = loader.getPersonalTaskTemplate('task_policy_brief');
    if (!drifted) throw new Error('Expected task template');
    drifted.effects = [{ target: 'character', field: 'competence', operation: 'add', value: 50 }];
    vi.spyOn(loader, 'getPersonalTaskTemplate').mockReturnValue(drifted);

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });

    const settled = store.getRawState();
    expect(settled.actions.personalTasks.totalCompleted).toBe(2);
    expect(settled.actions.personalTasks.completedCounts).toMatchObject({
      task_policy_brief: 1,
      task_monthly_report: 1,
    });
    // 快照效果（两个任务各 competence+1）而非漂移后的 +50
    expect(settled.character.competence).toBe(competenceBefore + 2);
    expect(settled.actions.departmentStates[PERSONAL_TASK_LEDGER_ID]?.kpiValues).toMatchObject({
      office_efficiency: 3,
      data_accuracy: 5,
    });
  });

  it('完成后冷却期内不可重复承接', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_draft_material',
      tierKey: 'primary',
      _idFactory: () => 'cooldown-task-1',
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'week' });
    expect(store.getRawState().actions.personalTasks.totalCompleted).toBe(1);

    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_draft_material',
      tierKey: 'primary',
    });
    expect(store.getRawState().actions.slots.primary.occupants[0]).toBeNull();
  });

  it('once 任务完成后不可再次承接', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_induction_training',
      tierKey: 'primary',
      _idFactory: () => 'once-task-1',
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
    expect(store.getRawState().actions.personalTasks.completedCounts).toMatchObject({
      task_induction_training: 1,
    });

    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_induction_training',
      tierKey: 'primary',
    });
    expect(store.getRawState().actions.slots.primary.occupants[0]).toBeNull();
  });

  it('进行中任务经存档往返后保留冻结快照', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_village_research',
      tierKey: 'primary',
      _idFactory: () => 'roundtrip-task-1',
    });

    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(store.getRawState())));
    expect(decoded.success).toBe(true);
    const occupant = decoded.state?.actions.slots.primary.occupants[0];
    expect(occupant).toMatchObject({
      instanceId: 'roundtrip-task-1',
      actionId: 'task_village_research',
    });
    expect(occupant && 'task' in occupant.executableSnapshot).toBe(true);

    // 恢复后推进至完成，结算走冻结快照
    if (!decoded.state) return;
    const resumed = createTestStore(decoded.state);
    resumed.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
    expect(resumed.getRawState().actions.personalTasks.totalCompleted).toBe(1);
  });
});

describe('schema 9 → 10 migration', () => {
  it('回填个人任务运行时状态并升级版本', () => {
    const state = createInitialState();
    const envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(state))) as Record<string, unknown>;
    envelope.schemaVersion = 9;
    envelope.contentVersion = '2026.08.1';
    const actions = (envelope.state as Record<string, unknown>).actions as Record<string, unknown>;
    delete actions.personalTasks;

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.actions.personalTasks).toEqual({
      cooldownUntilDays: {},
      completedCounts: {},
      totalCompleted: 0,
    });
  });

  it('Schema 9 个人任务进行中存档可完整迁移', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_study',
      tierKey: 'primary',
      _idFactory: () => 'legacy-task-1',
    });
    const envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(store.getRawState()))) as Record<
      string,
      unknown
    >;
    envelope.schemaVersion = 9;
    envelope.contentVersion = '2026.08.1';
    const actions = (envelope.state as Record<string, unknown>).actions as Record<string, unknown>;
    delete actions.personalTasks;

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.actions.slots.primary.occupants[0]).toMatchObject({
      actionId: 'task_policy_study',
      deptId: PERSONAL_TASK_LEDGER_ID,
    });
    expect(result.state?.actions.personalTasks.totalCompleted).toBe(0);
  });
});
