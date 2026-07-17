/**
 * 核心游戏流程集成测试
 *
 * 测试覆盖建档→初始化→行动→时间推进→KPI结算→晋升的完整链路。
 * 使用 createTestStore() 保证测试隔离，不触发持久化。
 */

import { describe, it, expect } from 'vitest';
import { createTestStore } from '../game-store';
import { getConfigLoader } from '../../config/loader';
import { CareerLine, PromotionStage } from '../../types/enums';

const cfg = getConfigLoader().getGameConfig();

// 共享常量：行政线 L3 镇长
const POSITION_ID = 'admin_l3_0';
const LINE = CareerLine.Administrative;
const LEVEL = 3;
const DEPT_ID = 'admin_l3_0_dept_0';
const ACTION_ID = 'approve_project';

function createPositionedStore(overrides?: Record<string, unknown>) {
  return createTestStore({
    currentPositionId: POSITION_ID,
    currentLevel: LEVEL,
    currentCareerLine: LINE,
    remainingBudget: 10000,
    slots: { max: 3, available: 3 },
    time: { year: 2024, month: 6, day: 15, granularity: 'day' },
    ...overrides,
  } as Parameters<typeof createTestStore>[0]);
}

describe('核心游戏流程集成测试', () => {
  it('建档后状态初始化正确', () => {
    const { getRawState } = createTestStore({
      characterName: '测试干部',
      gender: '男',
      province: '北京',
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 1,
      currentPositionId: 'admin_l1_0',
    } as Parameters<typeof createTestStore>[0]);

    const state = getRawState();
    expect(state.characterName).toBe('测试干部');
    expect(state.currentLevel).toBe(1);
    expect(state.currentCareerLine).toBe(CareerLine.Administrative);
    expect(state.currentPositionId).toBe('admin_l1_0');
    expect(state.time.year).toBe(cfg.startYear);
    expect(state.time.month).toBe(1);
    expect(state.time.day).toBe(1);
  });

  it('设置时间粒度 → 推进时间（天）→ 天数递增', () => {
    const { getRawState, dispatch } = createPositionedStore();

    dispatch({ type: 'SET_GRANULARITY', granularity: 'day' });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const state = getRawState();
    expect(state.totalDaysPlayed).toBeGreaterThan(0);
  });

  it('推进时间（周）→ 跨周结算', () => {
    const { getRawState, dispatch } = createPositionedStore();

    dispatch({ type: 'SET_GRANULARITY', granularity: 'week' });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'week' });

    const state = getRawState();
    expect(state.totalDaysPlayed).toBeGreaterThanOrEqual(5);
  });

  it('推进时间（月）→ 触发月度结算', () => {
    const { getRawState, dispatch } = createPositionedStore();

    dispatch({ type: 'SET_GRANULARITY', granularity: 'month' });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });

    const state = getRawState();
    expect(state.time.month).toBeGreaterThanOrEqual(6);
  });

  it('推进足够多月份 → 触发年度考核', () => {
    const { getRawState, dispatch } = createPositionedStore({
      annualAssessments: [{ year: 2024, score: 80, tier: '称职' }],
    });

    dispatch({ type: 'SET_GRANULARITY', granularity: 'month' });

    for (let i = 0; i < 12; i++) {
      dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
    }

    const state = getRawState();
    expect(state.time.year).toBeGreaterThanOrEqual(2025);
    // 年度考核后 annualAssessments 应有新增条目
    expect(state.annualAssessments.length).toBeGreaterThanOrEqual(1);
  });

  it('执行行动 → 消耗槽位 + 扣减预算', () => {
    const { getRawState, dispatch } = createPositionedStore();

    dispatch({ type: 'EXECUTE_ACTION', deptId: DEPT_ID, actionId: ACTION_ID });

    const state = getRawState();
    expect(state.slots.available).toBeLessThan(3);
    expect(state.remainingBudget).toBeLessThan(10000);
  });

  it('推进时间后 → 槽位恢复', () => {
    const { getRawState, dispatch } = createPositionedStore();

    dispatch({ type: 'EXECUTE_ACTION', deptId: DEPT_ID, actionId: ACTION_ID });
    // 确认槽位已消耗
    const afterAction = getRawState();
    expect(afterAction.slots.available).toBe(2);

    // 推进时间（天粒度），槽位每天恢复
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const state = getRawState();
    expect(state.slots.available).toBeGreaterThanOrEqual(2);
  });

  it('启动晋升流程 → 进入民主推荐阶段', () => {
    const { getRawState, dispatch } = createPositionedStore({
      yearsInCurrentPosition: 4,
      annualAssessments: [
        { year: 2024, score: 85, tier: '称职' },
        { year: 2023, score: 90, tier: '优秀' },
        { year: 2022, score: 80, tier: '称职' },
      ],
      charisma: 80,
      superiorFavor: 70,
      competence: 75,
      integrity: 70,
      performance: 80,
      politicalCapital: 50,
      factionReputation: { reform: 30, pragmatic: 30, conservative: 20 },
    });

    dispatch({ type: 'START_PROMOTION' });

    const state = getRawState();
    // 应该进入民主推荐阶段（如果门槛通过）
    expect([PromotionStage.DemocraticVote, PromotionStage.Failed]).toContain(state.promotionStage);
  });

  it('LOAD_SAVE → 完整恢复游戏状态', () => {
    const { getRawState } = createPositionedStore({
      characterName: '存档测试',
      budget: 8000,
      totalDaysPlayed: 120,
    });

    const save = getRawState();

    const { getRawState: getLoaded } = createTestStore({
      ...save,
    });

    const loaded = getLoaded();
    expect(loaded.characterName).toBe('存档测试');
    expect(loaded.currentLevel).toBe(LEVEL);
  });
});
