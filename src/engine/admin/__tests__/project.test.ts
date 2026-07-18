import { describe, it, expect } from 'vitest';
import {
  calculateProjectProgress,
  resolveProjectMilestone,
  isAbandoned,
  advanceProjectProgress,
} from '../project';
import { ProjectMilestone } from '../../../types/enums';
import type { AdminLineConfig } from '../../../types/config';

const config: AdminLineConfig = {
  investmentYieldRate: 0.05,
  projectCompletionBaseRate: 0.15,
  landRevenueMultiplier: 0.02,
  parkGrowthRate: 0.08,
  fiscalBalanceThreshold: 0.9,
  projectApprovalBaselineDays: 120,
};

describe('calculateProjectProgress', () => {
  it('审批 0 天 → 进度 0', () => {
    expect(calculateProjectProgress(0, 1.0, 1.0, config)).toBe(0);
  });

  it('审批充分 + 资金满 + 人力满 → 进度 1.0', () => {
    expect(calculateProjectProgress(120, 1.0, 1.0, config)).toBe(1.0);
  });

  it('资金断裂 → 进度为 0', () => {
    expect(calculateProjectProgress(120, 0, 1.0, config)).toBe(0);
  });

  it('人力不足 → 进度打折', () => {
    const full = calculateProjectProgress(120, 1.0, 1.0, config);
    const half = calculateProjectProgress(120, 1.0, 0.5, config);
    expect(half).toBeCloseTo(full * 0.5, 4);
  });

  it('审批 60 天 → 进度约半', () => {
    const result = calculateProjectProgress(60, 1.0, 1.0, config);
    expect(result).toBeCloseTo(0.5, 2);
  });
});

describe('resolveProjectMilestone', () => {
  it('进度 0 → 开工', () => {
    expect(resolveProjectMilestone(0)).toBe(ProjectMilestone.Groundbreaking);
  });

  it('进度 0.5 → 建设中', () => {
    expect(resolveProjectMilestone(0.5)).toBe(ProjectMilestone.MidConstruction);
  });

  it('进度 0.6 → 主体封顶', () => {
    expect(resolveProjectMilestone(0.6)).toBe(ProjectMilestone.ToppedOff);
  });

  it('进度 1.0 → 竣工', () => {
    expect(resolveProjectMilestone(1.0)).toBe(ProjectMilestone.Completed);
  });

  it('进度 0.9 → 主体封顶（未竣工）', () => {
    expect(resolveProjectMilestone(0.9)).toBe(ProjectMilestone.ToppedOff);
  });
});

describe('isAbandoned', () => {
  it('已完成项目不烂尾', () => {
    expect(isAbandoned(1.0, 0.8, 0.1, 200)).toBe(false);
  });

  it('资金断裂 → 烂尾', () => {
    expect(isAbandoned(0.3, 0.3, 0.2, 30)).toBe(true);
  });

  it('政策搁置 → 烂尾', () => {
    expect(isAbandoned(0.2, 0.2, 0.5, 200)).toBe(true);
  });

  it('正常进行 → 不烂尾', () => {
    expect(isAbandoned(0.4, 0.3, 0.8, 60)).toBe(false);
  });

  it('刚开工资金充足 → 不烂尾', () => {
    expect(isAbandoned(0.1, 0.0, 1.0, 10)).toBe(false);
  });
});

describe('advanceProjectProgress', () => {
  it('每天推进基础速率', () => {
    const result = advanceProjectProgress(0, 1.0, 1.0, config);
    expect(result).toBeCloseTo(0.15, 4);
  });

  it('已达 100% 不再推进', () => {
    expect(advanceProjectProgress(1.0, 1.0, 1.0, config)).toBe(1.0);
  });

  it('资金不足减速推进', () => {
    const full = advanceProjectProgress(0, 1.0, 1.0, config);
    const half = advanceProjectProgress(0, 0.5, 1.0, config);
    expect(half).toBeCloseTo(full * 0.5, 4);
  });

  it('人力不足减速推进', () => {
    const full = advanceProjectProgress(0, 1.0, 1.0, config);
    const half = advanceProjectProgress(0, 1.0, 0.5, config);
    expect(half).toBeCloseTo(full * 0.5, 4);
  });

  it('累积推进不超过 100%', () => {
    let progress = 0;
    for (let i = 0; i < 10; i++) {
      progress = advanceProjectProgress(progress, 1.0, 1.0, config);
    }
    expect(progress).toBeLessThanOrEqual(1.0);
  });
});
