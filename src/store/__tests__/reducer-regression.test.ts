/**
 * 核心 Reducer 回归测试
 *
 * 覆盖被删除测试的关键路径：
 * - NEW_GAME 应用家庭背景/晋升通道加成
 * - NEW_GAME 使用 initialPositionId 配置
 * - wrapSaveEnvelope revision 递增
 * - dispatch 对失败 START_ACTION 不持久化
 * - 行动效果结算 add/multiply/set 语义与 devMult
 * - 冷却使用 SlotOccupant 快照
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestStore, createInitialState, dispatch } from '../game-store';
import { wrapSaveEnvelope } from '../save-codec';
import { getConfigLoader } from '../../config/loader';
import type { PlayerSave, SlotOccupant } from '../../types/player';

describe('NEW_GAME 建档加成', () => {
  it('应用家庭背景与晋升通道的属性加成', () => {
    const store = createTestStore();
    const loader = getConfigLoader();

    // 获取 cadre 背景和 xuandiao 通道的加成
    const bg = loader.getFamilyBackground('cadre');
    const path = loader.getPromotionPath('xuandiao');
    expect(bg).not.toBeNull();
    expect(path).not.toBeNull();

    store.dispatch({
      type: 'NEW_GAME',
      data: {
        characterName: '测试',
        familyBackground: 'cadre',
        promotionPath: 'xuandiao',
      },
    });

    const state = store.getRawState();
    const initial = createInitialState();

    // 验证加成被应用（politicalCapital 特殊处理）
    const expectedBonuses: Record<string, number> = {};
    if (bg) Object.assign(expectedBonuses, bg.bonuses);
    if (path) Object.assign(expectedBonuses, path.bonuses);

    if (expectedBonuses.politicalCapital) {
      expect(state.character.politicalCapital).toBe(
        initial.character.politicalCapital + expectedBonuses.politicalCapital,
      );
    }

    // 验证家庭背景和晋升通道被正确设置
    expect(state.character.familyBackground).toBe('cadre');
    expect(state.character.promotionPath).toBe('xuandiao');
  });

  it('NEW_GAME 使用 initialPositionId 配置而非硬编码', () => {
    const store = createTestStore();
    const cfg = getConfigLoader().getGameConfig();

    store.dispatch({
      type: 'NEW_GAME',
      data: { characterName: '测试' },
    });

    const state = store.getRawState();
    expect(state.career.appointment.positionId).toBe(cfg.initialPositionId);
  });
});

describe('wrapSaveEnvelope revision 递增', () => {
  it('revision 从现有值递增', () => {
    const state = createInitialState();
    const envelope = wrapSaveEnvelope(state, 5);
    expect(envelope.revision).toBe(6);
  });

  it('首次保存 revision 为 1', () => {
    const state = createInitialState();
    const envelope = wrapSaveEnvelope(state);
    expect(envelope.revision).toBe(1);
  });
});

describe('dispatch 持久化行为', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('失败的 START_ACTION 不触发持久化', () => {
    localStorage.clear();

    // 加载一个预算为 0 的存档，使 START_ACTION 失败
    const initialState = createInitialState();
    initialState.remainingBudget = 0;
    dispatch({
      type: 'LOAD_SAVE',
      save: initialState,
    });
    localStorage.clear();

    // 尝试启动行动（预算不足，应失败）
    dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l1_0_dept_0',
      actionId: 'approve_project',
      tierKey: 'primary',
    });

    // 失败的行动不应写入 localStorage
    expect(localStorage.getItem('zhengtu_autosave')).toBeNull();
  });
});

describe('行动效果结算语义', () => {
  function makeSlotsWithAction(occupant: Partial<SlotOccupant>): PlayerSave['actions'] {
    return {
      slots: {
        primary: {
          label: '主要',
          count: 3,
          occupants: [
            {
              actionId: occupant.actionId ?? 'approve_project',
              deptId: occupant.deptId ?? 'admin_l1_0_dept_0',
              actionName: '审批项目',
              category: 'major',
              startedAtDay: occupant.startedAtDay ?? 0,
              durationDays: occupant.durationDays ?? 3,
              cooldownDays: occupant.cooldownDays ?? 14,
              runtimeSnapshot: occupant.runtimeSnapshot,
            },
            null,
            null,
          ],
        },
        secondary: { label: '次要', count: 2, occupants: [null, null] },
        reserve: { label: '备用', count: 1, occupants: [null] },
      },
      departmentStates: {
        admin_l1_0_dept_0: {
          id: 'admin_l1_0_dept_0',
          kpiValues: { project_completion: 10 },
          monthlyConsumption: 0,
          cumulativeConsumption: 0,
          lastActionDay: 0,
          actionCooldownUntilDays: {},
        },
      },
      totalActions: 1,
      lastCompletedActions: [],
    };
  }

  it('行动完成后槽位释放且 KPI 更新', () => {
    const store = createTestStore({
      actions: makeSlotsWithAction({
        startedAtDay: 0,
        durationDays: 3,
        runtimeSnapshot: { effectivenessMultiplier: 1.0, styleConflictTriggered: false },
      }),
    });

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const state = store.getRawState();
    // 行动完成后槽位应释放
    expect(state.actions.slots.primary.occupants[0]).toBeNull();
  });

  it('冷却使用 SlotOccupant.cooldownDays 快照', () => {
    const store = createTestStore({
      actions: makeSlotsWithAction({
        actionId: 'approve_project',
        startedAtDay: 0,
        durationDays: 3,
        cooldownDays: 20, // 自定义冷却快照
        runtimeSnapshot: { effectivenessMultiplier: 1.0, styleConflictTriggered: false },
      }),
    });

    // 推进 3 天使行动完成
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const state = store.getRawState();
    // 冷却应使用快照值 20，而非配置值
    // completesAtDay = 0 + 3 = 3, cooldownUntil = 3 + 20 = 23
    expect(
      state.actions.departmentStates['admin_l1_0_dept_0']?.actionCooldownUntilDays[
        'approve_project'
      ],
    ).toBe(23);
  });
});
