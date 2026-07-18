import { describe, it, expect } from 'vitest';
import { createInitialState, createTestStore, dispatch } from '../game-store';
// 模块级 dispatch（而非 createTestStore）在此文件中用于持久化测项，
// 因为 createTestStore 的 dispatch 故意不触发 localStorage 写入。
import type { PlayerSave, SlotOccupant } from '../../types/player';
import { CareerLine, PromotionStage } from '../../types/enums';

function occ(
  actionId: string,
  deptId = 'd',
  actionName = 'A',
  startedAtDay = 0,
  durationDays = 3,
): SlotOccupant {
  return { actionId, deptId, actionName, startedAtDay, durationDays };
}

describe('createInitialState', () => {
  it('creates valid default state', () => {
    const state = createInitialState();
    expect(state.currentLevel).toBe(1);
    expect(state.currentCareerLine).toBe(CareerLine.Administrative);
    expect(state.time.year).toBe(2012);
    expect(state.time.month).toBe(1);
    expect(state.time.day).toBe(1);
    expect(state.time.granularity).toBe('day');
  });

  it('merges overrides', () => {
    const state = createInitialState({
      characterName: '测试角色',
      currentLevel: 3,
    });
    expect(state.characterName).toBe('测试角色');
    expect(state.currentLevel).toBe(3);
  });

  it('initializes faction reputation to zero', () => {
    const state = createInitialState();
    expect(state.factions.alignment).toBe('independent');
    expect(state.factions.reputation.reform).toBe(0);
    expect(state.factions.reputation.pragmatic).toBe(0);
    expect(state.factions.reputation.conservative).toBe(0);
  });

  it('initializes empty relations', () => {
    const state = createInitialState();
    expect(Object.keys(state.relations.classmates)).toHaveLength(0);
    expect(Object.keys(state.relations.colleagues)).toHaveLength(0);
  });
});

describe('dispatch - START_ACTION', () => {
  const POSITION_ID = 'admin_l3_0';
  const LINE = CareerLine.Administrative;
  const LEVEL = 3;

  const deptId = 'admin_l3_0_dept_0';
  const actionId = 'approve_project';

  function createStoreWithPosition(overrides?: Partial<PlayerSave>) {
    return createTestStore({
      currentPositionId: POSITION_ID,
      currentLevel: LEVEL,
      currentCareerLine: LINE,
      remainingBudget: 10000,
      time: { year: 2024, month: 6, day: 15, granularity: 'day' },
      ...overrides,
    });
  }

  describe('successful execution', () => {
    it('增加总行动计数', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'START_ACTION', deptId, actionId });
      const state = getRawState();
      expect(state.totalActions).toBe(1);
    });

    it('扣减预算', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'START_ACTION', deptId, actionId });
      const state = getRawState();
      expect(state.remainingBudget).toBeLessThan(10000);
    });

    it('将行动放入槽位', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'START_ACTION', deptId, actionId });
      const state = getRawState();
      const occupants = state.slots.primary.occupants;
      expect(occupants.some((o) => o?.actionId === actionId)).toBe(true);
    });

    it('多次执行不同行动累计计数', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'START_ACTION', deptId, actionId: 'approve_project' });
      dispatch({ type: 'START_ACTION', deptId, actionId: 'urban_planning' });
      const state = getRawState();
      expect(state.totalActions).toBe(2);
    });
  });

  describe('validation failures', () => {
    it('槽位不足时不执行', () => {
      const { dispatch, getRawState } = createStoreWithPosition({
        slots: {
          primary: {
            label: '主要',
            count: 3,
            occupants: [occ('a'), occ('b'), occ('c')],
          },
          secondary: { label: '次要', count: 2, occupants: [null, null] },
          reserve: { label: '备用', count: 1, occupants: [null] },
        },
      });
      const before = getRawState();
      dispatch({ type: 'START_ACTION', deptId, actionId });
      expect(getRawState()).toEqual(before);
    });

    it('预算不足时不执行', () => {
      const { dispatch, getRawState } = createStoreWithPosition({
        remainingBudget: 10,
      });
      const before = getRawState();
      dispatch({ type: 'START_ACTION', deptId, actionId });
      expect(getRawState()).toEqual(before);
    });

    // approve_project 的 minTier 为 'secondary'，仅允许 primary(0)/secondary(1)，
    // 不允许 reserve(2)。当 primary 和 secondary 全满时，action 不会溢出到 reserve。
    it('primary + secondary 满时不会溢出到 reserve', () => {
      const { dispatch, getRawState } = createStoreWithPosition({
        slots: {
          primary: {
            label: '主要',
            count: 3,
            occupants: [occ('a'), occ('b'), occ('c')],
          },
          secondary: {
            label: '次要',
            count: 2,
            occupants: [occ('d'), occ('e')],
          },
          reserve: { label: '备用', count: 1, occupants: [null] },
        },
      });
      const before = getRawState();
      dispatch({ type: 'START_ACTION', deptId, actionId });
      // 状态不变——因为 reserve 对 minTier: 'secondary' 不可达
      expect(getRawState()).toEqual(before);
      // reserve 槽位仍为空
      expect(getRawState().slots.reserve.occupants[0]).toBeNull();
    });
  });
});

describe('dispatch - ADVANCE_TIME (integration)', () => {
  const POSITION_ID = 'admin_l3_0';
  const LINE = CareerLine.Administrative;
  const LEVEL = 3;
  const deptId = 'admin_l3_0_dept_0';
  const actionId = 'approve_project';

  function mkStore(overrides?: Partial<PlayerSave>) {
    return createTestStore({
      currentPositionId: POSITION_ID,
      currentLevel: LEVEL,
      currentCareerLine: LINE,
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
        },
      },
      ...overrides,
    });
  }

  it('ADVANCE_TIME 后已完成行动清空槽位', () => {
    const { dispatch, getRawState } = mkStore({
      slots: {
        primary: {
          label: '主要',
          count: 3,
          occupants: [occ(actionId, deptId, 'A', 0, 1), null, null],
        },
        secondary: { label: '次要', count: 2, occupants: [null, null] },
        reserve: { label: '备用', count: 1, occupants: [null] },
      },
    });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(getRawState().slots.primary.occupants[0]).toBeNull();
  });

  it('ADVANCE_TIME 后 KPI 增加值', () => {
    const { dispatch, getRawState } = mkStore({
      slots: {
        primary: {
          label: '主要',
          count: 3,
          occupants: [occ(actionId, deptId, 'A', 0, 1), null, null],
        },
        secondary: { label: '次要', count: 2, occupants: [null, null] },
        reserve: { label: '备用', count: 1, occupants: [null] },
      },
    });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    const state = getRawState();
    expect(state.departmentStates[deptId]?.kpiValues['project_completion'] ?? 0).toBe(10);
  });

  it('ADVANCE_TIME 后生成通知', () => {
    const { dispatch, getRawState } = mkStore({
      slots: {
        primary: {
          label: '主要',
          count: 3,
          occupants: [occ(actionId, deptId, 'A', 0, 1), null, null],
        },
        secondary: { label: '次要', count: 2, occupants: [null, null] },
        reserve: { label: '备用', count: 1, occupants: [null] },
      },
    });
    dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    const notifications = getRawState().lastCompletedActions;
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]!.actionName).toBe('A');
    expect(notifications[0]!.effects.length).toBeGreaterThan(0);
  });
});

describe('dispatch - promotion lifecycle', () => {
  const passingAssessments = [
    { year: 2013, score: 80, tier: '称职' },
    { year: 2014, score: 82, tier: '称职' },
    { year: 2015, score: 85, tier: '称职' },
  ];

  it('存在在途行动时不启动晋升', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 1,
      currentPositionId: 'admin_l1_0',
      yearsInCurrentPosition: 3,
      annualAssessments: passingAssessments,
      slots: {
        primary: {
          label: '主要',
          count: 3,
          occupants: [occ('pending'), null, null],
        },
        secondary: { label: '次要', count: 2, occupants: [null, null] },
        reserve: { label: '备用', count: 1, occupants: [null] },
      },
    });

    store.dispatch({ type: 'START_PROMOTION' });

    expect(store.getRawState().promotionStage).toBe(PromotionStage.Idle);
    expect(store.getRawState().promotionAttempts).toBe(0);
  });

  it('活动阶段不能重置晋升', () => {
    const store = createTestStore({
      promotionStage: PromotionStage.DemocraticVote,
      promotionState: {
        currentStage: PromotionStage.DemocraticVote,
        targetPositionId: 'admin_l2_0',
        targetLevel: 2,
        stageResults: {},
      },
    });

    store.dispatch({ type: 'RESET_PROMOTION' });

    expect(store.getRawState().promotionStage).toBe(PromotionStage.DemocraticVote);
    expect(store.getRawState().promotionState?.targetLevel).toBe(2);
  });

  it('完成态重置后可启动下一等级晋升', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 3,
      annualAssessments: passingAssessments,
      promotionStage: PromotionStage.Completed,
      promotionState: {
        currentStage: PromotionStage.Completed,
        targetPositionId: 'admin_l2_0',
        targetLevel: 2,
        stageResults: {},
      },
    });

    store.dispatch({ type: 'RESET_PROMOTION' });
    store.dispatch({ type: 'START_PROMOTION' });

    const state = store.getRawState();
    expect(state.promotionStage).toBe(PromotionStage.DemocraticVote);
    expect(state.promotionState?.targetLevel).toBe(3);
    expect(state.promotionState?.targetPositionId).toBe('admin_l3_0');
  });

  it('拒绝异常存档中的跨级晋升目标', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 1,
      currentPositionId: 'admin_l1_0',
      competence: 100,
      promotionStage: PromotionStage.Probation,
      promotionState: {
        currentStage: PromotionStage.Probation,
        targetPositionId: 'admin_l3_0',
        targetLevel: 3,
        stageResults: {},
      },
    });

    store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: () => 1 });

    expect(store.getRawState().currentLevel).toBe(1);
    expect(store.getRawState().currentPositionId).toBe('admin_l1_0');
    expect(store.getRawState().promotionStage).toBe(PromotionStage.Failed);

    store.dispatch({ type: 'RESET_PROMOTION' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.Idle);
  });
});

describe('dispatch - persistence (localStorage)', () => {
  const SAVE_KEY = 'zhengtu_autosave';

  // 使用模块级 dispatch 而非 createTestStore：
  // 此测项需要验证 localStorage 写入行为，而 createTestStore 的 dispatch
  // 故意不触发持久化，以保持测试隔离。
  it('ADVANCE_TIME 后写入 localStorage', () => {
    dispatch({
      type: 'LOAD_SAVE',
      save: createInitialState({
        characterName: '测试',
        currentPositionId: 'admin_l3_0',
        currentLevel: 3,
        currentCareerLine: CareerLine.Administrative,
        userId: 'test-user',
        saveId: 'test-save',
        time: { year: 2024, month: 6, day: 15, granularity: 'day' },
      }),
    });

    dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });

    const saved = localStorage.getItem(SAVE_KEY);
    expect(saved).not.toBeNull();
    const content = JSON.parse(saved!);
    expect(content.characterName).toBe('测试');
  });

  it('NEW_GAME 后写入 localStorage', () => {
    dispatch({
      type: 'NEW_GAME',
      data: {
        characterName: '新角色',
        gender: '男',
        birthPlace: { province: '北京市', city: '海淀区' },
        birthYear: 1990,
        gaokaoScore: 600,
        gaokaoTier: '211',
        university: '北京工业大学',
        universityTier: '211',
        familyBackground: 'worker',
        promotionPath: 'gongwuyuan',
        isPreparatory: false,
        currentPositionId: 'admin_l1_0',
        remainingBudget: 800,
      },
    });

    const saved = localStorage.getItem(SAVE_KEY);
    expect(saved).not.toBeNull();
    const content = JSON.parse(saved!);
    expect(content.characterName).toBe('新角色');
  });

  it('createTestStore 的 dispatch 不写 localStorage（测试隔离）', () => {
    localStorage.clear();
    const store = createTestStore({
      characterName: '隔离测试',
      currentPositionId: 'admin_l3_0',
      currentLevel: 3,
      currentCareerLine: CareerLine.Administrative,
      time: { year: 2024, month: 6, day: 15, granularity: 'day' },
    });

    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it('NEW_GAME 初始化当前职位的所有部门', () => {
    const store = createTestStore();
    store.dispatch({
      type: 'NEW_GAME',
      data: {
        characterName: '测试角色',
        currentPositionId: 'admin_l1_0',
        currentLevel: 1,
        currentCareerLine: CareerLine.Administrative,
      },
    });

    const deptIds = Object.keys(store.getRawState().departmentStates);
    expect(deptIds).toEqual([
      'admin_l1_0_dept_0',
      'admin_l1_0_dept_1',
      'admin_l1_0_dept_2',
      'admin_l1_0_dept_3',
    ]);
  });

  it('NEW_GAME 职位不存在时 departmentStates 保持空', () => {
    const store = createTestStore();
    store.dispatch({
      type: 'NEW_GAME',
      data: {
        characterName: '测试角色',
        currentPositionId: 'nonexistent',
        currentLevel: 99,
      },
    });

    expect(store.getRawState().departmentStates).toEqual({});
  });

  it('晋升成功后重置部门状态为新职位部门', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 1,
      currentPositionId: 'admin_l1_0',
      competence: 100,
      remainingBudget: 125,
      comprehensiveScore: 88,
      yearsInCurrentPosition: 3,
      annualAssessments: [
        { year: 2013, score: 80, tier: '称职' },
        { year: 2014, score: 88, tier: '优秀' },
      ],
      promotionStage: PromotionStage.Appointment,
      promotionState: {
        currentStage: PromotionStage.Appointment,
        targetPositionId: 'admin_l2_0',
        targetLevel: 2,
        stageResults: {},
      },
      departmentStates: {
        old_dept: {
          id: 'old_dept',
          kpiValues: { some_kpi: 100 },
          monthlyConsumption: 50,
          cumulativeConsumption: 500,
          lastActionDay: 10,
        },
      },
    });

    store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.Probation);

    store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: () => 1 });

    const state = store.getRawState();
    expect(state.promotionStage).toBe(PromotionStage.Completed);
    expect(state.currentPositionId).toBe('admin_l2_0');
    expect(state.currentLevel).toBe(2);
    expect(state.yearsInCurrentPosition).toBe(0);
    expect(state.remainingBudget).toBe(2000);
    expect(state.comprehensiveScore).toBe(0);
    expect(state.annualAssessments).toEqual([]);
    expect(state.careerHistory).toMatchObject([
      {
        positionId: 'admin_l1_0',
        assessmentResults: [
          { year: 2013, score: 80, tier: '称职' },
          { year: 2014, score: 88, tier: '优秀' },
        ],
      },
    ]);

    expect(state.departmentStates['old_dept']).toBeUndefined();

    const newDeptIds = Object.keys(state.departmentStates);
    expect(newDeptIds).toEqual([
      'admin_l2_0_dept_0',
      'admin_l2_0_dept_1',
      'admin_l2_0_dept_2',
      'admin_l2_0_dept_3',
    ]);

    expect(state.departmentStates).toMatchObject({
      admin_l2_0_dept_1: {
        id: 'admin_l2_0_dept_1',
        kpiValues: {},
        monthlyConsumption: 0,
        cumulativeConsumption: 0,
        lastActionDay: 0,
      },
    });
  });
});
