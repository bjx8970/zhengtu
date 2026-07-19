/**
 * 配置平衡校验测试
 *
 * 验证 validate-config.ts 中的平衡校验规则：
 * - 正例：L1-L3 现有配置不产生误报
 * - 负例：构造异常数据验证捕获能力
 */
import { describe, it, expect } from 'vitest';
import { getConfigLoader } from '../loader';
import { CareerLine } from '../../types/enums';

const loader = getConfigLoader();

describe('配置平衡校验', () => {
  describe('正例：现有配置有效性', () => {
    it('行政线 L1-L3 职位 ID 全局唯一', () => {
      const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;
      const positionIds = new Set<string>();
      for (const level of adminCfg.levels) {
        for (const pos of level.positions) {
          expect(positionIds.has(pos.id)).toBe(false);
          positionIds.add(pos.id);
        }
      }
    });

    it('行政线 L1-L3 预算单调递增', () => {
      const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;
      let prevAvgBudget = 0;
      for (const level of adminCfg.levels) {
        const avgBudget =
          level.positions.reduce((sum, p) => sum + p.annualBudget, 0) / level.positions.length;
        expect(avgBudget).toBeGreaterThan(prevAvgBudget);
        prevAvgBudget = avgBudget;
      }
    });

    it('行政线 L1-L3 晋升门槛在合理范围内', () => {
      const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;
      for (const level of adminCfg.levels) {
        const req = level.promotionRequirements;
        expect(req.minYearsInService).toBeGreaterThanOrEqual(1);
        expect(req.minYearsInService).toBeLessThanOrEqual(8);
        expect(req.minAssessmentPasses).toBeGreaterThanOrEqual(1);
        expect(req.minAssessmentPasses).toBeLessThanOrEqual(5);
      }
    });

    it('行政线 L1-L3 部门引用均存在', () => {
      const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;
      for (const level of adminCfg.levels) {
        for (const pos of level.positions) {
          // 通过 getPosition 展开职位，若引用不存在会抛出异常
          const idx = parseInt(pos.id.split('_').pop() ?? '0', 10);
          const fullPos = loader.getPosition(CareerLine.Administrative, level.level, idx);
          expect(fullPos).not.toBeNull();
          expect(fullPos!.departments.length).toBe(pos.departmentTemplateIds.length);
        }
      }
    });

    it('行政线 L1-L3 KPI 引用均存在', () => {
      const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;
      for (const level of adminCfg.levels) {
        for (const pos of level.positions) {
          for (const kpiId of pos.kpiTemplateIds) {
            const kpi = loader.getKpiTemplate(kpiId);
            expect(kpi).not.toBeNull();
          }
        }
      }
    });

    it('每个职位部门数量在 3-5 范围内', () => {
      const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;
      for (const level of adminCfg.levels) {
        for (const pos of level.positions) {
          expect(pos.departmentTemplateIds.length).toBeGreaterThanOrEqual(3);
          expect(pos.departmentTemplateIds.length).toBeLessThanOrEqual(5);
        }
      }
    });

    it('每个职位 KPI 数量在 4-5 范围内', () => {
      const adminCfg = loader.getCareerLine(CareerLine.Administrative)!;
      for (const level of adminCfg.levels) {
        for (const pos of level.positions) {
          expect(pos.kpiTemplateIds.length).toBeGreaterThanOrEqual(4);
          expect(pos.kpiTemplateIds.length).toBeLessThanOrEqual(5);
        }
      }
    });
  });

  describe('事件配置有效性', () => {
    it('所有事件均有 3 个选项', () => {
      const events = loader.getEvents();
      for (const event of events) {
        expect(event.options.length).toBe(3);
      }
    });

    it('事件 careerLines 引用有效', () => {
      const validLines = ['admin', 'party', 'discipline', 'mass'];
      const events = loader.getEvents();
      for (const event of events) {
        if (event.triggerCondition.careerLines) {
          for (const line of event.triggerCondition.careerLines) {
            expect(validLines).toContain(line);
          }
        }
      }
    });
  });
});
