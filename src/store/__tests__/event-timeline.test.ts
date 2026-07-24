/**
 * 事件统一时间轴回归测试
 *
 * 验证计划事件按绝对日激活、阻塞中断以及单次时间事务内的 ID 唯一性。
 */

import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';
import { createEventSnapshot } from '../../engine/events/event-orchestrator';
import { getConfigLoader } from '../../config/loader';
import type { DomainSignalSnapshot } from '../../domain/governance/types';

function makeSignal(signalId: string, occurredAtDay = 0): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'world.metric_changed',
    occurredAtDay,
    data: { metricId: 'timeline_test', value: 1 },
  };
}

describe('event timeline integration', () => {
  it('stops a long advance on the exact day a blocking event activates', () => {
    const state = createInitialState();
    const snapshot = createEventSnapshot({
      id: 'timeline_blocker',
      chainId: null,
      nodeId: null,
      title: 'Timeline blocker',
      description: '',
      category: 'governance',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['world.metric_changed'] },
      repeatPolicy: { mode: 'once' },
      activation: { deadlineDays: 3 },
      options: [{ id: 'ack', label: '处理', description: '', effects: [] }],
    });
    state.events.scheduled.push({
      instanceId: 'scheduled_blocker',
      eventId: snapshot.eventId,
      scheduledAtDay: 0,
      activateAtDay: 5,
      triggerContext: makeSignal('blocker_trigger'),
      sourceKey: 'timeline_source',
      chainInstanceId: null,
      snapshot,
    });
    const store = createTestStore(state);
    let sequence = 0;

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'month',
      _rng: () => 0,
      _idFactory: () => `timeline_${sequence++}`,
    });

    const after = store.getRawState();
    expect(after.time.totalDaysPlayed).toBe(5);
    expect(after.events.activeBlockingEventId).toBe('scheduled_blocker');
    expect(
      after.events.pending.find((item) => item.instanceId === 'scheduled_blocker')?.status,
    ).toBe('active');
  });

  it('shares one monotonic ID factory across automatic follow-ups and secondary cascades', () => {
    const definition = getConfigLoader().getEventDefinition('formal_investigation')!;
    const state = createInitialState();
    state.events.chainInstances['investigation_instance'] = {
      instanceId: 'investigation_instance',
      chainId: 'investigation_chain',
      status: 'active',
      sourceKey: 'timeline_chain_source',
      activeNodeIds: ['investigation'],
      completedNodeIds: [],
      startedAtDay: 0,
      completedAtDay: null,
    };
    state.events.scheduled.push({
      instanceId: 'scheduled_automatic',
      eventId: definition.id,
      scheduledAtDay: 0,
      activateAtDay: 5,
      triggerContext: makeSignal('automatic_trigger'),
      sourceKey: 'timeline_chain_source',
      chainInstanceId: 'investigation_instance',
      snapshot: createEventSnapshot(definition),
    });
    const store = createTestStore(state);
    let sequence = 0;

    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'week',
      _rng: () => 0,
      _idFactory: () => `transaction_${sequence++}`,
    });

    const after = store.getRawState();
    const formalHistory = after.events.history.find(
      (item) => item.instanceId === 'scheduled_automatic',
    );
    expect(formalHistory?.completedAtDay).toBe(5);
    expect(after.events.history.some((item) => item.eventId === 'investigation_cleared')).toBe(
      true,
    );
    expect(after.events.processedSignalIds.length).toBeGreaterThanOrEqual(2);

    const generatedIds = [
      ...after.events.pending.map((item) => item.instanceId),
      ...after.events.scheduled.map((item) => item.instanceId),
      ...after.events.history.map((item) => item.instanceId),
      ...after.events.processedSignalIds,
    ].filter((id) => id.startsWith('transaction_'));
    expect(new Set(generatedIds).size).toBe(generatedIds.length);
  });
});
