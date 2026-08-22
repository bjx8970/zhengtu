/** Phase 3 正常玩家路径的 Store 场景骨架：建档、任务、年度结算与转正。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../config/loader';
import type { GameAction } from '../../types/game';
import { createTestStore } from '../game-store';

type TestStore = ReturnType<typeof createTestStore>;

function createIdFactory(): () => string {
  let nextId = 0;
  return () => `phase3-scenario-${nextId++}`;
}

function resolveBlockingEvents(store: TestStore, idFactory: () => string): void {
  const loader = getConfigLoader();
  while (store.getRawState().events.activeBlockingEventId) {
    const state = store.getRawState();
    const instance = state.events.pending.find(
      (item) => item.instanceId === state.events.activeBlockingEventId,
    );
    if (!instance) throw new Error('Active blocking event is missing from pending events');
    const definition = loader.getEventDefinition(instance.eventId);
    const option = definition?.options[0];
    if (!option) throw new Error(`Blocking event ${instance.eventId} has no playable option`);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: instance.instanceId,
      optionId: option.id,
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
  }
}

function advanceToDay(store: TestStore, targetDay: number, idFactory: () => string): void {
  while (store.getRawState().time.totalDaysPlayed < targetDay) {
    resolveBlockingEvents(store, idFactory);
    const remaining = targetDay - store.getRawState().time.totalDaysPlayed;
    const granularity: Extract<GameAction, { type: 'ADVANCE_TIME' }>['granularity'] =
      remaining >= 30 ? 'month' : remaining >= 7 ? 'week' : 'day';
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity,
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
  }
  resolveBlockingEvents(store, idFactory);
}

describe('Phase 3 reachability foundation', () => {
  it('reaches annual assessment and probation through public Store actions only', () => {
    const loader = getConfigLoader();
    const acceptance = loader.getPhase3AcceptanceConfig();
    const idFactory = createIdFactory();
    const store = createTestStore();
    store.dispatch({
      type: 'NEW_GAME',
      data: {
        characterName: '可达性测试员',
        familyBackground: 'peasant',
        promotionPath: 'gongwuyuan',
      },
    });

    const initial = store.getRawState();
    expect(initial.career.appointment.positionId).toBe(acceptance.stagePositionIds.clerk);
    const annualBudget = loader.getPositionById(
      initial.career.appointment.positionId,
    )?.annualBudget;
    expect(annualBudget).toBe(800);

    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_induction_training',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    expect(store.getRawState().remainingBudget).toBe(785);

    advanceToDay(store, 30, idFactory);
    expect(store.getRawState().remainingBudget).toBe(785);
    expect(
      Object.values(store.getRawState().actions.departmentStates).every(
        (department) =>
          department.monthlyConsumption === 0 && department.cumulativeConsumption === 0,
      ),
    ).toBe(true);

    advanceToDay(store, 180, idFactory);
    expect(store.getRawState().assessments.annualAssessments).toHaveLength(1);
    expect(store.getRawState().remainingBudget).toBe(annualBudget);
    expect(
      Object.values(store.getRawState().actions.departmentStates).every(
        (department) =>
          department.monthlyConsumption === 0 && department.cumulativeConsumption === 0,
      ),
    ).toBe(true);

    advanceToDay(store, acceptance.milestones.probationPassed.minDay, idFactory);
    expect(store.getRawState().career.appointment.probation).toMatchObject({
      status: 'passed',
      resolvedAtDay: acceptance.milestones.probationPassed.minDay,
      completedActionCount: 1,
    });
  });
});
