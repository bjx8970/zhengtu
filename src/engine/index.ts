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
export * from './events/condition-interpreter';
export * from './events/effect-executor';
export * from './events/event-cooldown';
export * from './events/event-followup-planner';
export * from './events/event-orchestrator';
export * from './events/event-resolver';
export * from './events/event-scheduler';
export * from './events/source-key';
export * from './governance/kpi';
export * from './governance/budget';
export * from './governance/assessment';
export * from './governance/dimensions';
export * from './career/promotion';
export * from './career/promotion-final';
export * from './career/promotion-target';
export * from './career/philosophy-imbalance';
export * from './career/spectrum-constraint';
export * from './career/style-derivation';
export * from './career/deviation-penalty';
export * from './career/style-decay';
export * from './career/extreme-unlocks';
