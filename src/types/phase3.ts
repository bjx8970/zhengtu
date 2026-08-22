/**
 * Phase 3 验收配置类型。
 *
 * 描述乡镇纵向切片的正式内容入口、阶段职位、节奏区间与正向 KPI producer，
 * 供 ConfigLoader、配置验证脚本和场景测试共享。
 */

/** Phase 3 验收入口支持的内容种类。 */
export type Phase3EntrypointKind =
  | 'personal_task'
  | 'department_action'
  | 'career_opportunity'
  | 'event'
  | 'policy'
  | 'rank_progression'
  | 'timeline_node';

/** Phase 3 关键 producer/consumer 入口。 */
export interface Phase3Entrypoint {
  /** 入口在可达性链中的职责。 */
  role: 'producer' | 'consumer';
  /** 对应内容目录。 */
  kind: Phase3EntrypointKind;
  /** 稳定内容 ID；timeline_node 使用固定节点类型。 */
  contentId: string;
  /** 入口承担的玩法职责。 */
  purpose: string;
}

/** 确定性场景允许出现里程碑的绝对日区间。 */
export interface Phase3MilestoneRange {
  minDay: number;
  maxDay: number;
}

/** 初始科员正向 KPI 的个人任务 producer 声明。 */
export interface Phase3KpiProducerRequirement {
  positionId: string;
  kpiId: string;
  personalTaskIds: string[];
}

/** 正式个人任务必须在此运行时上下文和截止日前可承接。 */
export interface Phase3TaskReachabilityBound {
  taskId: string;
  leadershipRank: import('../domain/career/types').LeadershipRank;
  civilServiceRank: import('../domain/career/types').CivilServiceRank;
  /** 从新游戏第 0 天起计算的最晚可承接日。 */
  deadlineDay: number;
}

/** Phase 3 乡镇纵向切片的验收配置。 */
export interface Phase3AcceptanceConfig {
  schemaVersion: 2;
  phaseId: 'phase3_township_vertical_slice';
  saveSchemaVersion: 10;
  targetContentVersion: string;
  stagePositionIds: {
    clerk: string;
    townshipDeputy: string;
    townshipChief: string;
  };
  milestones: {
    probationPassed: Phase3MilestoneRange;
    firstRankPromotion: Phase3MilestoneRange;
    townshipDeputyOpportunity: Phase3MilestoneRange;
    townshipDeputyAppointment: Phase3MilestoneRange;
    townshipDeputyGovernance: Phase3MilestoneRange;
    sectionMember4Promotion: Phase3MilestoneRange;
    townshipChiefOpportunity: Phase3MilestoneRange;
    townshipChiefAppointment: Phase3MilestoneRange;
  };
  /** 正常 Store 场景锁定的精确回归日期，必须落在对应里程碑区间内。 */
  deterministicScenarioDays: {
    probationPassed: number;
    firstRankPromotion: number;
    townshipDeputyOpportunity: number;
    townshipDeputyAppointment: number;
    townshipDeputyGovernance: number;
    sectionMember4Promotion: number;
    townshipChiefOpportunity: number;
    townshipChiefAppointment: number;
  };
  entrypoints: Phase3Entrypoint[];
  requiredKpiProducers: Phase3KpiProducerRequirement[];
  /** 为正式任务 producer 锁定运行时前置条件的有界验证上下文。 */
  taskReachabilityBounds: Phase3TaskReachabilityBound[];
}
