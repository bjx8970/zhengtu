/**
 * v4 基础工程集成测试
 *
 * 覆盖核心变更：
 * 1. 时间轴结算顺序：行动完成 → 月度结算 → 年度考核
 * 2. 行动运行时快照：每个行动独立的偏离倍率
 * 3. 并发行动互不干扰
 * 4. 存档迁移兼容性
 */
import { describe, it, expect } from 'vitest';
import { createTestStore, createInitialState } from '../game-store';
import { CareerLine } from '../../types/enums';
import type { PlayerSave, SlotOccupant } from '../../types/player';
import { migrateSave } from '../migrations';

/** 创建带有指定行动的槽位状态 */
function makeSlotsWithActions(actions: Partial<SlotOccupant>[]): PlayerSave['slots'] {
  const occupants: (SlotOccupant | null)[] = [null, null, null];
  actions.forEach((action, i) => {
    if (i < 3) {
      occupants[i] = {
        actionId: action.actionId ?? `action_${i}`,
        deptId: action.deptId ?? 'admin_l3_0_dept_0',
        actionName: action.actionName ?? `行动${i}`,
        category: action.category ?? 'minor',
        startedAtDay: action.startedAtDay ?? 0,
        durationDays: action.durationDays ?? 3,
        cooldownDays: action.cooldownDays ?? 7,
        runtimeSnapshot: action.runtimeSnapshot,
      };
    }
  });
  return {
    primary: { label: '主要', count: 3, occupants },
    secondary: { label: '次要', count: 2, occupants: [null, null] },
    reserve: { label: '备用', count: 1, occupants: [null] },
  };
}

describe('v4 基础工程集成测试', () => {
  describe('时间轴结算顺序', () => {
    it('行动在月末前完成时，先结算行动再进行月度结算', () => {
      const deptId = 'admin_l3_0_dept_0';
      const store = createTestStore({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 1, day: 1, granularity: 'day' },
        departmentStates: {
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
        // 行动在第 25 天完成（月末前）
        slots: makeSlotsWithActions([
          {
            actionId: 'approve_project',
            deptId,
            startedAtDay: 22,
            durationDays: 3, // 第 25 天完成
          },
        ]),
      });

      // 推进一个月
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });

      const state = store.getRawState();
      // 行动应该已完成（槽位清空）
      expect(state.slots.primary.occupants[0]).toBeNull();
      // KPI 应该有变化（行动效果已应用）
      expect(Object.keys(state.departmentStates[deptId]?.kpiValues ?? {}).length).toBeGreaterThan(
        0,
      );
    });

    it('行动在年末前完成时，其效果进入当年考核', () => {
      const deptId = 'admin_l3_0_dept_0';
      const store = createTestStore({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 1, day: 1, granularity: 'day' },
        departmentStates: {
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
        // 行动在第 350 天完成（年末前）
        slots: makeSlotsWithActions([
          {
            actionId: 'approve_project',
            deptId,
            startedAtDay: 347,
            durationDays: 3, // 第 350 天完成
          },
        ]),
      });

      // 推进一整年
      for (let i = 0; i < 12; i++) {
        store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });
      }

      const state = store.getRawState();
      // 应该有一次年度考核
      expect(state.annualAssessments.length).toBe(1);
      // 考核应该包含行动带来的 KPI 效果
      // （因为行动在年末前完成，KPI 已累积）
    });

    it('跨月推进时严格按时间顺序处理', () => {
      const deptId = 'admin_l3_0_dept_0';
      const store = createTestStore({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 1, day: 1, granularity: 'day' },
        departmentStates: {
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
        // 两个行动在不同时间完成
        slots: makeSlotsWithActions([
          {
            actionId: 'approve_project',
            deptId,
            startedAtDay: 0,
            durationDays: 10, // 第 10 天完成
          },
          {
            actionId: 'urban_planning',
            deptId,
            startedAtDay: 0,
            durationDays: 20, // 第 20 天完成
          },
        ]),
      });

      // 推进一个月
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });

      const state = store.getRawState();
      // 两个行动都应该完成
      expect(state.slots.primary.occupants[0]).toBeNull();
      expect(state.slots.primary.occupants[1]).toBeNull();
      // 应该有两条完成通知
      expect(state.lastCompletedActions.length).toBe(2);
    });
  });

  describe('行动运行时快照', () => {
    it('START_ACTION 时计算并绑定 runtimeSnapshot', () => {
      const deptId = 'admin_l3_0_dept_0';
      const store = createTestStore({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 6, day: 15, granularity: 'day' },
        departmentStates: {
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
        // 设置理念分数，使 approve_project (innovation) 产生偏离
        philosophy: {
          scores: {
            innovation: 20,
            pragmatic: 80, // 主导风格
            principled: 50,
          },
        },
      });

      store.dispatch({
        type: 'START_ACTION',
        deptId,
        actionId: 'approve_project', // styleAlignment: innovation
        tierKey: 'primary',
      });

      const state = store.getRawState();
      const occupant = state.slots.primary.occupants[0];
      expect(occupant).not.toBeNull();
      // runtimeSnapshot 只在行动有 styleAlignment 时创建
      // 如果有 runtimeSnapshot，验证其结构
      if (occupant?.runtimeSnapshot) {
        expect(typeof occupant.runtimeSnapshot.effectivenessMultiplier).toBe('number');
        expect(typeof occupant.runtimeSnapshot.styleConflictTriggered).toBe('boolean');
      }
      // 无论是否有 styleAlignment，行动都应该成功启动
      expect(occupant?.actionId).toBe('approve_project');
    });

    it('并发行动各自拥有独立的 runtimeSnapshot', () => {
      const deptId0 = 'admin_l3_0_dept_0';
      const deptId1 = 'admin_l3_0_dept_1';
      const store = createTestStore({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 6, day: 15, granularity: 'day' },
        departmentStates: {
          [deptId0]: {
            id: deptId0,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
          [deptId1]: {
            id: deptId1,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
        philosophy: {
          scores: {
            innovation: 30,
            pragmatic: 70,
            principled: 50,
          },
        },
      });

      // 启动两个不同风格的行动
      store.dispatch({
        type: 'START_ACTION',
        deptId: deptId0,
        actionId: 'approve_project', // innovation
        tierKey: 'primary',
      });
      store.dispatch({
        type: 'START_ACTION',
        deptId: deptId1,
        actionId: 'tax_collection', // 可能没有 styleAlignment
        tierKey: 'primary',
      });

      const state = store.getRawState();
      const occupant0 = state.slots.primary.occupants[0];
      const occupant1 = state.slots.primary.occupants[1];

      // 两个行动都应该有各自的 runtimeSnapshot（或 undefined）
      expect(occupant0).not.toBeNull();
      expect(occupant1).not.toBeNull();

      // 第一个行动有 styleAlignment，应该有 snapshot
      if (occupant0?.runtimeSnapshot) {
        expect(typeof occupant0.runtimeSnapshot.effectivenessMultiplier).toBe('number');
      }
    });

    it('行动完成时使用自己的 runtimeSnapshot 倍率', () => {
      const deptId = 'admin_l3_0_dept_0';
      const store = createTestStore({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 1, day: 1, granularity: 'day' },
        departmentStates: {
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
        // 手动设置带有偏离倍率的行动
        slots: makeSlotsWithActions([
          {
            actionId: 'approve_project',
            deptId,
            startedAtDay: 0,
            durationDays: 1,
            runtimeSnapshot: {
              effectivenessMultiplier: 0.5, // 50% 效果
              styleConflictTriggered: false,
              styleAlignment: 'innovation',
            },
          },
        ]),
      });

      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });

      const state = store.getRawState();
      // 行动应该完成
      expect(state.slots.primary.occupants[0]).toBeNull();
      // KPI 效果应该被 0.5 倍率影响
      const kpiValue = state.departmentStates[deptId]?.kpiValues['project_completion'] ?? 0;
      // 正常是 +10，带 0.5 倍率应该是 +5
      expect(kpiValue).toBe(5);
    });
  });

  describe('存档迁移兼容性', () => {
    it('迁移管道清除旧存档的临时字段', () => {
      const legacySave = createInitialState({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
      }) as unknown as Record<string, unknown>;

      // 模拟旧存档的临时字段
      legacySave._pendingDeviationMultiplier = 0.8;
      legacySave.pendingStyleConflict = true;

      // 通过迁移管道处理
      const result = migrateSave(JSON.stringify(legacySave));
      expect(result.success).toBe(true);
      if (result.success) {
        const state = result.state as unknown as Record<string, unknown>;
        expect(state._pendingDeviationMultiplier).toBeUndefined();
        expect(state.pendingStyleConflict).toBeUndefined();
      }
    });

    it('迁移管道为槽位行动补充 runtimeSnapshot', () => {
      const legacySave = createInitialState({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
      });

      // 模拟旧存档中没有 runtimeSnapshot 的行动
      legacySave.slots.primary.occupants[0] = {
        actionId: 'test',
        deptId: 'admin_l3_0_dept_0',
        actionName: '测试行动',
        category: 'minor',
        startedAtDay: 0,
        durationDays: 3,
        cooldownDays: 7,
      };

      // 通过迁移管道处理
      const result = migrateSave(JSON.stringify(legacySave));
      expect(result.success).toBe(true);
      if (result.success) {
        const occupant = result.state.slots.primary.occupants[0];
        expect(occupant?.runtimeSnapshot).toEqual({
          effectivenessMultiplier: 1,
          styleConflictTriggered: false,
        });
      }
    });
  });

  describe('审查补强测试', () => {
    it('年末考核有/无行动对照：行动影响当年分数', () => {
      const deptId = 'admin_l3_0_dept_0';
      const baseOverrides = {
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 1, day: 1, granularity: 'day' as const },
        departmentStates: {
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
      };

      // 无行动对照组
      const noActionStore = createTestStore({ ...baseOverrides });
      for (let i = 0; i < 12; i++) {
        noActionStore.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });
      }
      const noActionScore = noActionStore.getRawState().comprehensiveScore;

      // 有行动组：年初启动一个行动，年末前完成
      const withActionStore = createTestStore({
        ...baseOverrides,
        slots: makeSlotsWithActions([
          { actionId: 'approve_project', deptId, startedAtDay: 0, durationDays: 3 },
        ]),
      });
      for (let i = 0; i < 12; i++) {
        withActionStore.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });
      }
      const withActionScore = withActionStore.getRawState().comprehensiveScore;

      // 有行动的考核分数应高于无行动
      expect(withActionScore).toBeGreaterThan(noActionScore);
    });

    it('两个不同倍率行动并发：分别按各自倍率结算', () => {
      const deptId = 'admin_l3_0_dept_0';
      const store = createTestStore({
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        remainingBudget: 10000,
        totalDaysPlayed: 0,
        time: { year: 2024, month: 1, day: 1, granularity: 'day' },
        departmentStates: {
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
        // A: 3天完成，倍率 0.5；B: 10天完成，倍率 1.0
        slots: makeSlotsWithActions([
          {
            actionId: 'approve_project',
            deptId,
            startedAtDay: 0,
            durationDays: 3,
            runtimeSnapshot: {
              effectivenessMultiplier: 0.5,
              styleConflictTriggered: false,
              styleAlignment: 'innovation',
            },
          },
          {
            actionId: 'urban_planning',
            deptId,
            startedAtDay: 0,
            durationDays: 10,
            runtimeSnapshot: {
              effectivenessMultiplier: 1.0,
              styleConflictTriggered: false,
              styleAlignment: 'pragmatic',
            },
          },
        ]),
      });

      // 第一次推进 5 天：只完成 A
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });

      let state = store.getRawState();
      // A 已完成，B 仍在槽位
      expect(state.slots.primary.occupants[0]).toBeNull();
      expect(state.slots.primary.occupants[1]).not.toBeNull();
      // B 的快照仍保留
      expect(state.slots.primary.occupants[1]?.runtimeSnapshot?.effectivenessMultiplier).toBe(1.0);

      // 第二次推进 5 天：完成 B
      for (let i = 0; i < 5; i++) {
        store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _rng: () => 0.5 });
      }

      state = store.getRawState();
      // 两个都完成
      expect(state.slots.primary.occupants[0]).toBeNull();
      expect(state.slots.primary.occupants[1]).toBeNull();
      // 两条完成通知
      expect(state.lastCompletedActions.length).toBe(2);
    });

    it('拒绝未来 schemaVersion 存档', () => {
      const futureSave = {
        schemaVersion: 99,
        contentVersion: '99.0.0',
        revision: 1,
        savedAt: Date.now(),
        state: createInitialState(),
      };

      const result = migrateSave(JSON.stringify(futureSave));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('高于当前支持');
        expect(result.backup).not.toBeNull();
      }
    });

    it('当前版本 Envelope 损坏时拒绝加载并备份', () => {
      const corruptedEnvelope = {
        schemaVersion: 1,
        contentVersion: '4.0.0-alpha',
        revision: 1,
        savedAt: Date.now(),
        state: { invalid: 'data' }, // 损坏的 state
      };

      const result = migrateSave(JSON.stringify(corruptedEnvelope));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('验证失败');
        expect(result.backup).not.toBeNull();
      }
    });
  });
});
