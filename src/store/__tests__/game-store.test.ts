import { describe, it, expect } from 'vitest';
import { createInitialState, createTestStore, dispatch } from '../game-store';
// 模块级 dispatch（而非 createTestStore）在此文件中用于持久化测项，
// 因为 createTestStore 的 dispatch 故意不触发 localStorage/Supabase 写入。
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
