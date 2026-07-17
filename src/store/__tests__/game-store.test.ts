import { describe, it, expect } from 'vitest';
import { createInitialState, createTestStore, dispatch } from '../game-store';
import type { PlayerSave } from '../../types/player';
import { CareerLine, PromotionStage } from '../../types/enums';

describe('createInitialState', () => {
  it('creates valid default state', () => {
    const state = createInitialState();
    expect(state.currentLevel).toBe(1);
    expect(state.currentCareerLine).toBe(CareerLine.Administrative);
    expect(state.slots.available).toBe(3);
    expect(state.slots.max).toBe(3);
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
    expect(state.slots.available).toBe(3);
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

describe('dispatch - EXECUTE_ACTION', () => {
  // 使用行政线 L3 镇长职位（id: admin_l3_0）
  // 镇长部门：[ndrc, finance, commerce, land_resources, urban_dev]
  // dept id = admin_l3_0_dept_4 (urban_dev), action id = approve_project
  const POSITION_ID = 'admin_l3_0';
  const LINE = CareerLine.Administrative;
  const LEVEL = 3;
  const deptId = 'admin_l3_0_dept_4';
  const actionId = 'approve_project';

  function createStoreWithPosition(overrides?: Partial<PlayerSave>) {
    return createTestStore({
      currentPositionId: POSITION_ID,
      currentLevel: LEVEL,
      currentCareerLine: LINE,
      remainingBudget: 10000,
      slots: { max: 3, available: 3 },
      time: { year: 2024, month: 6, day: 15, granularity: 'day' },
      ...overrides,
    });
  }

  describe('successful execution', () => {
    it('消耗槽位', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const state = getRawState();
      expect(state.slots.available).toBe(2);
      expect(state.totalActions).toBe(1);
    });

    it('扣减预算', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const state = getRawState();
      expect(state.remainingBudget).toBeLessThan(10000);
    });

    it('更新部门 KPI 值', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const state = getRawState();
      const dept = state.departmentStates[deptId];
      expect(dept).toBeDefined();
      // approve_project 影响 project_completion
      expect(dept!.kpiValues['project_completion']).toBeGreaterThan(0);
    });

    it('设置行动冷却', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const state = getRawState();
      const dept = state.departmentStates[deptId];
      // approve_project cooldownDays = 3, totalDaysPlayed = daysAdvanced(2) after execution
      expect(dept!.actionCooldowns[actionId]).toBeGreaterThan(0);
    });

    it('推进游戏天数', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const state = getRawState();
      // slotCost=1 → daysAdvanced=ceil(1*1.5)=2
      expect(state.totalDaysPlayed).toBeGreaterThan(0);
    });

    it('多次执行不同行动累计槽位消耗', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      // approve_project (slotCost=1) 和 urban_planning (slotCost=1) 的冷却互不影响
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId: 'approve_project' });
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId: 'urban_planning' });
      const state = getRawState();
      expect(state.slots.available).toBe(1);
      expect(state.totalActions).toBe(2);
    });
  });

  describe('validation failures', () => {
    it('槽位不足时不执行', () => {
      const { dispatch, getRawState } = createStoreWithPosition({
        slots: { max: 3, available: 0 },
      });
      const before = getRawState();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      expect(getRawState()).toEqual(before);
    });

    it('冷却中时不执行', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const afterFirst = getRawState();
      // 立即再次执行同一行动 → 应被冷却阻止
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const afterSecond = getRawState();
      expect(afterSecond.totalActions).toBe(afterFirst.totalActions);
    });

    it('预算不足时不执行', () => {
      const { dispatch, getRawState } = createStoreWithPosition({
        remainingBudget: 10, // approve_project 消耗 50
      });
      const before = getRawState();
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      expect(getRawState()).toEqual(before);
    });
  });

  describe('player attribute changes', () => {
    it('带 player 效果的属性正确变更', () => {
      // urban_dev 的 staff_meeting 行动影响 player.competence
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'EXECUTE_ACTION', deptId: 'admin_l3_0_dept_0', actionId: 'staff_meeting' });
      const state = getRawState();
      // staff_meeting 第一个 effect 是 dept.kpi，第二个是 player.competence +1
      expect(state.competence).toBeGreaterThanOrEqual(50);
    });
  });

  describe('time advance triggers', () => {
    it('跨越月底时触发月度结算', () => {
      // 使用月末日期：6月30日
      const { dispatch, getRawState } = createStoreWithPosition({
        time: { year: 2024, month: 6, day: 30, granularity: 'day' },
      });
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const state = getRawState();
      // 推进2天，跨到7月
      expect(state.time.month).toBe(7);
      // 部门消耗已扣除
      const dept = state.departmentStates[deptId];
      expect(dept!.cumulativeConsumption).toBeGreaterThan(0);
    });

    it('跨越年底时触发年度考核', () => {
      const { dispatch, getRawState } = createStoreWithPosition({
        time: { year: 2024, month: 12, day: 30, granularity: 'day' },
        yearsInCurrentPosition: 2,
      });
      dispatch({ type: 'EXECUTE_ACTION', deptId, actionId });
      const state = getRawState();
      expect(state.time.year).toBe(2025);
      expect(state.annualAssessments.length).toBe(1);
      expect(state.yearsInCurrentPosition).toBe(3);
    });
  });
});

describe('dispatch - ADVANCE_TIME', () => {
  it('推进一天：日期 +1，槽位重置，totalDaysPlayed 增加', () => {
    const store = createTestStore({
      currentPositionId: 'admin_l3_0',
      currentLevel: 3,
      currentCareerLine: CareerLine.Administrative,
      time: { year: 2024, month: 6, day: 15, granularity: 'day' },
      slots: { max: 3, available: 1 },
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day' });
    const state = store.getRawState();
    expect(state.time.day).toBe(16);
    expect(state.slots.available).toBe(3);
    expect(state.totalDaysPlayed).toBe(1);
  });

  it('推进一周', () => {
    const store = createTestStore({
      currentPositionId: 'admin_l3_0',
      currentLevel: 3,
      currentCareerLine: CareerLine.Administrative,
      time: { year: 2024, month: 6, day: 15, granularity: 'week' },
      slots: { max: 4, available: 2 },
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'week' });
    const state = store.getRawState();
    expect(state.totalDaysPlayed).toBe(7);
    expect(state.slots.available).toBe(4);
  });
});

describe('dispatch - persistence (localStorage)', () => {
  const SAVE_KEY = 'zhengtu_autosave';

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
          actionCooldowns: {},
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

    expect(state.departmentStates['old_dept']).toBeUndefined();

    const newDeptIds = Object.keys(state.departmentStates);
    expect(newDeptIds).toEqual([
      'admin_l2_0_dept_0',
      'admin_l2_0_dept_1',
      'admin_l2_0_dept_2',
      'admin_l2_0_dept_3',
      'admin_l2_0_dept_4',
    ]);

    expect(state.departmentStates).toMatchObject({
      admin_l2_0_dept_1: {
        id: 'admin_l2_0_dept_1',
        kpiValues: {},
        monthlyConsumption: 0,
        cumulativeConsumption: 0,
        actionCooldowns: {},
        lastActionDay: 0,
      },
    });
  });
});
