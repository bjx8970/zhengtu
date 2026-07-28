/**
 * ConfigLoader 政策加载测试
 *
 * 验证政策定义正确加载、索引、查询。
 */
import { describe, it, expect } from 'vitest';
import { getConfigLoader } from '../loader';

const loader = getConfigLoader();

describe('ConfigLoader - 政策定义', () => {
  describe('getPolicyDefinition', () => {
    it('返回存在的政策定义', () => {
      const policy = loader.getPolicyDefinition('industrial_park_support');
      expect(policy).toBeDefined();
      expect(policy!.id).toBe('industrial_park_support');
      expect(policy!.name).toBe('产业园区扶持政策');
      expect(policy!.category).toBe('economic');
    });

    it('返回 undefined 当政策不存在', () => {
      expect(loader.getPolicyDefinition('nonexistent_policy')).toBeNull();
    });
  });

  describe('getAllPolicyDefinitions', () => {
    it('返回所有政策定义', () => {
      const allPolicies = loader.getAllPolicyDefinitions();
      expect(allPolicies.length).toBeGreaterThanOrEqual(1);
      expect(allPolicies.some((p) => p.id === 'industrial_park_support')).toBe(true);
    });
  });

  describe('政策定义结构完整性', () => {
    it('每项政策有 id、name、category、tags、phases', () => {
      const allPolicies = loader.getAllPolicyDefinitions();
      for (const policy of allPolicies) {
        expect(policy.id).toBeTruthy();
        expect(policy.name).toBeTruthy();
        expect(policy.category).toBeTruthy();
        expect(Array.isArray(policy.tags)).toBe(true);
        expect(Array.isArray(policy.phases)).toBe(true);
        expect(policy.phases.length).toBeGreaterThan(0);
      }
    });

    it('每阶段有 id、name、durationDays', () => {
      const allPolicies = loader.getAllPolicyDefinitions();
      for (const policy of allPolicies) {
        for (const phase of policy.phases) {
          expect(phase.id).toBeTruthy();
          expect(phase.name).toBeTruthy();
          expect(phase.durationDays).toBeGreaterThan(0);
        }
      }
    });

    it('阶段 ID 在政策内唯一', () => {
      const allPolicies = loader.getAllPolicyDefinitions();
      for (const policy of allPolicies) {
        const phaseIds = policy.phases.map((p) => p.id);
        const uniqueIds = new Set(phaseIds);
        expect(uniqueIds.size).toBe(phaseIds.length);
      }
    });

    it('effectiveDelayDays 是非负数', () => {
      const allPolicies = loader.getAllPolicyDefinitions();
      for (const policy of allPolicies) {
        expect(policy.effectiveDelayDays).toBeGreaterThanOrEqual(0);
      }
    });

    it('标签无重复', () => {
      const allPolicies = loader.getAllPolicyDefinitions();
      for (const policy of allPolicies) {
        const uniqueTags = new Set(policy.tags);
        expect(uniqueTags.size).toBe(policy.tags.length);
      }
    });
  });

  describe('industrial_park_support 具体验证', () => {
    it('分类为 economic', () => {
      const policy = loader.getPolicyDefinition('industrial_park_support')!;
      expect(policy.category).toBe('economic');
    });

    it('包含三个阶段', () => {
      const policy = loader.getPolicyDefinition('industrial_park_support')!;
      expect(policy.phases.length).toBe(3);
    });

    it('阶段按顺序排列', () => {
      const policy = loader.getPolicyDefinition('industrial_park_support')!;
      const phaseNames = policy.phases.map((p) => p.name);
      expect(phaseNames).toEqual(['准备阶段', '实施阶段', '评估阶段']);
    });

    it('标签包含"园区"和"产业"', () => {
      const policy = loader.getPolicyDefinition('industrial_park_support')!;
      expect(policy.tags).toContain('园区');
      expect(policy.tags).toContain('产业');
    });
  });
});
