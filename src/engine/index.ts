/**
 * 游戏引擎聚合导出
 *
 * 按域组织，每个域一个 export *。
 * 引擎新增模块后在此文件注册即可对外暴露。
 */

export * from './core/time';
export * from './core/action';
export * from './core/effect';
export * from './core/timeline';
export * from './core/daily-timeline-plan';
export * from './tasks/personal-task';
export * from './events/condition-interpreter';
export * from './events/effect-executor';
export * from './events/metric-signal-bridge';
export * from './events/event-cooldown';
export * from './events/event-execution-order';
export * from './events/event-followup-planner';
export * from './events/event-orchestrator';
export * from './events/event-resolver';
export * from './events/event-scheduler';
export * from './events/source-key';
export * from './governance/corruption-report';
export * from './governance/kpi';
export * from './governance/budget';
export * from './governance/assessment';
export * from './governance/dimensions';
export * from './governance/policy-lifecycle';
export * from './governance/policy-milestone-selector';
export * from './career/civil-service-rank-eligibility';
export * from './career/civil-service-rank-progression';
export * from './career/career-opportunity-lifecycle';
export * from './career/career-opportunity-eligibility';
export * from './career/career-opportunity-readiness';
export * from './career/career-experience-analysis';
export * from './career/career-service';
export * from './career/probation-evaluation';
export * from './career/probation-progress';
export * from './career/rank-quota';
export * from './career/opportunity-orchestrator';
export * from './career/philosophy-imbalance';
export * from './career/spectrum-constraint';
export * from './career/style-derivation';
export * from './career/deviation-penalty';
export * from './career/style-decay';
export * from './career/extreme-unlocks';
export * from './career/relative-candidate-pool';
export * from './career/relative-scoring';
export * from './career/relative-selection-lifecycle';
export * from './world/flood-risk';
export * from './organization/organization-initialization';
export * from './organization/organization-invariants';
export * from './organization/organization-selectors';
export * from './organization/npc-lifecycle';
export * from './organization/vacancy-lifecycle';
export * from './organization/vacancy-producers';
