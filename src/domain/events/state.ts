/**
 * 事件运行时持久化状态
 *
 * 定义 EventRuntimeState 及其子结构：
 * - EventInstance：事件实例（保存来源信号和触发时上下文快照）
 * - ScheduledEventInstance：计划事件
 * - EventHistoryRecord：事件历史记录
 * - EventChainInstance：事件链实例
 */

import type {
  EventInstanceStatus,
  EventChainStatus,
  EventPriority,
  EventPresentation,
} from './types';
import type { DomainSignal, DomainSignalSnapshot } from '../governance/types';

/** 事件实例 */
export interface EventInstance {
  /** 唯一实例 ID */
  instanceId: string;
  /** 事件配置 ID */
  eventId: string;
  /** 当前状态 */
  status: EventInstanceStatus;
  /** 优先级 */
  priority: EventPriority;
  /** 呈现方式 */
  presentation: EventPresentation;
  /** 触发的绝对游戏日 */
  triggeredAtDay: number;
  /** 来源信号类型 */
  sourceSignal: DomainSignal;
  /** 触发时上下文快照（使用 DomainSignalSnapshot 而非开放 Record） */
  triggerContext: DomainSignalSnapshot;
  /** 截止时间（null 表示无截止） */
  deadlineDay: number | null;
  /** 所属事件链实例 ID（null 表示独立事件） */
  chainInstanceId: string | null;
}

/** 计划事件实例 */
export interface ScheduledEventInstance {
  /** 唯一实例 ID */
  instanceId: string;
  /** 事件配置 ID */
  eventId: string;
  /** 计划激活的绝对游戏日 */
  activateAtDay: number;
  /** 来源信号 */
  sourceSignal: DomainSignal;
  /** 触发时上下文快照 */
  triggerContext: DomainSignalSnapshot;
  /** 所属事件链实例 ID */
  chainInstanceId: string | null;
}

/** 事件历史记录 */
export interface EventHistoryRecord {
  /** 事件配置 ID */
  eventId: string;
  /** 实例 ID */
  instanceId: string;
  /** 解决的绝对游戏日 */
  resolvedAtDay: number;
  /** 玩家选择的选项 ID */
  chosenOptionId: string | null;
  /** 最终结果描述 */
  outcome: string;
}

/** 事件链实例 */
export interface EventChainInstance {
  /** 唯一实例 ID */
  instanceId: string;
  /** 事件链配置 ID */
  chainId: string;
  /** 当前状态 */
  status: EventChainStatus;
  /** 当前步骤索引 */
  currentStepIndex: number;
  /** 来源上下文（政策/项目/地区/剧情） */
  sourceContext: Record<string, string | number>;
  /** 开始的绝对游戏日 */
  startedAtDay: number;
  /** 已完成的步骤 ID 列表 */
  completedStepIds: string[];
}

/** 事件运行时状态（PlayerSave 子状态） */
export interface EventRuntimeState {
  /** 当前阻塞事件 ID（null 表示无阻塞） */
  activeBlockingEventId: string | null;
  /** 待处理事件实例 */
  pending: EventInstance[];
  /** 计划事件实例 */
  scheduled: ScheduledEventInstance[];
  /** 事件历史记录 */
  history: EventHistoryRecord[];
  /** 事件冷却（事件 ID → 可再次触发的绝对游戏日） */
  cooldownUntilDay: Record<string, number>;
  /** 事件链实例（链实例 ID → 实例） */
  chainInstances: Record<string, EventChainInstance>;
}
