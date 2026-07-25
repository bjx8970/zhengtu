/**
 * 事件运行时持久化状态
 *
 * 定义 EventRuntimeState 及其子结构（Schema 4）：
 * - EventExecutableSnapshot：事件可执行快照（从 EventDefinition 复制）
 * - EventInstance：事件实例（含来源键和快照）
 * - ScheduledEventInstance：计划事件实例
 * - AppliedEffectRecord：已应用效果记录
 * - EventHistoryRecord：事件历史记录
 * - EventChainInstance：事件链实例
 * - cooldowns 数组取代旧 cooldownUntilDay 字典
 */

import type {
  EventInstanceStatus,
  EventChainStatus,
  EventPriority,
  EventPresentation,
  EventCooldownRecord,
} from './types';
import type { DomainSignalSnapshot } from '../governance/types';
import type { EventOptionDefinition, EventOutcomePayload, EventRepeatPolicy } from './definition';

/** 事件可执行快照 */
export interface EventExecutableSnapshot {
  eventId: string;
  title: string;
  description: string;
  category: string;
  priority: EventPriority;
  presentation: EventPresentation;
  options: EventOptionDefinition[];
  automaticOutcome: EventOutcomePayload | null;
  mutexGroup: string | null;
  contentVersion: string;
  /** 截止天数（从激活日开始计算，null 表示无截止） */
  deadlineDays: number | null;
  /** 事件链 ID（null 表示不属于链） */
  chainId: string | null;
  /** 链内节点 ID（null 表示非链节点） */
  nodeId: string | null;
  /** 实例创建时冻结的重复与冷却策略 */
  repeatPolicy: EventRepeatPolicy;
}

/** 事件实例 */
export interface EventInstance {
  instanceId: string;
  eventId: string;
  status: EventInstanceStatus;
  triggeredAtDay: number;
  activatedAtDay: number;
  deadlineDay: number | null;
  triggerContext: DomainSignalSnapshot;
  sourceKey: string;
  chainInstanceId: string | null;
  snapshot: EventExecutableSnapshot;
}

/** 计划事件实例 */
export interface ScheduledEventInstance {
  instanceId: string;
  eventId: string;
  scheduledAtDay: number;
  activateAtDay: number;
  triggerContext: DomainSignalSnapshot;
  sourceKey: string;
  chainInstanceId: string | null;
  snapshot: EventExecutableSnapshot;
}

/**
 * 因 blocking 事件暂停、且必须按原因果顺序恢复的工作项。
 *
 * 实例与信号必须共用一个有序队列；分开保存会令 event.resolved
 * 在它原本应先执行的零延迟后续之前恢复。
 */
export type EventContinuation =
  | { kind: 'instance'; instance: EventInstance }
  | { kind: 'signal'; signal: DomainSignalSnapshot; cascadeDepth: number };

/** 已应用效果记录 */
export interface AppliedEffectRecord {
  target: string;
  field?: string;
  operation: string;
  value: boolean | number | string;
  label: string;
}

/** 事件历史记录 */
export interface EventHistoryRecord {
  eventId: string;
  instanceId: string;
  finalStatus: 'resolved' | 'expired' | 'cancelled';
  triggeredAtDay: number;
  completedAtDay: number;
  sourceKey: string;
  chainInstanceId: string | null;
  titleSnapshot: string;
  chosenOptionId: string | null;
  chosenOptionLabel: string | null;
  appliedEffects: AppliedEffectRecord[];
}

/** 事件链实例 */
export interface EventChainInstance {
  instanceId: string;
  chainId: string;
  status: EventChainStatus;
  sourceKey: string;
  activeNodeIds: string[];
  completedNodeIds: string[];
  startedAtDay: number;
  completedAtDay: number | null;
}

/** 事件运行时状态（PlayerSave 子状态） */
export interface EventRuntimeState {
  activeBlockingEventId: string | null;
  pending: EventInstance[];
  scheduled: ScheduledEventInstance[];
  history: EventHistoryRecord[];
  cooldowns: EventCooldownRecord[];
  chainInstances: Record<string, EventChainInstance>;
  /** 已处理信号 ID 集合（防重入），SignalId → completedAtDay */
  processedSignalIds: string[];
  /** 旧 Schema 4 信号队列；首次恢复时迁入 deferredContinuations。 */
  deferredSignals: DomainSignalSnapshot[];
  /** 统一、可持久化的实例/信号 continuation 队列。 */
  deferredContinuations: EventContinuation[];
}
