/** Vacancy 年度 producer 的真实 Store 时间轴与存档恢复测试。 */

import { describe, expect, it, vi } from 'vitest';
import type { EventDefinition } from '../../domain/events/definition';
import { getConfigLoader } from '../../config/loader';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';
import { createInitialState, createTestStore } from '../game-store';

function stateWithDeparture() {
  const state = createInitialState();
  const cadre = state.organization.cadres.find((item) => item.currentAppointment);
  if (!cadre?.currentAppointment) throw new Error('Expected assigned NPC');
  const experience = cadre.experiences.find((item) => item.endedAtDay === null);
  const seat = state.organization.seats.find(
    (item) => item.occupant?.type === 'npc' && item.occupant.id === cadre.cadreId,
  );
  if (!experience || !seat) throw new Error('Expected NPC experience and Seat');
  const appointment = cadre.currentAppointment;
  experience.endedAtDay = 360;
  experience.endReason = 'retirement';
  cadre.currentAppointment = null;
  cadre.status = 'retired';
  cadre.exitedAtDay = 360;
  cadre.exitReason = 'retirement';
  seat.occupant = null;
  seat.currentAppointmentId = null;
  seat.occupiedAtDay = null;
  state.organization.departures.push({
    departureId: `departure:${cadre.cadreId}:${appointment.appointmentId}:360`,
    cadreId: cadre.cadreId,
    appointmentId: appointment.appointmentId,
    experienceId: experience.id,
    seatId: seat.seatId,
    positionId: seat.positionId,
    institutionId: seat.institutionId,
    regionId: seat.regionId,
    occurredAtDay: 360,
    reason: 'retirement',
    sourceType: 'cadre_lifecycle',
  });
  const config = getConfigLoader().getGameConfig();
  state.career.appointment.probation = null;
  state.time = {
    year: config.startYear,
    month: config.monthsPerYear,
    day: config.daysPerMonth,
    granularity: 'day',
    totalDaysPlayed: 359,
    pendingContinuation: null,
  };
  return state;
}

describe('Vacancy annual Store producer', () => {
  it('年度事实完成后消费 departure，创建 Vacancy 并在刷新后保持幂等', () => {
    const store = createTestStore(stateWithDeparture());
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _idFactory: () => 'store-vacancy-id',
    });

    const first = store.getRawState();
    expect(first.time.totalDaysPlayed).toBe(360);
    const initialVacancyCount =
      first.organization.seats.filter((seat) => seat.occupant === null).length - 1;
    expect(first.organization.vacancies).toHaveLength(initialVacancyCount + 1);
    expect(first.organization.processedProducerKeys).toContain('npc-annual:2012');
    expect(first.organization.processedProducerKeys).toContain(
      `vacancy:cadre_lifecycle:${first.organization.departures[0]?.departureId}`,
    );
    expect(first.events.pending.some((event) => event.eventId === 'flood_emergency')).toBe(false);

    const encoded = JSON.stringify(wrapSaveEnvelope(first));
    const decoded = decodeCurrentSave(encoded);
    expect(decoded.success).toBe(true);
    if (!decoded.success || !decoded.state) return;
    const resumed = createTestStore(decoded.state);
    resumed.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _idFactory: () => 'retry-id' });
    const second = resumed.getRawState();
    expect(second.organization.vacancies).toEqual(first.organization.vacancies);
    expect(second.organization.processedProducerKeys).toEqual(
      first.organization.processedProducerKeys,
    );
  });

  it('Vacancy opened blocker 后恢复时不重复生产年度事实', () => {
    const loader = getConfigLoader();
    const blocker: EventDefinition = {
      id: 'vacancy-opened-blocker-test',
      chainId: null,
      nodeId: null,
      title: 'Vacancy blocker',
      description: '',
      category: 'governance',
      priority: 'urgent',
      presentation: 'blocking',
      trigger: { sources: ['vacancy.opened'], probability: 1 },
      repeatPolicy: { mode: 'once_per_source' },
      activation: {},
      options: [{ id: 'ack', label: '确认', description: '', effects: [] }],
    };
    vi.spyOn(loader, 'getAllEventDefinitions').mockReturnValue([
      ...loader.getAllEventDefinitions(),
      blocker,
    ]);
    const store = createTestStore(stateWithDeparture());
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _idFactory: () => 'blocker-id' });
    const blocked = store.getRawState();
    expect(blocked.organization.vacancies.length).toBeGreaterThan(1);
    expect(blocked.time.pendingContinuation).not.toBeNull();
    const blockerInstance = blocked.events.pending.find((item) => item.eventId === blocker.id);
    if (!blockerInstance) throw new Error('Expected Vacancy blocker');

    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: blockerInstance.instanceId,
      optionId: 'ack',
      _idFactory: () => 'blocker-ack',
    });
    store.dispatch({ type: 'ADVANCE_TIME', granularity: 'day', _idFactory: () => 'retry-id' });
    const resumed = store.getRawState();
    expect(resumed.organization.vacancies.length).toBeGreaterThan(1);
    expect(resumed.organization.processedProducerKeys).toContain(
      `vacancy:cadre_lifecycle:${resumed.organization.departures[0]?.departureId}`,
    );
  });
});
