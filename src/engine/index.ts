/**
 * 游戏引擎聚合导出
 *
 * 按域组织，每个域一个 export *。
 * 引擎新增模块后在此文件注册即可对外暴露。
 */

export * from './core/time';
export * from './core/action';
export * from './core/effect';
export * from './core/event';
export * from './governance/kpi';
export * from './governance/budget';
export * from './governance/assessment';
export * from './career/promotion';
export * from './career/promotion-final';
export * from './career/promotion-target';
export * from './career/faction-penalty';
