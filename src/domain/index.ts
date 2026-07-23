/**
 * 领域模型聚合导出
 *
 * 统一导出职业、治理、事件和世界状态的领域契约与持久化类型。
 */

// 职业领域
export * from './career/types';
export * from './career/state';

// 治理领域
export * from './governance/types';
export * from './governance/state';

// 事件领域
export * from './events/types';
export * from './events/state';
export * from './events/definition';

// 世界状态
export * from './world-state';

// 统一条件与效果
export * from './conditions';
