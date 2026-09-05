/** 政治周期阶段、届期评估与 producer 幂等测试。 */

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../store/game-store';
import {
  advancePoliticalCycles,
  createPoliticalCycle,
  producePoliticalCycleVacancies,
} from '../political-cycle';

describe('political cycle engine', () => {
  it('advances phases monotonically and reports evaluation at the term end', () => {
    const world = {
      facts: {},
      metrics: {},
      activeCycles: [createPoliticalCycle('party_congress', 1, 100, 500)],
    };
    const durations = {
      preparation: 10,
      session: 10,
      implementation: 300,
      evaluation: 80,
    };

    const session = advancePoliticalCycles(world, 120, durations);
    expect(session.world.activeCycles[0]?.phase).toBe('implementation');
    expect(session.evaluations[0]?.completed).toBe(false);

    const ended = advancePoliticalCycles(session.world, 500, durations);
    expect(ended.world.activeCycles[0]?.phase).toBe('evaluation');
    expect(ended.evaluations[0]).toMatchObject({
      completed: true,
      evaluatedAtDay: 500,
    });
    expect(world.activeCycles[0]?.phase).toBe('preparation');
  });

  it('produces a cycle vacancy once and replays it idempotently', () => {
    const save = createInitialState();
    const seat = save.organization.seats.find((candidate) => candidate.occupant === null);
    if (!seat) throw new Error('Expected an empty organization seat');
    save.organization.vacancies = save.organization.vacancies.filter(
      (vacancy) => vacancy.seatId !== seat.seatId,
    );
    const cycle = createPoliticalCycle('party_congress', 1, 0, 100);
    const first = producePoliticalCycleVacancies({
      organization: save.organization,
      cycle,
      seatIds: [seat.seatId],
      idFactory: () => 'cycle-producer-id',
    });
    expect(first.success).toBe(true);
    if (!first.success) return;
    const replay = producePoliticalCycleVacancies({
      organization: first.organization,
      cycle,
      seatIds: [seat.seatId],
      idFactory: () => 'must-not-be-used',
    });
    expect(replay.success).toBe(true);
    if (!replay.success) return;
    expect(replay.emittedSignals).toHaveLength(0);
    expect(replay.organization.vacancies).toHaveLength(first.organization.vacancies.length);
  });
});
