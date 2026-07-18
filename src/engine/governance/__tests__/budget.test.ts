import { describe, it, expect } from 'vitest';
import {
  calculateMonthlyConsumption,
  monthlySettlement,
  getCumulativeConsumption,
} from '../budget';
import type { DepartmentConfig } from '../../../types/config';
import type { DepartmentState } from '../../../types/player';

function makeDeptConfig(overrides: Partial<DepartmentConfig> & { id: string }): DepartmentConfig {
  return {
    name: overrides.id,
    consumptionCoefficient: 1.0,
    baseConsumption: 100,
    actions: [],
    kpiIndicators: [],
    ...overrides,
  };
}

function makeDeptState(overrides?: Partial<DepartmentState>): DepartmentState {
  return {
    id: 'test_dept',
    kpiValues: {},
    monthlyConsumption: 50,
    cumulativeConsumption: 0,
    lastActionDay: 0,
    actionCooldownUntilDays: {},
    ...overrides,
  };
}

describe('calculateMonthlyConsumption', () => {
  it('基础消耗 × 系数', () => {
    const config = makeDeptConfig({
      id: 'dept_1',
      baseConsumption: 100,
      consumptionCoefficient: 1.5,
    });
    const state = makeDeptState({ id: 'dept_1' });
    expect(calculateMonthlyConsumption(state, config)).toBe(150);
  });

  it('系数小于 1', () => {
    const config = makeDeptConfig({
      id: 'dept_1',
      baseConsumption: 200,
      consumptionCoefficient: 0.5,
    });
    const state = makeDeptState({ id: 'dept_1' });
    expect(calculateMonthlyConsumption(state, config)).toBe(100);
  });

  it('基础消耗为 0', () => {
    const config = makeDeptConfig({
      id: 'dept_1',
      baseConsumption: 0,
      consumptionCoefficient: 2.0,
    });
    const state = makeDeptState({ id: 'dept_1' });
    expect(calculateMonthlyConsumption(state, config)).toBe(0);
  });
});

describe('monthlySettlement', () => {
  it('单个部门扣减正常', () => {
    const configs = [
      makeDeptConfig({ id: 'dept_1', baseConsumption: 100, consumptionCoefficient: 1.0 }),
    ];
    const depts = { dept_1: makeDeptState({ id: 'dept_1' }) };
    const result = monthlySettlement(depts, configs, 1000);
    expect(result.newRemaining).toBe(900);
    expect(result.deptConsumptions['dept_1']).toBe(100);
    expect(result.isOverBudget).toBe(false);
  });

  it('多个部门汇总结算', () => {
    const configs = [
      makeDeptConfig({ id: 'd1', baseConsumption: 100, consumptionCoefficient: 1.0 }),
      makeDeptConfig({ id: 'd2', baseConsumption: 80, consumptionCoefficient: 1.5 }),
      makeDeptConfig({ id: 'd3', baseConsumption: 60, consumptionCoefficient: 0.5 }),
    ];
    const depts = {
      d1: makeDeptState({ id: 'd1' }),
      d2: makeDeptState({ id: 'd2' }),
      d3: makeDeptState({ id: 'd3' }),
    };
    const result = monthlySettlement(depts, configs, 1000);
    // d1: 100, d2: 120, d3: 30 → total: 250
    expect(result.newRemaining).toBe(750);
    expect(result.deptConsumptions['d1']).toBe(100);
    expect(result.deptConsumptions['d2']).toBe(120);
    expect(result.deptConsumptions['d3']).toBe(30);
  });

  it('部门状态不存在时跳过', () => {
    const configs = [
      makeDeptConfig({ id: 'dept_1', baseConsumption: 100, consumptionCoefficient: 1.0 }),
      makeDeptConfig({ id: 'dept_nonexistent', baseConsumption: 50, consumptionCoefficient: 1.0 }),
    ];
    const depts = { dept_1: makeDeptState({ id: 'dept_1' }) };
    const result = monthlySettlement(depts, configs, 1000);
    expect(result.newRemaining).toBe(900);
  });

  it('检测超支', () => {
    const configs = [
      makeDeptConfig({ id: 'd1', baseConsumption: 500, consumptionCoefficient: 1.0 }),
    ];
    const depts = { d1: makeDeptState({ id: 'd1' }) };
    const result = monthlySettlement(depts, configs, 300);
    expect(result.newRemaining).toBe(-200);
    expect(result.isOverBudget).toBe(true);
  });

  it('刚好用完预算', () => {
    const configs = [
      makeDeptConfig({ id: 'd1', baseConsumption: 300, consumptionCoefficient: 1.0 }),
    ];
    const depts = { d1: makeDeptState({ id: 'd1' }) };
    const result = monthlySettlement(depts, configs, 300);
    expect(result.newRemaining).toBe(0);
    expect(result.isOverBudget).toBe(false);
  });

  it('空配置列表不影响余额', () => {
    const result = monthlySettlement({}, [], 500);
    expect(result.newRemaining).toBe(500);
    expect(Object.keys(result.deptConsumptions)).toHaveLength(0);
  });
});

describe('getCumulativeConsumption', () => {
  it('返回累计消耗', () => {
    const state = makeDeptState({ cumulativeConsumption: 1234 });
    expect(getCumulativeConsumption(state)).toBe(1234);
  });

  it('初始为 0', () => {
    const state = makeDeptState();
    expect(getCumulativeConsumption(state)).toBe(0);
  });
});
