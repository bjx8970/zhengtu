/**
 * 核心流程集成测试
 *
 * 覆盖跨 action 的完整游戏流程，填补单元测试无法发现的回归风险：
 * 1. 建档 → 推进时间 → 考核 → 晋升的完整 happy path
 * 2. 存档序列化/反序列化往返
 * 3. L3 封顶行为
 * 4. 考核不称职 → 冻结 → 解冻的因果链
 * 5. 晋升各阶段失败的惩罚
 * 6. 行动 → 推进 → KPI 累积
 *
 * 使用 createTestStore + 真实 ConfigLoader + 真实 engine 函数，
 * 仅通过 _rng 注入控制随机性，不 mock 任何模块。
 */
import { describe, it, expect } from 'vitest';
import { createInitialState, createTestStore, dispatch } from '../game-store';
import { getConfigLoader } from '../../config/loader';
import { CareerLine, PromotionStage, KPITier } from '../../types/enums';
import type { PlayerSave } from '../../types/player';

/** 固定 RNG：民主推荐/联审/票决/公示/试用期全过（rng 须严格小于通过率阈值） */
const allPassRng = () => 0.2;

/** 固定 RNG：高 rng 值，在票决/联审中导致失败（rng > passRate 时投反对票） */
const highFailRng = () => 0.95;

/** 固定 RNG：低 rng 值，在公示中触发举报/舆情（rng < probability 时触发） */
const lowFailRng = () => 0.0;

/**
 * 构造满足 L1→L2 晋升前置条件的初始状态。
 *
 * @param overrides 可选覆盖字段
 * @returns 可直接用于 createTestStore 的 PlayerSave 片段
 */
function makePromotionReadyState(overrides?: Partial<PlayerSave>): Partial<PlayerSave> {
  return {
    characterName: '测试员',
    currentPositionId: 'admin_l1_0',
    currentLevel: 1,
    currentCareerLine: CareerLine.Administrative,
    yearsInCurrentPosition: 3,
    annualAssessments: [
      { year: 2013, score: 82, tier: KPITier.Competent },
      { year: 2014, score: 85, tier: KPITier.Competent },
      { year: 2015, score: 88, tier: KPITier.Competent },
    ],
    frozenPeriods: 0,
    remainingBudget: 50000,
    comprehensiveScore: 80,
    charisma: 70,
    competence: 70,
    integrity: 70,
    performance: 70,
    superiorFavor: 60,
    politicalCapital: 40,
    corruptionRisk: 0,
    time: { year: 2015, month: 1, day: 1, granularity: 'day' },
    birthYear: 1990,
    ...overrides,
  };
}

/** 从 L1 职位配置中获取第一个 minor 行动的 deptId 和 actionId */
function getFirstMinorAction(): { deptId: string; actionId: string } {
  const loader = getConfigLoader();
  const pos = loader.getPosition(CareerLine.Administrative, 1, 0);
  if (!pos) throw new Error('admin_l1_0 position not found');
  for (const dept of pos.departments) {
    for (const action of dept.actions) {
      if (action.category === 'minor') {
        return { deptId: dept.id, actionId: action.id };
      }
    }
  }
  throw new Error('no minor action found in admin_l1_0');
}

describe('核心流程集成测试', () => {
  describe('场景 1：建档 → 晋升完整 happy path', () => {
    it('NEW_GAME 初始化后部门状态正确展开', () => {
      const store = createTestStore();
      store.dispatch({
        type: 'NEW_GAME',
        data: {
          characterName: '李测试',
          gender: '男',
          currentPositionId: 'admin_l1_0',
          currentLevel: 1,
          currentCareerLine: CareerLine.Administrative,
          familyBackground: 'worker',
          promotionPath: 'gongwuyuan',
        },
      });

      const state = store.getRawState();
      expect(state.characterName).toBe('李测试');
      expect(state.currentPositionId).toBe('admin_l1_0');
      expect(state.currentLevel).toBe(1);
      // L1 第一个职位有 4 个部门模板
      expect(Object.keys(state.departmentStates)).toHaveLength(4);
      // 所有部门 KPI 值初始为空
      for (const deptState of Object.values(state.departmentStates)) {
        expect(Object.keys(deptState.kpiValues)).toHaveLength(0);
      }
    });

    it('NEW_GAME 应用家庭背景与晋升通道加成', () => {
      const loader = getConfigLoader();
      const bg = loader.getFamilyBackground('cadre');
      const path = loader.getPromotionPath('gongwuyuan');
      const expectedBonus = { ...(bg?.bonuses ?? {}), ...(path?.bonuses ?? {}) };

      const store = createTestStore();
      store.dispatch({
        type: 'NEW_GAME',
        data: {
          characterName: '干部子弟',
          currentPositionId: 'admin_l1_0',
          currentLevel: 1,
          currentCareerLine: CareerLine.Administrative,
          familyBackground: 'cadre',
          promotionPath: 'gongwuyuan',
        },
      });

      const state = store.getRawState();
      // 验证 politicalCapital 加成
      if (expectedBonus.politicalCapital !== undefined) {
        expect(state.politicalCapital).toBe(expectedBonus.politicalCapital);
      }
      // 验证 superiorFavor 加成
      if (expectedBonus.superiorFavor !== undefined) {
        expect(state.superiorFavor).toBe(20 + expectedBonus.superiorFavor);
      }
    });

    it('完整晋升流程：L1 → L2', () => {
      const store = createTestStore(makePromotionReadyState());

      // 启动晋升
      store.dispatch({ type: 'START_PROMOTION' });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.DemocraticVote);
      expect(store.getRawState().promotionState?.targetLevel).toBe(2);
      expect(store.getRawState().promotionState?.targetPositionId).toBe('admin_l2_0');

      // 阶段 1: 民主推荐
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.OrgInspection);

      // 阶段 2: 组织考察
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.JointReview);

      // 阶段 3: 联审
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.CommitteeVote);

      // 阶段 4: 常委会票决
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.PublicNotice);

      // 阶段 5: 公示
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.Appointment);

      // 阶段 6: 任命 → 试用期
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.Probation);

      // 阶段 7: 试用期考核
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      const final = store.getRawState();
      expect(final.promotionStage).toBe(PromotionStage.Completed);
      expect(final.currentLevel).toBe(2);
      expect(final.currentPositionId).toBe('admin_l2_0');
      expect(final.yearsInCurrentPosition).toBe(0);
      expect(final.careerHistory).toHaveLength(1);
      expect(final.careerHistory[0]?.positionId).toBe('admin_l1_0');
      // 晋升成功后预算重置为新职位年度预算
      expect(final.remainingBudget).toBe(2000);
      // 考核记录归档后清空
      expect(final.annualAssessments).toEqual([]);
      expect(final.comprehensiveScore).toBe(0);
      // 政治资本增加
      expect(final.politicalCapital).toBeGreaterThan(40);
      // 部门状态重置为新职位
      expect(Object.keys(final.departmentStates)).toEqual([
        'admin_l2_0_dept_0',
        'admin_l2_0_dept_1',
        'admin_l2_0_dept_2',
        'admin_l2_0_dept_3',
      ]);
    });
  });

  describe('场景 2：存档序列化往返', () => {
    const SAVE_KEY = 'zhengtu_autosave';

    it('模块级 dispatch 玩 3 个月后可序列化并恢复', () => {
      localStorage.clear();

      // 用模块级 dispatch 初始化并推进
      dispatch({
        type: 'LOAD_SAVE',
        save: createInitialState({
          characterName: '存档测试',
          currentPositionId: 'admin_l1_0',
          currentLevel: 1,
          currentCareerLine: CareerLine.Administrative,
          userId: 'test-user',
          saveId: 'test-save',
          time: { year: 2013, month: 3, day: 1, granularity: 'day' },
          remainingBudget: 50000,
        }),
      });

      // 推进 3 个月
      for (let i = 0; i < 3; i++) {
        dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });
      }

      // 验证 localStorage 有存档
      const saved = localStorage.getItem(SAVE_KEY);
      expect(saved).not.toBeNull();
      const savedData = JSON.parse(saved ?? '{}') as PlayerSave;
      expect(savedData.characterName).toBe('存档测试');
      expect(savedData.time.year).toBe(2013);
      expect(savedData.time.month).toBe(6);

      // 用新 store 恢复存档
      const restoredStore = createTestStore();
      restoredStore.dispatch({ type: 'LOAD_SAVE', save: savedData });

      const restored = restoredStore.getRawState();
      expect(restored.characterName).toBe('存档测试');
      expect(restored.currentPositionId).toBe('admin_l1_0');
      expect(restored.time.month).toBe(6);
      expect(restored.totalDaysPlayed).toBe(savedData.totalDaysPlayed);

      // 恢复后可继续推进
      restoredStore.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });
      expect(restoredStore.getRawState().time.month).toBe(7);
    });
  });

  describe('场景 3：L3 封顶', () => {
    it('L3 状态下 START_PROMOTION 不改变任何状态', () => {
      const store = createTestStore({
        currentCareerLine: CareerLine.Administrative,
        currentLevel: 3,
        currentPositionId: 'admin_l3_0',
        yearsInCurrentPosition: 5,
        annualAssessments: [
          { year: 2020, score: 90, tier: KPITier.Excellent },
          { year: 2021, score: 88, tier: KPITier.Competent },
          { year: 2022, score: 92, tier: KPITier.Excellent },
        ],
        frozenPeriods: 0,
        comprehensiveScore: 90,
      });

      const before = store.getRawState();
      store.dispatch({ type: 'START_PROMOTION' });
      const after = store.getRawState();

      // L3 没有 L4 配置，晋升应被静默拒绝
      expect(after.promotionStage).toBe(PromotionStage.Idle);
      expect(after.promotionAttempts).toBe(before.promotionAttempts);
      expect(after.promotionState).toBeNull();
    });
  });

  describe('场景 4：考核不称职 → 冻结 → 解冻', () => {
    it('低 KPI 导致不称职考核 → frozenPeriods 增加 → 晋升被拒', () => {
      const store = createTestStore({
        currentCareerLine: CareerLine.Administrative,
        currentLevel: 1,
        currentPositionId: 'admin_l1_0',
        yearsInCurrentPosition: 0,
        // 空 departmentStates → KPI 完成率为 0 → 不称职
        departmentStates: {},
        remainingBudget: 50000,
        time: { year: 2013, month: 1, day: 1, granularity: 'day' },
        birthYear: 1990,
      });

      // 推进 12 个月触发年度考核（每次月度推进 30 天，12 次后跨年）
      for (let i = 0; i < 12; i++) {
        store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });
      }

      const state = store.getRawState();
      // 应有一次年度考核记录
      expect(state.annualAssessments).toHaveLength(1);
      // KPI 全空 → 不称职
      expect(state.annualAssessments[0]?.tier).toBe(KPITier.Incompetent);
      // 不称职 → frozenPeriods 增加
      const cfg = getConfigLoader().getGameConfig();
      expect(state.frozenPeriods).toBe(cfg.incompetentFrozenPeriods);
      // yearsInCurrentPosition 递增
      expect(state.yearsInCurrentPosition).toBe(1);

      // 冻结期内不能晋升
      store.dispatch({ type: 'START_PROMOTION' });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.Idle);
    });

    it('冻结期过后可正常启动晋升', () => {
      // 直接构造一个 frozenPeriods=0 且满足晋升条件的状态
      const store = createTestStore(
        makePromotionReadyState({
          frozenPeriods: 0,
          yearsInCurrentPosition: 3,
        }),
      );

      store.dispatch({ type: 'START_PROMOTION' });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.DemocraticVote);
    });
  });

  describe('场景 5：晋升各阶段失败惩罚', () => {
    /**
     * 构造处于指定阶段的晋升状态。
     *
     * @param stage 晋升阶段
     * @param overrides 额外属性覆盖（用于调整属性以触发失败）
     * @returns 测试 store
     */
    function makeStoreAtStage(
      stage: PromotionStage,
      overrides?: Partial<PlayerSave>,
    ): ReturnType<typeof createTestStore> {
      return createTestStore({
        currentCareerLine: CareerLine.Administrative,
        currentLevel: 1,
        currentPositionId: 'admin_l1_0',
        yearsInCurrentPosition: 3,
        annualAssessments: [
          { year: 2024, score: 85, tier: KPITier.Competent },
          { year: 2025, score: 88, tier: KPITier.Competent },
          { year: 2026, score: 90, tier: KPITier.Excellent },
        ],
        frozenPeriods: 0,
        comprehensiveScore: 85,
        charisma: 70,
        competence: 70,
        integrity: 70,
        performance: 70,
        superiorFavor: 60,
        politicalCapital: 50,
        corruptionRisk: 0,
        remainingBudget: 50000,
        time: { year: 2027, month: 1, day: 1, granularity: 'day' },
        birthYear: 1990,
        promotionStage: stage,
        promotionState: {
          currentStage: stage,
          targetPositionId: 'admin_l2_0',
          targetLevel: 2,
          stageResults: {},
        },
        ...overrides,
      });
    }

    it('民主推荐失败（低属性） → demoralization 增加 + Failed', () => {
      // baseScore = playerScore*0.4 + charisma*0.3 + superiorFavor*0.3
      // 要让 baseScore < 60：comprehensiveScore=30, charisma=30, superiorFavor=30
      // → 12 + 9 + 9 = 30 < 60 → 失败
      const store = makeStoreAtStage(PromotionStage.DemocraticVote, {
        comprehensiveScore: 30,
        charisma: 30,
        superiorFavor: 30,
      });
      const demBefore = store.getRawState().demoralization ?? 0;

      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });

      const state = store.getRawState();
      expect(state.promotionStage).toBe(PromotionStage.Failed);
      const cfg = getConfigLoader().getGameConfig();
      expect(state.demoralization).toBe(demBefore + cfg.promotion.progression.demoralizationOnFail);
    });

    it('组织考察被否决(Rejected) → frozenPeriods +2 + demoralization 增加', () => {
      // score = performance*0.3 + competence*0.3 + playerScore*0.2 + integrity*0.2
      // 要让 score < 40（suspendedThreshold）：全部属性=20
      // → 6 + 6 + 4 + 4 = 20 < 40 → Rejected
      const store = makeStoreAtStage(PromotionStage.OrgInspection, {
        performance: 20,
        competence: 20,
        comprehensiveScore: 20,
        integrity: 20,
      });
      const demBefore = store.getRawState().demoralization ?? 0;

      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE' });

      const state = store.getRawState();
      expect(state.promotionStage).toBe(PromotionStage.Failed);
      const cfg = getConfigLoader().getGameConfig();
      // Rejected → frozenPeriods +2
      expect(state.frozenPeriods).toBe(2);
      expect(state.demoralization).toBe(
        demBefore + cfg.promotion.progression.demoralizationOnRejected,
      );
    });

    it('联审失败（高腐败风险） → demoralization 增加 + Failed', () => {
      // corruptionRisk >= 50 → 纪委否决
      // rng=0.95 → 信访和其他部门也失败
      const store = makeStoreAtStage(PromotionStage.JointReview, {
        corruptionRisk: 80,
      });
      const demBefore = store.getRawState().demoralization ?? 0;

      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: highFailRng });

      const state = store.getRawState();
      expect(state.promotionStage).toBe(PromotionStage.Failed);
      const cfg = getConfigLoader().getGameConfig();
      expect(state.demoralization).toBe(demBefore + cfg.promotion.progression.demoralizationOnFail);
    });

    it('常委会票决失败 → demoralization 增加 + Failed', () => {
      // finalRate = max((avgReputation + superiorFavor)/200 - factionPenalty, 0.1)
      // factionReputation 全 0 → avgReputation=0, finalRate=max(0+60/200, 0.1)=0.3
      // rng=0.95 > 0.3 → 所有票反对 → 失败
      const store = makeStoreAtStage(PromotionStage.CommitteeVote, {
        superiorFavor: 10, // 降低 finalRate 到 0.05 → max(0.05, 0.1) = 0.1
      });
      const demBefore = store.getRawState().demoralization ?? 0;

      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: highFailRng });

      const state = store.getRawState();
      expect(state.promotionStage).toBe(PromotionStage.Failed);
      const cfg = getConfigLoader().getGameConfig();
      expect(state.demoralization).toBe(demBefore + cfg.promotion.progression.demoralizationOnFail);
    });

    it('公示失败（举报） → demoralization 增加 + Failed', () => {
      // complaintProb = corruptionRisk * complaintProbPerRisk = 100 * 0.005 = 0.5
      // rng=0.0 < 0.5 → 触发举报 → 失败
      const store = makeStoreAtStage(PromotionStage.PublicNotice, {
        corruptionRisk: 100,
      });
      const demBefore = store.getRawState().demoralization ?? 0;

      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: lowFailRng });

      const state = store.getRawState();
      expect(state.promotionStage).toBe(PromotionStage.Failed);
      const cfg = getConfigLoader().getGameConfig();
      expect(state.demoralization).toBe(demBefore + cfg.promotion.progression.demoralizationOnFail);
    });

    it('试用期失败（低能力） → demoralization 增加 + Failed', () => {
      // score = competence*0.5 + playerScore*0.3 + rng()*20
      // competence=10, playerScore=10, rng=0.0 → 5 + 3 + 0 = 8 < 55 → 失败
      const store = makeStoreAtStage(PromotionStage.Probation, {
        competence: 10,
        comprehensiveScore: 10,
      });
      const demBefore = store.getRawState().demoralization ?? 0;

      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: lowFailRng });

      const state = store.getRawState();
      expect(state.promotionStage).toBe(PromotionStage.Failed);
      const cfg = getConfigLoader().getGameConfig();
      expect(state.demoralization).toBe(demBefore + cfg.promotion.progression.demoralizationOnFail);
      // 试用期失败不改变职级
      expect(state.currentLevel).toBe(1);
    });

    it('失败后 RESET_PROMOTION 回到 Idle 可重新尝试', () => {
      const store = makeStoreAtStage(PromotionStage.DemocraticVote, {
        comprehensiveScore: 30,
        charisma: 30,
        superiorFavor: 30,
      });
      store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: allPassRng });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.Failed);

      store.dispatch({ type: 'RESET_PROMOTION' });
      const state = store.getRawState();
      expect(state.promotionStage).toBe(PromotionStage.Idle);
      expect(state.promotionState).toBeNull();
    });
  });

  describe('场景 6：行动 → 推进 → KPI 累积集成', () => {
    it('启动行动后推进时间，行动完成并产生 KPI 效果', () => {
      const { deptId, actionId } = getFirstMinorAction();
      const store = createTestStore();

      // 先 NEW_GAME 初始化部门状态
      store.dispatch({
        type: 'NEW_GAME',
        data: {
          characterName: '测试',
          currentPositionId: 'admin_l1_0',
          currentLevel: 1,
          currentCareerLine: CareerLine.Administrative,
          remainingBudget: 50000,
        },
      });

      // 启动行动
      store.dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'primary' });
      const afterStart = store.getRawState();
      expect(afterStart.totalActions).toBe(1);
      expect(afterStart.slots.primary.occupants[0]?.actionId).toBe(actionId);
      expect(afterStart.remainingBudget).toBeLessThan(50000);

      // 推进 1 个月让行动完成
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month', _rng: () => 0.5 });
      const afterAdvance = store.getRawState();

      // 槽位已释放
      expect(afterAdvance.slots.primary.occupants[0]).toBeNull();
      // 产生了完成通知
      expect(afterAdvance.lastCompletedActions.length).toBeGreaterThan(0);
      // 部门 KPI 值有变化
      const deptState = afterAdvance.departmentStates[deptId];
      expect(deptState).toBeDefined();
      expect(Object.keys(deptState?.kpiValues ?? {}).length).toBeGreaterThan(0);
    });

    it('晋升中拒绝行动和时间推进', () => {
      const store = createTestStore(makePromotionReadyState());
      store.dispatch({ type: 'START_PROMOTION' });
      expect(store.getRawState().promotionStage).toBe(PromotionStage.DemocraticVote);

      const actionsBefore = store.getRawState().totalActions;
      const { deptId, actionId } = getFirstMinorAction();
      store.dispatch({ type: 'START_ACTION', deptId, actionId, tierKey: 'primary' });
      expect(store.getRawState().totalActions).toBe(actionsBefore);

      const yearBefore = store.getRawState().time.year;
      store.dispatch({ type: 'ADVANCE_TIME', granularity: 'month' });
      expect(store.getRawState().time.year).toBe(yearBefore);
    });
  });
});
