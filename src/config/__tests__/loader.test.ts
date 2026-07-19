/**
 * ConfigLoader 模板展开与配置数据完整性测试。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getConfigLoader } from '../loader';
import type { CareerLine } from '../../types/enums';
import departments from '../templates/departments.json';
import departmentsExtra from '../templates/departments-extra.json';

let loader: ReturnType<typeof getConfigLoader>;

beforeAll(() => {
  loader = getConfigLoader();
});

describe('ConfigLoader', () => {
  describe('template resolution', () => {
    it('展开后的职位包含 correct departments', () => {
      const pos = loader.getPosition('admin' as CareerLine, 3, 0);
      expect(pos).not.toBeNull();
      if (!pos) return;
      expect(pos.departments).toHaveLength(5);
      for (const dept of pos.departments) {
        expect(dept.id).toContain('admin_l3_0_dept_');
        expect(dept.name).toBeTruthy();
        expect(dept.actions.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('不同职位引用同一模板时各自独立', () => {
      const pos0 = loader.getPosition('admin' as CareerLine, 1, 0);
      const pos1 = loader.getPosition('admin' as CareerLine, 2, 0);
      expect(pos0).not.toBeNull();
      expect(pos1).not.toBeNull();
      if (!pos0 || !pos1) return;
      // departments should be different instances
      if (pos0.departments[0] && pos1.departments[0]) {
        pos0.departments[0].name = 'MODIFIED';
        const pos1Reloaded = loader.getPosition('admin' as CareerLine, 2, 0);
        expect(pos1Reloaded?.departments[0]?.name).not.toBe('MODIFIED');
      }
    });

    it('KPI indicators are resolved from templates', () => {
      const pos = loader.getPosition('admin' as CareerLine, 3, 0);
      expect(pos).not.toBeNull();
      if (!pos) return;
      expect(pos.kpiIndicators.length).toBe(5);
      for (const kpi of pos.kpiIndicators) {
        expect(kpi.id).toBeTruthy();
        expect(kpi.name).toBeTruthy();
        expect(kpi.weight).toBeGreaterThan(0);
      }
    });
  });

  describe('data integrity', () => {
    let allPositions: { line: CareerLine; level: number; index: number; name: string }[];

    beforeAll(() => {
      const adminConfig = loader.getCareerLine('admin' as CareerLine);
      if (!adminConfig) return;
      allPositions = adminConfig.levels.flatMap((level) =>
        level.positions.map((_, i) => ({
          line: 'admin' as CareerLine,
          level: level.level,
          index: i,
          name: level.positions[i]!.name,
        })),
      );
    });

    it('每个职位至少有 3 个部门', () => {
      for (const { line, level, index } of allPositions) {
        const pos = loader.getPosition(line, level, index);
        expect(pos, `Position ${line}/L${level}/#${index}`).not.toBeNull();
        if (pos) {
          expect(
            pos.departments.length,
            `${pos.id} has ${pos.departments.length} departments`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it('每个职位最多 5 个部门', () => {
      for (const { line, level, index } of allPositions) {
        const pos = loader.getPosition(line, level, index);
        if (pos) {
          expect(pos.departments.length).toBeLessThanOrEqual(5);
        }
      }
    });

    it('每个职位至少 4 项 KPI', () => {
      for (const { line, level, index } of allPositions) {
        const pos = loader.getPosition(line, level, index);
        if (pos) {
          expect(pos.kpiIndicators.length).toBeGreaterThanOrEqual(4);
        }
      }
    });

    it('每个职位的 annualBudget 为正数', () => {
      for (const { line, level, index } of allPositions) {
        const pos = loader.getPosition(line, level, index);
        if (pos) {
          expect(pos.annualBudget).toBeGreaterThan(0);
        }
      }
    });

    it('行动分类和冷却配置完整', () => {
      const templates = { ...departments, ...departmentsExtra };
      const actions = Object.values(templates).flatMap((department) => department.actions);
      const categoryCounts = actions.reduce<Record<string, number>>((counts, action) => {
        counts[action.category] = (counts[action.category] ?? 0) + 1;
        return counts;
      }, {});

      expect(actions).toHaveLength(62);
      expect(categoryCounts).toEqual({ minor: 22, routine: 12, major: 28 });
      for (const action of actions) {
        expect(action.cooldownDays).toBe(
          action.category === 'major' ? 14 : action.category === 'minor' ? 7 : 0,
        );
      }
    });
  });

  describe('error handling', () => {
    it('不存在的职业线返回 null', () => {
      const result = loader.getCareerLine('invalid' as CareerLine);
      expect(result).toBeNull();
    });

    it('不存在的级别返回 null', () => {
      const result = loader.getPosition('admin' as CareerLine, 99, 0);
      expect(result).toBeNull();
    });

    it('不存在的部门返回 null', () => {
      const result = loader.getDepartment('admin' as CareerLine, 3, 0, 99);
      expect(result).toBeNull();
    });
  });

  describe('game config', () => {
    it('loads slot config correctly', () => {
      const cfg = loader.getGameConfig();
      expect(cfg.slotTiers.primary.count).toBe(3);
      expect(cfg.slotTiers.secondary.count).toBe(2);
      expect(cfg.slotTiers.reserve.count).toBe(1);
    });

    it('has correct retirement age', () => {
      const cfg = loader.getGameConfig();
      expect(cfg.retirementAge).toBe(65);
    });
  });
});
