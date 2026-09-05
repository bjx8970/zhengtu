/**
 * 可中断统一时间轴 Reducer（Schema 6）。
 *
 * ADVANCE_TIME 在完整存档副本上执行：先恢复事件与同日时间轴 continuation，
 * 再逐日提交行动、政策、计划事件和周期节点，任一异常均回滚整个动作。
 */

import { unwrap } from 'solid-js/store';
import type { EventDefinition } from '../../domain/events/definition';
import {
  buildDailyTimelinePlan,
  getTimelineContinuationNodePriority,
} from '../../engine/core/daily-timeline-plan';
import { getGranularityDays } from '../../engine/core/time';
import { advanceTimeline } from '../../engine/core/timeline';
import type { AdvanceTimePayload } from '../../types/actions';
import type { ActionCompletionTimelineEvent } from '../../types/game';
import type {
  CompletedActionNotification,
  PlayerSave,
  TimelineContinuation,
  TimelineContinuationNode,
} from '../../types/player';
import { getConfigLoader } from '../../config/loader';
import { createRuntimeIdFactory } from '../runtime-id';
import { processCascadeSignalsInTransaction } from './event-reducer';
import {
  expireEventsAtDay,
  processDailyFacts,
  processTimelineNodes,
} from '../transactions/timeline-day-transaction';

/**
 * 原子处理 ADVANCE_TIME。
 *
 * @param draft 当前游戏状态草稿
 * @param payload 时间粒度与可注入运行时依赖
 * @returns void
 */
export function reduceAdvanceTime(draft: PlayerSave, payload: AdvanceTimePayload): void {
  const transaction = structuredClone(unwrap(draft));
  reduceAdvanceTimeInternal(transaction, payload);
  Object.assign(draft, transaction);
}

function reduceAdvanceTimeInternal(draft: PlayerSave, payload: AdvanceTimePayload): void {
  const loader = getConfigLoader();
  const config = loader.getGameConfig();
  const definitions = loader.getAllEventDefinitions();
  const rng = payload._rng ?? Math.random;
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('timeline');
  const notifications: CompletedActionNotification[] = [];
  draft.time.granularity = payload.granularity;

  // 延续旧时间轴语义：即使 blocker 仍未解决，也要先清理已经越过截止日的事件。
  // 否则恢复 continuation 时，旧 pending 实例可能错误阻止同来源的可重复事件。
  expireEventsAtDay(draft, draft.time.totalDaysPlayed);
  if (draft.events.activeBlockingEventId !== null) return;

  if (draft.events.deferredContinuations.length > 0 || draft.events.deferredSignals.length > 0) {
    processCascadeSignalsInTransaction(
      draft,
      [],
      draft.time.totalDaysPlayed,
      rng,
      idFactory,
      definitions,
    );
    if (draft.events.activeBlockingEventId !== null) return;
  }

  if (draft.time.pendingContinuation) {
    assertValidTimelineContinuation(draft.time.pendingContinuation, draft.time.totalDaysPlayed);
    const resumed = processTimelineNodes(
      draft,
      draft.time.pendingContinuation.remainingNodes,
      rng,
      idFactory,
      definitions,
    );
    draft.time.pendingContinuation = resumed.interrupted
      ? {
          absoluteDay: draft.time.totalDaysPlayed,
          remainingNodes: resumed.remainingNodes,
        }
      : null;
    // 恢复同日工作的这次操作绝不顺带进入下一日。
    updateNotifications(draft, notifications);
    return;
  }

  if (!processCurrentDayBeforeAdvance(draft, rng, idFactory, definitions, notifications)) {
    updateNotifications(draft, notifications);
    return;
  }

  const days = getGranularityDays(payload.granularity, config);
  for (let elapsed = 0; elapsed < days; elapsed++) {
    const daily = advanceTimeline(
      draft.time,
      1,
      draft.time.totalDaysPlayed,
      draft.actions.slots,
      draft.character.birthYear,
      config,
    );
    draft.time.year = daily.newTime.year;
    draft.time.month = daily.newTime.month;
    draft.time.day = daily.newTime.day;
    draft.time.totalDaysPlayed = daily.newAbsoluteDay;

    const actionEvents = daily.events.filter(
      (event): event is ActionCompletionTimelineEvent => event.type === 'action_completion',
    );
    const remainingNodes = buildDailyTimelinePlan(
      daily.newAbsoluteDay,
      daily.events,
      draft.world.activeCycles.length > 0 ? draft.time.year : undefined,
    );
    processDailyFacts(
      draft,
      daily.newAbsoluteDay,
      actionEvents,
      rng,
      idFactory,
      definitions,
      notifications,
    );
    if (draft.events.activeBlockingEventId !== null) {
      saveContinuation(draft, remainingNodes);
      break;
    }

    const processed = processTimelineNodes(draft, remainingNodes, rng, idFactory, definitions);
    if (processed.terminal) break;
    if (processed.interrupted) {
      saveContinuation(draft, processed.remainingNodes);
      break;
    }
  }
  updateNotifications(draft, notifications);
}

function processCurrentDayBeforeAdvance(
  draft: PlayerSave,
  rng: () => number,
  idFactory: () => string,
  definitions: readonly EventDefinition[],
  notifications: CompletedActionNotification[],
): boolean {
  const currentDay = draft.time.totalDaysPlayed;
  const nodes = buildDailyTimelinePlan(
    currentDay,
    [],
    draft.world.activeCycles.length > 0 ? draft.time.year : undefined,
  );
  processDailyFacts(draft, currentDay, [], rng, idFactory, definitions, notifications);
  if (draft.events.activeBlockingEventId !== null) {
    saveContinuation(draft, nodes);
    return false;
  }
  const processed = processTimelineNodes(draft, nodes, rng, idFactory, definitions);
  if (processed.terminal) return false;
  if (processed.interrupted) {
    saveContinuation(draft, processed.remainingNodes);
    return false;
  }
  return true;
}

function saveContinuation(draft: PlayerSave, nodes: TimelineContinuationNode[]): void {
  draft.time.pendingContinuation = {
    absoluteDay: draft.time.totalDaysPlayed,
    remainingNodes: [...nodes],
  };
}

function updateNotifications(
  draft: PlayerSave,
  notifications: CompletedActionNotification[],
): void {
  if (notifications.length === 0) return;
  draft.actions.lastCompletedActions = [
    ...notifications,
    ...draft.actions.lastCompletedActions,
  ].slice(0, 5);
}

function assertValidTimelineContinuation(
  continuation: TimelineContinuation,
  currentDay: number,
): void {
  if (continuation.absoluteDay !== currentDay) {
    throw new Error('Timeline continuation does not belong to the current absolute day');
  }
  const seen = new Set<TimelineContinuationNode['type']>();
  let priority = -1;
  for (const node of continuation.remainingNodes) {
    if (node.absoluteDay !== currentDay) {
      throw new Error('Timeline continuation node has an invalid absolute day');
    }
    if (seen.has(node.type)) {
      throw new Error(`Duplicate timeline continuation node "${node.type}"`);
    }
    seen.add(node.type);
    const nextPriority = getTimelineContinuationNodePriority(node);
    if (nextPriority < priority) {
      throw new Error('Timeline continuation nodes are not in fixed execution order');
    }
    priority = nextPriority;
  }
}
