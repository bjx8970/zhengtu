/**
 * 新版职位配置类型（Schema 2）
 *
 * 每个职位通过稳定 ID 查询，不再使用职业线/等级/索引。
 */

import type { InstitutionLevel, PositionDomain, LeadershipRank } from '../domain/career/types';
import type { ConditionExpression } from '../domain/conditions';

/** 新版职位配置 */
export interface PositionConfigV2 {
  /** 稳定职位 ID */
  id: string;
  /** 职位名称 */
  name: string;
  /** 稳定机构 ID */
  institutionId: string;
  /** 稳定地区 ID */
  regionId: string;
  /** 机构层级 */
  institutionLevel: InstitutionLevel;
  /** 岗位领域 */
  positionDomain: PositionDomain;
  /** 领导职务层次 */
  leadershipRank: LeadershipRank;
  /** 内容阶段（仅用于难度和解锁，不是职业事实） */
  contentTier: number;
  /** 编制空缺数 */
  vacancyCount: number;
  /** 任职条件（条件表达式树） */
  requirements: ConditionExpression[];
  /** 部门模板 ID 列表 */
  departmentTemplateIds: string[];
  /** KPI 模板 ID 列表 */
  kpiTemplateIds: string[];
  /** 年度预算（万元） */
  annualBudget: number;
}

/** 机构配置 */
export interface InstitutionConfig {
  id: string;
  name: string;
  level: InstitutionLevel;
  regionId: string;
}
