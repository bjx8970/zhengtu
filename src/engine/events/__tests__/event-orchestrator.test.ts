/**
 * 事件编排器测试
 *
 * 覆盖 processDomainSignal 的全部功能：
 * 信号去重、来源隔离、条件评估、重复控制、冷却、概率、
 * 互斥组、实例创建、自动事件、延迟事件、最大激活次数。
 */
import { describe, it, expect } from 'vitest';
import { processDomainSignal, createEventSnapshot } from '../event-orchestrator';
import type { EventOrchestrationInput } from '../event-orchestrator';
import { createInitialState } from '../../../store/game-store';
import type { PlayerSave } from '../../../types/player';
import type { DomainSignalSnapshot } from '../../../domain/governance/types';
import type { EventDefinition } from '../../../domain/events/definition';
/** 创建 world.metric_changed 信号快照 */
function makeSignal(
  signalId: string,
  overrides?: Partial<DomainSignalSnapshot>,
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'world.metric_changed',
    occurredAtDay: 100,
    data: { metricId: 'gdp_growth', value: 5.5 },
    ...overrides,
  } as DomainSignalSnapshot;
}

/** 创建 action.completed 信号快照 */
function makeActionSignal(signalId: string, actionInstanceId: string): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'action.completed',
    occurredAtDay: 100,
    data: {
      actionInstanceId,
      actionId: 'build_road',
      deptId: 'transport_dept',
      regionId: 'east',
      institutionId: 'transport_bureau',
    },
  };
}

/** 创建默认 EventDefinition */
function makeEventDef(overrides?: Partial<EventDefinition>): EventDefinition {
  return {
    id: 'evt_test',
    chainId: null,
    nodeId: null,
    title: 'Test Event',
    description: 'A test event',
    category: 'governance',
    priority: 'normal',
    presentation: 'inbox',
    trigger: { sources: ['world.metric_changed'] },
    repeatPolicy: { mode: 'once' },
    activation: { deadlineDays: 7 },
    options: [
      {
        id: 'opt_a',
        label: '选项A',
        description: '选择A',
        effects: [],
      },
    ],
    ...overrides,
  };
}

/** 创建编排输入 */
function makeInput(overrides: Partial<EventOrchestrationInput>): EventOrchestrationInput {
  const state = overrides.state ?? createInitialState();
  let idCounter = 0;
  return {
    state,
    signal: makeSignal('sig_initial'),
    currentDay: 100,
    definitions: [makeEventDef()],
    rng: () => 0.5,
    idFactory: () => `test_id_${idCounter++}`,
    ...overrides,
  };
}

describe('createEventSnapshot', () => {
  it('builds snapshot from EventDefinition', () => {
    const def = makeEventDef({
      id: 'evt_snap_test',
      title: 'Snapshot Event',
      description: 'Snapshot desc',
      priority: 'high',
      presentation: 'blocking',
      mutexGroup: 'mutex_A',
    });
    const snap = createEventSnapshot(def);
    expect(snap.eventId).toBe('evt_snap_test');
    expect(snap.title).toBe('Snapshot Event');
    expect(snap.description).toBe('Snapshot desc');
    expect(snap.priority).toBe('high');
    expect(snap.presentation).toBe('blocking');
    expect(snap.mutexGroup).toBe('mutex_A');
    expect(snap.options).toHaveLength(1);
    expect(snap.automaticOutcome).toBeNull();
    expect(snap.contentVersion).toBeDefined();
  });

  it('snapshot with automaticOutcome copies it', () => {
    const def = makeEventDef({
      id: 'evt_auto_snap',
      presentation: 'automatic',
      automaticOutcome: { effects: [] },
      options: [],
    });
    const snap = createEventSnapshot(def);
    expect(snap.automaticOutcome).toEqual({ effects: [] });
    expect(snap.options).toHaveLength(0);
  });

  it('snapshot uses trigger.mutexGroup fallback', () => {
    const def = makeEventDef({
      id: 'evt_mutex_snap',
      trigger: { sources: ['world.metric_changed'], mutexGroup: 'mg_from_trigger' },
    });
    const snap = createEventSnapshot(def);
    expect(snap.mutexGroup).toBe('mg_from_trigger');
  });
});

describe('processDomainSignal - 信号去重', () => {
  it('same signalId processed twice → second call gets duplicate_signal diagnostic', () => {
    const input = makeInput({ signal: makeSignal('dup_sig_1') });
    // First call creates an instance
    const result1 = processDomainSignal(input);
    expect(result1.createdInstances).toHaveLength(1);

    // Second call with same state (includes new pending instance) + same signal
    const stateWithPending = {
      ...input.state,
      events: {
        ...input.state.events,
        pending: [...result1.createdInstances],
      },
    };
    const result2 = processDomainSignal({
      ...input,
      state: stateWithPending,
      signal: makeSignal('dup_sig_1'),
    });
    expect(result2.diagnostics.some((d) => d.type === 'duplicate_signal')).toBe(true);
    expect(result2.createdInstances).toHaveLength(0);
  });

  it('different signalId same payload → both create instances', () => {
    const input = makeInput({ signal: makeSignal('sig_A') });
    const result1 = processDomainSignal(input);
    const result2 = processDomainSignal({
      ...input,
      signal: makeSignal('sig_B'),
    });
    expect(result1.createdInstances).toHaveLength(1);
    expect(result2.createdInstances).toHaveLength(1);
  });
});

describe('processDomainSignal - 来源隔离', () => {
  it('once_per_source with different sourceKeys → both fire', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'once_per_source' },
      trigger: { sources: ['action.completed'] },
    });
    const input = makeInput({
      definitions: [def],
      signal: makeActionSignal('sig_src_1', 'action_001'),
    });
    const result1 = processDomainSignal(input);
    expect(result1.createdInstances).toHaveLength(1);

    const result2 = processDomainSignal({
      ...input,
      signal: makeActionSignal('sig_src_2', 'action_002'),
    });
    expect(result2.createdInstances).toHaveLength(1);
  });

  it('once_per_source with same sourceKey → only first fires', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'once_per_source' },
      trigger: { sources: ['action.completed'] },
    });
    const input = makeInput({
      definitions: [def],
      signal: makeActionSignal('sig_src_3', 'action_003'),
    });
    const result1 = processDomainSignal(input);
    expect(result1.createdInstances).toHaveLength(1);

    const stateWithPending = {
      ...input.state,
      events: { ...input.state.events, pending: result1.createdInstances },
    };
    const result2 = processDomainSignal({
      ...input,
      state: stateWithPending,
      signal: makeActionSignal('sig_src_4', 'action_003'),
    });
    expect(result2.diagnostics.some((d) => d.type === 'repeat_blocked')).toBe(true);
    expect(result2.createdInstances).toHaveLength(0);
  });

  it('same event triggered by different sourceKeys both fire for repeatable', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'repeatable' },
      trigger: { sources: ['action.completed'] },
    });
    const input = makeInput({
      definitions: [def],
      signal: makeActionSignal('sig_ms_1', 'action_010'),
    });
    const result1 = processDomainSignal(input);
    const result2 = processDomainSignal({
      ...input,
      signal: makeActionSignal('sig_ms_2', 'action_011'),
    });
    expect(result1.createdInstances).toHaveLength(1);
    expect(result2.createdInstances).toHaveLength(1);
  });
});

describe('processDomainSignal - 条件评估', () => {
  it('condition passes → event created', () => {
    const def = makeEventDef({
      trigger: {
        sources: ['world.metric_changed'],
        condition: { worldMetric: 'gdp_growth', op: 'gte', value: 0 },
      },
    });
    const input = makeInput({ definitions: [def] });
    const inputWithGdp = {
      ...input,
      state: {
        ...input.state,
        world: { ...input.state.world, metrics: { gdp_growth: 10 } },
      },
    };
    const result = processDomainSignal(inputWithGdp);
    expect(result.createdInstances).toHaveLength(1);
  });

  it('condition fails → condition_failed diagnostic, no instance', () => {
    const def = makeEventDef({
      trigger: {
        sources: ['world.metric_changed'],
        condition: { worldMetric: 'gdp_growth', op: 'gte', value: 100 },
      },
    });
    const input = makeInput({ definitions: [def] });
    const inputWithGdp = {
      ...input,
      state: {
        ...input.state,
        world: { ...input.state.world, metrics: { gdp_growth: 5 } },
      },
    };
    const result = processDomainSignal(inputWithGdp);
    expect(result.createdInstances).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.type === 'condition_failed')).toBe(true);
  });

  it('multiple candidates, some pass condition, some fail', () => {
    const defA = makeEventDef({
      id: 'evt_pass',
      trigger: {
        sources: ['world.metric_changed'],
        condition: { worldMetric: 'gdp_growth', op: 'gte', value: 10 },
      },
    });
    const defB = makeEventDef({
      id: 'evt_fail',
      trigger: {
        sources: ['world.metric_changed'],
        condition: { worldMetric: 'gdp_growth', op: 'gte', value: 100 },
      },
    });
    const input = makeInput({ definitions: [defA, defB] });
    const inputWithGdp = {
      ...input,
      state: {
        ...input.state,
        world: { ...input.state.world, metrics: { gdp_growth: 20 } },
      },
    };
    const result = processDomainSignal(inputWithGdp);
    const createdIds = result.createdInstances.map((i) => i.eventId);
    expect(createdIds).toContain('evt_pass');
    expect(createdIds).not.toContain('evt_fail');
    const failDiag = result.diagnostics.find(
      (d) => d.type === 'condition_failed' && d.eventId === 'evt_fail',
    );
    expect(failDiag).toBeDefined();
  });

  it('condition based on signal data', () => {
    const def = makeEventDef({
      trigger: {
        sources: ['action.completed'],
        condition: { signalField: 'deptId', op: 'eq', value: 'transport_dept' },
      },
    });
    const input = makeInput({
      definitions: [def],
      signal: makeActionSignal('sig_cond', 'act_cond'),
    });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
  });

  it('condition based on event history', () => {
    const def = makeEventDef({
      trigger: {
        sources: ['world.metric_changed'],
        condition: { eventHistory: 'evt_prev', check: 'occurred' },
      },
    });
    const stateWithHistory: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        history: [
          {
            eventId: 'evt_prev',
            instanceId: 'hist_1',
            finalStatus: 'resolved',
            triggeredAtDay: 50,
            completedAtDay: 60,
            sourceKey: 'src_key',
            chainInstanceId: null,
            titleSnapshot: 'Previous Event',
            chosenOptionId: null,
            chosenOptionLabel: null,
            appliedEffects: [],
          },
        ],
      },
    };
    const input = makeInput({ state: stateWithHistory, definitions: [def] });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
  });
});

describe('processDomainSignal - 重复控制', () => {
  it('once mode: first trigger creates instance, second gets repeat_blocked', () => {
    const def = makeEventDef({ repeatPolicy: { mode: 'once' } });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_once_1') });
    const result1 = processDomainSignal(input);
    expect(result1.createdInstances).toHaveLength(1);
    expect(result1.diagnostics.some((d) => d.type === 'instance_created')).toBe(true);

    const stateWithPending = {
      ...input.state,
      events: { ...input.state.events, pending: result1.createdInstances },
    };
    const result2 = processDomainSignal({
      ...input,
      state: stateWithPending,
      signal: makeSignal('sig_once_2'),
    });
    expect(result2.createdInstances).toHaveLength(0);
    expect(result2.diagnostics.some((d) => d.type === 'repeat_blocked')).toBe(true);
  });

  it('once_per_source: same source blocked, different source allowed', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'once_per_source' },
      trigger: { sources: ['action.completed'] },
    });
    const baseInput = makeInput({ definitions: [def] });

    const result1 = processDomainSignal({
      ...baseInput,
      signal: makeActionSignal('sig_ops1', 'action_A'),
    });
    expect(result1.createdInstances).toHaveLength(1);

    const stateWithPending = {
      ...baseInput.state,
      events: { ...baseInput.state.events, pending: result1.createdInstances },
    };
    // Same sourceKey
    const result2 = processDomainSignal({
      ...baseInput,
      state: stateWithPending,
      signal: makeActionSignal('sig_ops2', 'action_A'),
    });
    expect(result2.createdInstances).toHaveLength(0);
    expect(result2.diagnostics.some((d) => d.type === 'repeat_blocked')).toBe(true);

    // Different sourceKey
    const result3 = processDomainSignal({
      ...baseInput,
      signal: makeActionSignal('sig_ops3', 'action_B'),
    });
    expect(result3.createdInstances).toHaveLength(1);
  });

  it('repeatable: always fires subject to cooldown', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'repeatable' },
    });
    const input = makeInput({ definitions: [def] });
    const result1 = processDomainSignal({ ...input, signal: makeSignal('sig_rep_1') });
    const result2 = processDomainSignal({ ...input, signal: makeSignal('sig_rep_2') });
    expect(result1.createdInstances).toHaveLength(1);
    expect(result2.createdInstances).toHaveLength(1);
  });

  it('maxActivations: fires exactly N times then repeat_blocked', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'repeatable', maxActivations: 2 },
    });
    const input = makeInput({ definitions: [def] });

    const result1 = processDomainSignal({ ...input, signal: makeSignal('sig_max_1') });
    expect(result1.createdInstances).toHaveLength(1);

    const result2 = processDomainSignal({ ...input, signal: makeSignal('sig_max_2') });
    expect(result2.createdInstances).toHaveLength(1);

    // Third should be blocked (total = 2 created instances in current state)
    const stateWithAll = {
      ...input.state,
      events: {
        ...input.state.events,
        pending: [...result1.createdInstances, ...result2.createdInstances],
      },
    };
    const result3 = processDomainSignal({
      ...input,
      state: stateWithAll,
      signal: makeSignal('sig_max_3'),
    });
    expect(result3.createdInstances).toHaveLength(0);
    expect(result3.diagnostics.some((d) => d.type === 'repeat_blocked')).toBe(true);
  });

  it('pending instances count toward repeat check', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'repeatable', maxActivations: 1 },
    });
    const input = makeInput({ definitions: [def] });
    const result1 = processDomainSignal({ ...input, signal: makeSignal('sig_pend_1') });
    expect(result1.createdInstances).toHaveLength(1);

    const stateWithPending = {
      ...input.state,
      events: { ...input.state.events, pending: result1.createdInstances },
    };
    const result2 = processDomainSignal({
      ...input,
      state: stateWithPending,
      signal: makeSignal('sig_pend_2'),
    });
    expect(result2.createdInstances).toHaveLength(0);
    expect(result2.diagnostics.some((d) => d.type === 'repeat_blocked')).toBe(true);
  });

  it('history records count toward repeat check', () => {
    const def = makeEventDef({ repeatPolicy: { mode: 'once' } });
    const stateWithHistory: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        history: [
          {
            eventId: 'evt_test',
            instanceId: 'hist_1',
            finalStatus: 'resolved',
            triggeredAtDay: 50,
            completedAtDay: 60,
            sourceKey: '',
            chainInstanceId: null,
            titleSnapshot: 'Resolved Event',
            chosenOptionId: null,
            chosenOptionLabel: null,
            appliedEffects: [],
          },
        ],
      },
    };
    const input = makeInput({ state: stateWithHistory, definitions: [def] });
    const result = processDomainSignal({ ...input, signal: makeSignal('sig_hist_1') });
    expect(result.diagnostics.some((d) => d.type === 'repeat_blocked')).toBe(true);
    expect(result.createdInstances).toHaveLength(0);
  });

  it('scheduled instances count toward repeat check', () => {
    const def = makeEventDef({ repeatPolicy: { mode: 'once' } });
    const stateWithScheduled: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        scheduled: [
          {
            instanceId: 'sched_1',
            eventId: 'evt_test',
            scheduledAtDay: 90,
            activateAtDay: 110,
            triggerContext: makeSignal('sig_trig'),
            sourceKey: '',
            chainInstanceId: null,
            snapshot: createEventSnapshot(def),
          },
        ],
      },
    };
    const input = makeInput({ state: stateWithScheduled, definitions: [def] });
    const result = processDomainSignal({ ...input, signal: makeSignal('sig_sched_1') });
    expect(result.diagnostics.some((d) => d.type === 'repeat_blocked')).toBe(true);
    expect(result.createdInstances).toHaveLength(0);
  });
});

describe('processDomainSignal - 冷却', () => {
  it('automatic event instance goes to createdInstances for reducer handling', () => {
    // Auto events no longer auto-resolve in the orchestrator;
    // they are now handled by the reducer via handleAutoEventInstance.
    const def = makeEventDef({
      id: 'evt_cd_auto',
      presentation: 'automatic',
      repeatPolicy: { mode: 'repeatable', cooldownDays: 10 },
      automaticOutcome: { effects: [] },
      options: [],
    });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_cd_auto_1') });
    const result = processDomainSignal(input);
    // Auto events now appear in createdInstances, not autoResolvedHistory
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.eventId).toBe('evt_cd_auto');
    // Cooldowns are handled by the reducer for auto events
  });

  it('trigger during cooldown → cooldown_blocked diagnostic', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'repeatable', cooldownDays: 10 },
    });
    const stateWithCd: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        cooldowns: [{ eventId: 'evt_test', scope: 'global', scopeId: null, untilDay: 120 }],
      },
    };
    const input = makeInput({
      state: stateWithCd,
      definitions: [def],
      currentDay: 105,
      signal: makeSignal('sig_cd_blocked'),
    });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.type === 'cooldown_blocked')).toBe(true);
  });

  it('trigger after cooldown expires → instance created again', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'repeatable', cooldownDays: 10 },
    });
    const stateWithCd: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        cooldowns: [{ eventId: 'evt_test', scope: 'global', scopeId: null, untilDay: 100 }],
      },
    };
    const input = makeInput({
      state: stateWithCd,
      definitions: [def],
      currentDay: 105,
      signal: makeSignal('sig_cd_after'),
    });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
  });

  it('source-scope cooldown isolates different sourceKeys', () => {
    const def = makeEventDef({
      repeatPolicy: { mode: 'repeatable', cooldownDays: 10 },
      trigger: { sources: ['action.completed'] },
    });
    const stateWithCd: PlayerSave = {
      ...createInitialState(),
      events: {
        ...createInitialState().events,
        cooldowns: [{ eventId: 'evt_test', scope: 'source', scopeId: 'action_X', untilDay: 200 }],
      },
    };
    const input = makeInput({
      state: stateWithCd,
      definitions: [def],
    });
    // Same source → blocked
    const result1 = processDomainSignal({
      ...input,
      signal: makeActionSignal('sig_cds1', 'action_X'),
    });
    expect(result1.createdInstances).toHaveLength(0);
    expect(result1.diagnostics.some((d) => d.type === 'cooldown_blocked')).toBe(true);

    // Different source → allowed
    const result2 = processDomainSignal({
      ...input,
      signal: makeActionSignal('sig_cds2', 'action_Y'),
    });
    expect(result2.createdInstances).toHaveLength(1);
  });
});

describe('processDomainSignal - 概率', () => {
  it('probability = 0 → never fires', () => {
    const def = makeEventDef({
      trigger: { sources: ['world.metric_changed'], probability: 0 },
    });
    const input = makeInput({ definitions: [def] });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.type === 'probability_failed')).toBe(true);
  });

  it('probability = 1 → always fires', () => {
    const def = makeEventDef({
      trigger: { sources: ['world.metric_changed'], probability: 1 },
    });
    const input = makeInput({ definitions: [def] });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
  });

  it('rng returns 0.5, probability=0.6 → fires', () => {
    const def = makeEventDef({
      trigger: { sources: ['world.metric_changed'], probability: 0.6 },
    });
    const input = makeInput({ definitions: [def], rng: () => 0.5 });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
  });

  it('rng returns 0.5, probability=0.4 → does not fire', () => {
    const def = makeEventDef({
      trigger: { sources: ['world.metric_changed'], probability: 0.4 },
    });
    const input = makeInput({ definitions: [def], rng: () => 0.5 });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.type === 'probability_failed')).toBe(true);
  });

  it('default probability (undefined) → acts as 1', () => {
    const def = makeEventDef({
      trigger: { sources: ['world.metric_changed'] },
    });
    // No probability set
    const input = makeInput({ definitions: [def] });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
  });
});

describe('processDomainSignal - 互斥组', () => {
  it('two events in same mutexGroup → only one selected', () => {
    const defA = makeEventDef({ id: 'evt_mx_a', mutexGroup: 'mg_test' });
    const defB = makeEventDef({ id: 'evt_mx_b', mutexGroup: 'mg_test' });
    const input = makeInput({ definitions: [defA, defB] });
    const result = processDomainSignal(input);

    const createdIds = result.createdInstances.map((i) => i.eventId);
    expect(createdIds).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.type === 'mutex_not_selected')).toBe(true);
  });

  it('mutex_not_selected diagnostic for non-winner', () => {
    const defA = makeEventDef({ id: 'evt_mx_winner', mutexGroup: 'mg_winner' });
    const defB = makeEventDef({ id: 'evt_mx_loser', mutexGroup: 'mg_winner' });
    const input = makeInput({ definitions: [defA, defB] });
    const result = processDomainSignal(input);

    const winnerDiag = result.diagnostics.find((d) => d.type === 'instance_created');
    expect(winnerDiag).toBeDefined();
    const loserDiag = result.diagnostics.find((d) => d.type === 'mutex_not_selected');
    expect(loserDiag).toBeDefined();
  });

  it('events without mutexGroup all fire simultaneously', () => {
    const defA = makeEventDef({ id: 'evt_free_a' });
    const defB = makeEventDef({ id: 'evt_free_b' });
    const input = makeInput({ definitions: [defA, defB] });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(2);
  });

  it('weight affects selection: higher weight more likely', () => {
    const defLow = makeEventDef({
      id: 'evt_low_w',
      mutexGroup: 'mg_weight',
      trigger: { sources: ['world.metric_changed'], weight: 1 },
    });
    const defHigh = makeEventDef({
      id: 'evt_high_w',
      mutexGroup: 'mg_weight',
      trigger: { sources: ['world.metric_changed'], weight: 9 },
    });
    // rng=0.05: 0.05*10=0.5, subtract high(9)= -8.5 <= 0 → selects high
    const input = makeInput({
      definitions: [defHigh, defLow],
      rng: () => 0.05,
    });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.eventId).toBe('evt_high_w');
  });
});

describe('processDomainSignal - 实例创建', () => {
  it('instance has complete snapshot', () => {
    const def = makeEventDef({
      id: 'evt_detail',
      title: 'Detailed Event',
      description: 'With details',
    });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_detail') });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    const instance = result.createdInstances[0]!;
    expect(instance.eventId).toBe('evt_detail');
    expect(instance.snapshot.title).toBe('Detailed Event');
    expect(instance.snapshot.description).toBe('With details');
    expect(instance.snapshot.options).toHaveLength(1);
    expect(instance.snapshot.options[0]!.id).toBe('opt_a');
  });

  it('sourceKey correctly derived', () => {
    const def = makeEventDef({ trigger: { sources: ['action.completed'] } });
    const input = makeInput({
      definitions: [def],
      signal: makeActionSignal('sig_sk', 'action_sk_test'),
    });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.sourceKey).toBe('action_sk_test');
  });

  it('deadlineDay calculated correctly', () => {
    const def = makeEventDef({ activation: { deadlineDays: 14 } });
    const input = makeInput({ definitions: [def] });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    const instance = result.createdInstances[0]!;
    expect(instance.deadlineDay).toBe(instance.activatedAtDay + 14);
  });

  it('triggeredAtDay equals signal.occurredAtDay', () => {
    const def = makeEventDef({});
    const input = makeInput({
      definitions: [def],
      signal: makeSignal('sig_trigday', { occurredAtDay: 150 }),
    });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.triggeredAtDay).toBe(150);
  });

  it('instance_created diagnostic emitted', () => {
    const input = makeInput({ signal: makeSignal('sig_diag') });
    const result = processDomainSignal(input);
    expect(result.diagnostics.some((d) => d.type === 'instance_created')).toBe(true);
  });
});

describe('processDomainSignal - 自动事件', () => {
  it('presentation: automatic → goes to createdInstances for reducer handling', () => {
    const def = makeEventDef({
      id: 'evt_auto',
      presentation: 'automatic',
      automaticOutcome: { effects: [] },
      options: [],
    });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_auto') });
    const result = processDomainSignal(input);
    // Auto events now appear in createdInstances; reducer handles them
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.eventId).toBe('evt_auto');
    expect(result.createdInstances[0]!.status).toBe('pending');
  });

  it('automatic event instance created with correct metadata', () => {
    const def = makeEventDef({
      id: 'evt_auto_sig',
      presentation: 'automatic',
      automaticOutcome: { effects: [] },
      options: [],
    });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_auto_2') });
    const result = processDomainSignal(input);
    // Automatic events create instances with snapshot containing automaticOutcome
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.eventId).toBe('evt_auto_sig');
    expect(result.createdInstances[0]!.snapshot.presentation).toBe('automatic');
  });

  it('automaticOutcome effects available in instance snapshot', () => {
    const def = makeEventDef({
      id: 'evt_auto_eff',
      presentation: 'automatic',
      automaticOutcome: {
        effects: [{ target: 'character', field: 'vigor', operation: 'add', value: 10 }],
      },
      options: [],
    });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_auto_eff') });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    const instance = result.createdInstances[0]!;
    expect(instance.snapshot.automaticOutcome).toBeDefined();
    expect(instance.snapshot.automaticOutcome!.effects).toHaveLength(1);
    expect(instance.snapshot.automaticOutcome!.effects[0]).toMatchObject({
      target: 'character',
      field: 'vigor',
    });
  });

  it('automatic event with schedule is created as instance for reducer handling', () => {
    const defA = makeEventDef({
      id: 'evt_auto_sched',
      presentation: 'automatic',
      automaticOutcome: {
        effects: [],
        schedule: [{ eventId: 'evt_follow', delayDays: 5 }],
      },
      options: [],
    });
    const defFollow = makeEventDef({
      id: 'evt_follow',
      trigger: { sources: ['event.resolved'] },
    });
    const input = makeInput({
      definitions: [defA, defFollow],
      signal: makeSignal('sig_auto_sched'),
    });
    const result = processDomainSignal(input);
    // Auto events go to createdInstances; reducer handles scheduling
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.eventId).toBe('evt_auto_sched');
    expect(result.createdInstances[0]!.snapshot.automaticOutcome).toBeDefined();
    expect(result.createdInstances[0]!.snapshot.automaticOutcome!.schedule).toHaveLength(1);
  });
});

describe('processDomainSignal - 延迟事件', () => {
  it('delayDays > 0 → creates ScheduledEventInstance', () => {
    const def = makeEventDef({ activation: { delayDays: 3 } });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_delay') });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(0);
    expect(result.scheduledInstances).toHaveLength(1);
    expect(result.scheduledInstances[0]!.activateAtDay).toBe(103);
  });

  it('delayRange → random delay within range', () => {
    const def = makeEventDef({ activation: { delayRange: { min: 2, max: 5 } } });
    // rng=0.0 → min offset; rng=0.999 → max offset
    const input = makeInput({
      definitions: [def],
      rng: () => 0.0,
      signal: makeSignal('sig_range'),
    });
    const result = processDomainSignal(input);
    expect(result.scheduledInstances).toHaveLength(1);
    expect(result.scheduledInstances[0]!.activateAtDay).toBe(102); // 100 + 2
  });

  it('no delay → creates EventInstance immediately', () => {
    const def = makeEventDef({ activation: {} });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_nodelay') });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    expect(result.scheduledInstances).toHaveLength(0);
  });

  it('blocking event without delay gets active status', () => {
    const def = makeEventDef({ presentation: 'blocking', activation: {} });
    const input = makeInput({ definitions: [def], signal: makeSignal('sig_block') });
    const result = processDomainSignal(input);
    expect(result.createdInstances).toHaveLength(1);
    expect(result.createdInstances[0]!.status).toBe('active');
  });
});

describe('processDomainSignal - 级联信号', () => {
  it('signal depth limit prevents infinite loops', () => {
    // Create a definition that triggers on event.resolved and itself produces an event.resolved
    // With an automatic event this could cascade
    const def = makeEventDef({
      id: 'evt_cascade',
      presentation: 'automatic',
      automaticOutcome: { effects: [] },
      options: [],
      trigger: { sources: ['event.resolved'] },
    });
    const input = makeInput({
      definitions: [def],
      signal: {
        signalId: 'sig_cascade_seed',
        signalType: 'event.resolved',
        occurredAtDay: 100,
        data: { eventInstanceId: 'seed', eventId: 'evt_seed', optionId: null, occurredAtDay: 100 },
      },
    });
    // Should not hang; should produce some results
    const result = processDomainSignal(input);
    expect(result.createdInstances.length).toBeGreaterThan(0);
    // Depth limit is MAX_SIGNAL_DEPTH=16 (0..16 = 17 iterations)
    // but MAX_SIGNALS_PER_TRANSACTION=100 bounds the total
    expect(result.createdInstances.length).toBeLessThanOrEqual(100);
  });
});
