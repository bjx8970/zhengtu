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
  return {
    actionId,
    deptId,
    actionName,
    category: 'minor',
    startedAtDay,
    durationDays,
    cooldownDays: 7,
  };
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

  it('initializes philosophy scores to zero', () => {
    const state = createInitialState();
    expect(state.philosophy.scores.innovation).toBe(0);
    expect(state.philosophy.scores.pragmatic).toBe(0);
    expect(state.philosophy.scores.principled).toBe(0);
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
      dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'primary' });
      const state = getRawState();
      expect(state.totalActions).toBe(1);
    });

    it('扣减预算', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'primary' });
      const state = getRawState();
      expect(state.remainingBudget).toBeLessThan(10000);
    });

    it('将行动放入槽位', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'primary' });
      const state = getRawState();
      const occupants = state.slots.primary.occupants;
      expect(occupants.some((o) => o?.actionId === actionId)).toBe(true);
    });

    it('多次执行不同行动累计计数', () => {
      const { dispatch, getRawState } = createStoreWithPosition();
      dispatch({ type: 'START_ACTION', deptId, actionId: 'approve_project', tierKey: 'primary' });
      dispatch({ type: 'START_ACTION', deptId, actionId: 'urban_planning', tierKey: 'primary' });
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
      dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'primary' });
      expect(getRawState()).toEqual(before);
    });

    it('预算不足时不执行', () => {
      const { dispatch, getRawState } = createStoreWithPosition({
        remainingBudget: 10,
      });
      const before = getRawState();
      dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'primary' });
      expect(getRawState()).toEqual(before);
    });

    // approve_project 的 category 为 'minor'，minors 允许任意槽位。
    // 当玩家指定 secondary 且 secondary 已满时，action 被拒绝。
    it('指定等级无空槽时不执行', () => {
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
      dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'secondary' });
      expect(getRawState()).toEqual(before);
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
          actionCooldownUntilDays: {},
        },
      },
      ...overrides,
    });
  }

  describe('旧存档不兼容', () => {
    it('裸旧版存档通过 LOAD_SAVE 加载时保持原样（不迁移）', () => {
      const legacySave = structuredClone(mkStore().getRawState());
      const occupant = occ(actionId, deptId, '审批项目', 0, 3);
      legacySave.slots.primary.occupants[0] = occupant;

      // LOAD_SAVE 直接赋值，不做迁移
      const store = createTestStore();
      store.dispatch({ type: 'LOAD_SAVE', save: legacySave });

      const loaded = store.getRawState();
      expect(loaded.slots.primary.occupants[0]?.actionId).toBe(actionId);
    });
  });

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

  it('完成态重置后可启动下一等级晋升（目标选择流程）', () => {
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

    // START_PROMOTION 现在进入目标选择阶段
    let state = store.getRawState();
    expect(state.promotionStage).toBe(PromotionStage.TargetSelection);
    expect(state.promotionState?.targetLevel).toBe(3);
    expect(state.promotionState?.targetPositionId).toBe('');

    // 选择目标职位后进入民主推荐
    store.dispatch({ type: 'SELECT_PROMOTION_TARGET', positionId: 'admin_l3_0' });
    state = store.getRawState();
    expect(state.promotionStage).toBe(PromotionStage.DemocraticVote);
    expect(state.promotionState?.targetPositionId).toBe('admin_l3_0');
  });

  it('目标选择阶段可选择任意合法候选职位', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 3,
      annualAssessments: passingAssessments,
    });

    store.dispatch({ type: 'START_PROMOTION' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.TargetSelection);

    // 选择第二个候选职位（非默认第一个）
    store.dispatch({ type: 'SELECT_PROMOTION_TARGET', positionId: 'admin_l3_1' });
    const state = store.getRawState();
    expect(state.promotionStage).toBe(PromotionStage.DemocraticVote);
    expect(state.promotionState?.targetPositionId).toBe('admin_l3_1');
  });

  it('目标选择阶段选择非法职位 → 失败', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 3,
      annualAssessments: passingAssessments,
    });

    store.dispatch({ type: 'START_PROMOTION' });
    store.dispatch({ type: 'SELECT_PROMOTION_TARGET', positionId: 'nonexistent_pos' });

    const state = store.getRawState();
    expect(state.promotionStage).toBe(PromotionStage.Failed);
  });

  it('目标选择阶段可以重置', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 3,
      annualAssessments: passingAssessments,
    });

    store.dispatch({ type: 'START_PROMOTION' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.TargetSelection);

    store.dispatch({ type: 'RESET_PROMOTION' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.Idle);
    expect(store.getRawState().promotionState).toBeNull();
  });

  it('非目标选择阶段不能执行 SELECT_PROMOTION_TARGET', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      promotionStage: PromotionStage.Idle,
    });

    store.dispatch({ type: 'SELECT_PROMOTION_TARGET', positionId: 'admin_l3_0' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.Idle);
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
    // v4: 存档使用 SaveEnvelope 封装
    expect(content.state.characterName).toBe('测试');
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
    // v4: 存档使用 SaveEnvelope 封装
    expect(content.state.characterName).toBe('新角色');
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
          actionCooldownUntilDays: {},
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
        actionCooldownUntilDays: {},
      },
    });
  });
});

describe('dispatch - action categories (integration)', () => {
  const POSITION_ID = 'admin_l3_0';
  const LINE = CareerLine.Administrative;
  const LEVEL = 3;
  const deptId = 'admin_l3_0_dept_2'; // public_safety: has emergency_drill (major)
  const majorActionId = 'emergency_drill'; // category=major, cooldownDays=14
  const minorDeptId = 'admin_l3_0_dept_0'; // urban_dev: has approve_project (minor)
  const minorActionId = 'approve_project'; // category=minor, cooldownDays=7
  const routineDeptId = 'admin_l3_0_dept_1'; // finance: has tax_collection (routine)
  const routineActionId = 'tax_collection'; // category=routine, cooldownDays=0

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
          actionCooldownUntilDays: {},
        },
        [minorDeptId]: {
          id: minorDeptId,
          kpiValues: {},
          monthlyConsumption: 0,
          cumulativeConsumption: 0,
          lastActionDay: 0,
          actionCooldownUntilDays: {},
        },
        [routineDeptId]: {
          id: routineDeptId,
          kpiValues: {},
          monthlyConsumption: 0,
          cumulativeConsumption: 0,
          lastActionDay: 0,
          actionCooldownUntilDays: {},
        },
      },
      ...overrides,
    });
  }

  describe('重大行动槽位限制', () => {
    it('major 只能用 primary', () => {
      const s = mkStore();
      s.dispatch({ type: 'START_ACTION', deptId, actionId: majorActionId, tierKey: 'primary' });
      expect(s.getRawState().slots.primary.occupants[0]?.actionId).toBe(majorActionId);
    });

    it('major 选 secondary 被拒绝', () => {
      const s = mkStore();
      const before = s.getRawState();
      s.dispatch({ type: 'START_ACTION', deptId, actionId: majorActionId, tierKey: 'secondary' });
      expect(s.getRawState()).toEqual(before);
    });

    it('major 选 reserve 被拒绝', () => {
      const s = mkStore();
      const before = s.getRawState();
      s.dispatch({ type: 'START_ACTION', deptId, actionId: majorActionId, tierKey: 'reserve' });
      expect(s.getRawState()).toEqual(before);
    });
  });

  describe('备用槽位处罚', () => {
    it('minor 选 reserve 成功后扣体魄并降怀抱', () => {
      const s = mkStore({ vigor: 100, ambition: 100 });
      s.dispatch({
        type: 'START_ACTION',
        deptId: minorDeptId,
        actionId: minorActionId,
        tierKey: 'reserve',
      });
      const state = s.getRawState();
      expect(state.slots.reserve.occupants[0]?.actionId).toBe(minorActionId);
      expect(state.vigor).toBe(95);
      expect(state.ambition).toBe(97);
    });

    it('处罚受属性边界钳位', () => {
      const s = mkStore({ vigor: 2, ambition: 2 });
      s.dispatch({
        type: 'START_ACTION',
        deptId: minorDeptId,
        actionId: minorActionId,
        tierKey: 'reserve',
      });
      const state = s.getRawState();
      expect(state.vigor).toBeGreaterThanOrEqual(0);
      expect(state.ambition).toBeGreaterThanOrEqual(0);
    });
  });

  describe('日常行动并行', () => {
    it('routine 同部门同行动可并行启动', () => {
      const s = mkStore();
      s.dispatch({
        type: 'START_ACTION',
        deptId: routineDeptId,
        actionId: routineActionId,
        tierKey: 'primary',
      });
      s.dispatch({
        type: 'START_ACTION',
        deptId: routineDeptId,
        actionId: routineActionId,
        tierKey: 'primary',
      });
      const occs = s.getRawState().slots.primary.occupants;
      expect(occs[0]?.actionId).toBe(routineActionId);
      expect(occs[1]?.actionId).toBe(routineActionId);
    });
  });

  describe('冷却写入', () => {
    it('minor 完成后写入 startedAt + duration + cooldown 为绝对截止日', () => {
      const s = mkStore();
      s.dispatch({
        type: 'START_ACTION',
        deptId: minorDeptId,
        actionId: minorActionId,
        tierKey: 'primary',
      });
      s.dispatch({ type: 'ADVANCE_TIME', granularity: 'week' });
      const cooldowns = s.getRawState().departmentStates[minorDeptId]?.actionCooldownUntilDays;
      expect(cooldowns?.[minorActionId]).toBe(0 + 3 + 7);
    });

    it('跨大步推进仍按名义完成日起算冷却截止日', () => {
      const s = mkStore();
      s.dispatch({
        type: 'START_ACTION',
        deptId: minorDeptId,
        actionId: minorActionId,
        tierKey: 'primary',
      });
      s.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
      const cooldowns = s.getRawState().departmentStates[minorDeptId]?.actionCooldownUntilDays;
      expect(cooldowns?.[minorActionId]).toBe(0 + 3 + 7);
    });

    it('冷却截止日当天可重新启动', () => {
      const s = mkStore({
        totalDaysPlayed: 10,
        departmentStates: {
          [minorDeptId]: {
            id: minorDeptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: { [minorActionId]: 10 },
          },
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
          [routineDeptId]: {
            id: routineDeptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
      });
      s.dispatch({
        type: 'START_ACTION',
        deptId: minorDeptId,
        actionId: minorActionId,
        tierKey: 'primary',
      });
      expect(s.getRawState().slots.primary.occupants[0]?.actionId).toBe(minorActionId);
    });

    it('冷却期内被拒绝', () => {
      const s = mkStore({
        totalDaysPlayed: 9,
        departmentStates: {
          [minorDeptId]: {
            id: minorDeptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: { [minorActionId]: 10 },
          },
          [deptId]: {
            id: deptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
          [routineDeptId]: {
            id: routineDeptId,
            kpiValues: {},
            monthlyConsumption: 0,
            cumulativeConsumption: 0,
            lastActionDay: 0,
            actionCooldownUntilDays: {},
          },
        },
      });
      const before = s.getRawState();
      s.dispatch({
        type: 'START_ACTION',
        deptId: minorDeptId,
        actionId: minorActionId,
        tierKey: 'primary',
      });
      expect(s.getRawState()).toEqual(before);
    });
  });

  describe('失败原子性', () => {
    it('预算不足时不扣预算、不占槽、不增加计数', () => {
      const s = mkStore({ remainingBudget: 1 });
      const before = s.getRawState();
      s.dispatch({
        type: 'START_ACTION',
        deptId: minorDeptId,
        actionId: minorActionId,
        tierKey: 'primary',
      });
      const after = s.getRawState();
      expect(after.remainingBudget).toBe(before.remainingBudget);
      expect(after.totalActions).toBe(before.totalActions);
      expect(after.slots).toEqual(before.slots);
    });

    it('major 选错槽位不扣预算', () => {
      const s = mkStore();
      const before = s.getRawState();
      s.dispatch({ type: 'START_ACTION', deptId, actionId: majorActionId, tierKey: 'secondary' });
      expect(s.getRawState().remainingBudget).toBe(before.remainingBudget);
      expect(s.getRawState().totalActions).toBe(before.totalActions);
    });
  });

  describe('完成通知', () => {
    it('completedAtDay 使用名义完成日而非当前推进后的天数', () => {
      const s = mkStore({
        slots: {
          primary: {
            label: '主要',
            count: 3,
            occupants: [occ(minorActionId, minorDeptId, '审批', 5, 3), null, null],
          },
          secondary: { label: '次要', count: 2, occupants: [null, null] },
          reserve: { label: '备用', count: 1, occupants: [null] },
        },
      });
      s.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
      const note = s.getRawState().lastCompletedActions[0];
      expect(note).toBeDefined();
      expect(note?.completedAtDay).toBe(8);
    });
  });
});
