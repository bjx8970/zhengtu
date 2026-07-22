/**
 * 世界状态
 *
 * 定义 WorldState：全局事实、指标和政治周期。
 * DomainSignalSnapshot 已迁移到 governance/types.ts 作为单一事实来源。
 */

import type { DomainSignalSnapshot } from './governance/types';

// 重新导出供外部使用
export type { DomainSignalSnapshot };

/** 政治周期状态 */
export interface PoliticalCycleState {
  /** 周期类型 */
  type: 'party_congress' | 'people_congress' | 'local_election';
  /** 当前届次 */
  termNumber: number;
  /** 周期开始的绝对游戏日 */
  startedAtDay: number;
  /** 周期结束的绝对游戏日 */
  endsAtDay: number;
  /** 当前阶段 */
  phase: 'preparation' | 'session' | 'implementation' | 'evaluation';
}

/** 世界状态（PlayerSave 子状态） */
export interface WorldState {
  /** 世界事实（键 → 布尔/数值/字符串） */
  facts: Record<string, boolean | number | string>;
  /** 世界指标（指标 ID → 数值） */
  metrics: Record<string, number>;
  /** 活跃政治周期 */
  activeCycles: PoliticalCycleState[];
}
