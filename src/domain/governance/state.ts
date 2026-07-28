/**
 * 治理持久化状态
 *
 * 定义 GovernanceState 及其子结构：
 * - PolicyInstance：政策实例（具有生命周期的持久化实体）
 * - PolicyOriginContextSnapshot：政策创建时的任职上下文快照
 * - PolicyExecutableSnapshot：政策批准时的定义快照
 * - GovernanceProjectInstance：治理项目实例
 */

import type { PolicyCategory, PolicyStatus } from './types';
import type { EffectDefinition } from '../conditions';
import type { InstitutionLevel, PositionDomain, LeadershipRank } from '../career/types';

/**
 * 指标集合：实体 ID → 指标字典。
 *
 * 外层键为机构 ID 或地区 ID，内层键为指标 ID。
 * 例如：`{ inst_001: { efficiency: 80, satisfaction: 65 } }`。
 */
export type MetricCollection = Record<string, Record<string, number>>;

/** 政策阶段定义（从政策配置冻结到快照） */
export interface PolicyPhaseDefinition {
  /** 阶段 ID（在单项政策内唯一） */
  id: string;
  /** 阶段名称 */
  name: string;
  /** 阶段描述 */
  description: string;
  /** 阶段持续天数（正整数） */
  durationDays: number;
  /** 进入本阶段时应用的效果 */
  entryEffects: EffectDefinition[];
  /** 完成本阶段时应用的效果 */
  completionEffects: EffectDefinition[];
}

/** 政策可执行快照（批准时冻结，后续不随配置变更） */
export interface PolicyExecutableSnapshot {
  /** 政策配置 ID */
  policyId: string;
  /** 政策名称 */
  name: string;
  /** 政策描述 */
  description: string;
  /** 政策分类 */
  category: PolicyCategory;
  /** 政策标签 */
  tags: string[];
  /** 生效延迟天数（批准后到可实施） */
  effectiveDelayDays: number;
  /** 批准时立即应用的效果 */
  approvalEffects: EffectDefinition[];
  /** 阶段列表（按顺序线性推进） */
  phases: PolicyPhaseDefinition[];
  /** 快照时的内容版本 */
  contentVersion: string;
}

/** 政策原始任职上下文快照（创建时冻结） */
export interface PolicyOriginContextSnapshot {
  /** 职位 ID */
  positionId: string;
  /** 机构 ID */
  institutionId: string;
  /** 地区 ID */
  regionId: string;
  /** 机构层级 */
  institutionLevel: InstitutionLevel;
  /** 岗位领域 */
  positionDomain: PositionDomain;
  /** 领导职务层次 */
  leadershipRank: LeadershipRank;
  /** 当前履历 ID（无法确定时可为 null） */
  experienceId: string | null;
}

/** 政策实例 */
export interface PolicyInstance {
  /** 唯一实例 ID */
  instanceId: string;
  /** 政策配置 ID */
  policyId: string;
  /** 当前状态 */
  status: PolicyStatus;
  /** 提议日（绝对日） */
  proposedAtDay: number;
  /** 批准日 */
  approvedAtDay: number | null;
  /** 生效日（批准日 + effectiveDelayDays） */
  effectiveAtDay: number | null;
  /** 当前阶段 ID（尚未实施时为 null） */
  currentPhaseId: string | null;
  /** 进入当前阶段的绝对日 */
  phaseEnteredAtDay: number | null;
  /** 当前阶段预计完成日 */
  nextMilestoneAtDay: number | null;
  /** 暂停日（非暂停状态为 null） */
  suspendedAtDay: number | null;
  /** 累计暂停天数 */
  accumulatedSuspendedDays: number;
  /** 完成日 */
  completedAtDay: number | null;
  /** 失败日 */
  failedAtDay: number | null;
  /** 废止日 */
  repealedAtDay: number | null;
  /** 原始任职上下文（创建时冻结） */
  originContext: PolicyOriginContextSnapshot;
  /** 政策定义快照（批准时冻结） */
  snapshot: PolicyExecutableSnapshot;
  /** 政策实例自身指标 */
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
  institutionMetrics: MetricCollection;
  /** 地区指标（地区 ID → 指标字典） */
  regionMetrics: MetricCollection;
}
