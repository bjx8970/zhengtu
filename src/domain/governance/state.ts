/**
 * 治理持久化状态
 *
 * 定义 GovernanceState 及其子结构：
 * - PolicyInstance：政策实例（具有生命周期的持久化实体）
 * - GovernanceProjectInstance：治理项目实例
 */

import type { PolicyStatus } from './types';

/** 政策实例 */
export interface PolicyInstance {
  /** 唯一实例 ID */
  instanceId: string;
  /** 政策配置 ID */
  policyId: string;
  /** 当前状态 */
  status: PolicyStatus;
  /** 提议日 */
  proposedAtDay: number;
  /** 批准日 */
  approvedAtDay: number | null;
  /** 生效日 */
  effectiveAtDay: number | null;
  /** 关联地区 ID */
  regionId: string;
  /** 负责机构 ID */
  responsibleInstitutionId: string;
  /** 当前阶段 ID */
  currentPhaseId: string;
  /** 政策指标 */
  metrics: Record<string, number>;
}

/** 治理项目实例 */
export interface GovernanceProjectInstance {
  /** 唯一实例 ID */
  instanceId: string;
  /** 项目配置 ID */
  projectId: string;
  /** 当前状态 */
  status: 'planning' | 'active' | 'completed' | 'suspended' | 'failed';
  /** 开始日 */
  startedAtDay: number;
  /** 关联地区 ID */
  regionId: string;
  /** 关联机构 ID */
  institutionId: string;
  /** 项目指标 */
  metrics: Record<string, number>;
}

/** 治理状态（PlayerSave 子状态） */
export interface GovernanceState {
  /** 政策实例列表 */
  policies: PolicyInstance[];
  /** 治理项目实例列表 */
  projects: GovernanceProjectInstance[];
  /** 机构指标（机构 ID → 指标字典） */
  institutionMetrics: Record<string, number>;
  /** 地区指标（地区 ID → 指标字典） */
  regionMetrics: Record<string, number>;
}
