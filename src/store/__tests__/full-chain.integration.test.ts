/**
 * 行政线 L1-L11 全链路回归与终局测试
 *
 * 覆盖场景：
 * - L11 终局独立断言
 * - 存档往返（序列化→反序列化→继续推进）
 * - 失败/冻结不破坏后续恢复
 * - 在途行动阻止晋升
 */
import { describe, it, expect } from 'vitest';
import { createTestStore } from '../game-store';
import { getConfigLoader } from '../../config/loader';
import { CareerLine, PromotionStage, KPITier } from '../../types/enums';
import type { PlayerSave } from '../../types/player';

const loader = getConfigLoader();
const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;

/** 确定性 RNG：始终返回 0.3（有利于通过各阶段） */
const goodRng = () => 0.3;

/** 生成满足晋升条件的年度考核记录 */
function makeAssessments(count: number): { year: number; score: number; tier: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    year: 2013 + i,
    score: 85 + i,
    tier: KPITier.Competent,
  }));
}

describe('行政线 L1-L11 全链路回归测试', () => {
  it('L11 终局状态：不能再次晋升', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 11,
      currentPositionId: 'admin_l11_0',
      yearsInCurrentPosition: 5,
      annualAssessments: makeAssessments(5),
      frozenPeriods: 0,
      endgameReached: true,
    });

    const before = store.getRawState();
    store.dispatch({ type: 'START_PROMOTION' });
    const after = store.getRawState();

    expect(after.promotionStage).toBe(PromotionStage.Idle);
    expect(after.promotionAttempts).toBe(before.promotionAttempts);
  });

  it('存档往返：序列化→反序列化后状态保持', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 3,
      currentPositionId: 'admin_l3_0',
      yearsInCurrentPosition: 5,
      annualAssessments: makeAssessments(5),
      frozenPeriods: 0,
      comprehensiveScore: 90,
    });

    // 存档往返
    const save1 = JSON.parse(JSON.stringify(store.getRawState())) as PlayerSave;
    store.dispatch({ type: 'LOAD_SAVE', save: save1 });
    expect(store.getRawState().currentLevel).toBe(3);
    expect(store.getRawState().currentPositionId).toBe('admin_l3_0');

    // 修改状态后再次往返
    store.dispatch({ type: 'LOAD_SAVE', save: { ...store.getRawState(), yearsInCurrentPosition: 10 } });
    const save2 = JSON.parse(JSON.stringify(store.getRawState())) as PlayerSave;
    store.dispatch({ type: 'LOAD_SAVE', save: save2 });
    expect(store.getRawState().yearsInCurrentPosition).toBe(10);
  });

  it('失败后恢复：晋升失败后可重置', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 5,
      annualAssessments: makeAssessments(5),
      frozenPeriods: 0,
      comprehensiveScore: 30,
      charisma: 20,
      competence: 20,
      integrity: 20,
      performance: 20,
      superiorFavor: 20,
      corruptionRisk: 0,
      politicalCapital: 100,
    });

    // 启动晋升
    store.dispatch({ type: 'START_PROMOTION' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.TargetSelection);

    store.dispatch({ type: 'SELECT_PROMOTION_TARGET', positionId: 'admin_l3_0' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.DemocraticVote);

    // 民主推荐失败（使用高 RNG 值导致失败）
    store.dispatch({ type: 'PROMOTION_RESOLVE_STAGE', _rng: () => 0.99 });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.Failed);

    // 重置后可重新尝试
    store.dispatch({ type: 'RESET_PROMOTION' });
    expect(store.getRawState().promotionStage).toBe(PromotionStage.Idle);
  });

  it('在途行动阻止晋升', () => {
    const store = createTestStore({
      currentCareerLine: CareerLine.Administrative,
      currentLevel: 2,
      currentPositionId: 'admin_l2_0',
      yearsInCurrentPosition: 5,
      annualAssessments: makeAssessments(5),
      frozenPeriods: 0,
      remainingBudget: 50000,
      slots: {
        primary: {
          label: '主要',
          count: 3,
          occupants: [
            {
              actionId: 'test_action',
              deptId: 'admin_l2_0_dept_0',
              actionName: '测试行动',
              category: 'minor',
              startedAtDay: 0,
              durationDays: 10,
              cooldownDays: 7,
            },
            null,
            null,
          ],
        },
        secondary: { label: '次要', count: 2, occupants: [null, null] },
        reserve: { label: '备用', count: 1, occupants: [null] },
      },
    });

    const before = store.getRawState();
    store.dispatch({ type: 'START_PROMOTION' });
    const after = store.getRawState();

    // 有在途行动时不能启动晋升
    expect(after.promotionStage).toBe(PromotionStage.Idle);
    expect(after.promotionAttempts).toBe(before.promotionAttempts);
  });

  it('行政线 L1-L11 配置完整性', () => {
    // 验证所有 11 个级别都有配置
    expect(adminCfg.levels.length).toBe(11);

    for (let level = 1; level <= 11; level++) {
      const levelCfg = adminCfg.levels.find((l) => l.level === level);
      expect(levelCfg).toBeDefined();
      expect(levelCfg!.positions.length).toBeGreaterThanOrEqual(3);

      // 验证每个职位的部门和 KPI 引用有效
      for (const pos of levelCfg!.positions) {
        const fullPos = loader.getPosition(
          CareerLine.Administrative,
          level,
          parseInt(pos.id.split('_').pop() ?? '0', 10),
        );
        expect(fullPos).not.toBeNull();
        expect(fullPos!.departments.length).toBe(pos.departmentTemplateIds.length);
        expect(fullPos!.kpiIndicators.length).toBe(pos.kpiTemplateIds.length);
      }
    }
  });
});
