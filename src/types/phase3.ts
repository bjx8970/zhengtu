/**
 * Phase 3 验收配置类型。
 *
 * 描述乡镇纵向切片的正式内容入口、阶段职位、节奏区间与正向 KPI producer，
 * 供 ConfigLoader、配置验证脚本和场景测试共享。
 */

/** Phase 3 验收入口支持的内容种类。 */
export type Phase3EntrypointKind =
  | 'personal_task'
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

/** Phase 3 乡镇纵向切片的验收配置。 */
export interface Phase3AcceptanceConfig {
  schemaVersion: 1;
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
    townshipDeputyAppointment: Phase3MilestoneRange;
    sectionMember4Promotion: Phase3MilestoneRange;
    townshipChiefOpportunity: Phase3MilestoneRange;
  };
  entrypoints: Phase3Entrypoint[];
  requiredKpiProducers: Phase3KpiProducerRequirement[];
}
