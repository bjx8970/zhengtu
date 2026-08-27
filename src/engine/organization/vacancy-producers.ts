/**
 * 组织 Vacancy producer 的纯 Engine。
 *
 * 当前只消费 NPC 离任账本；将来玩家调任、政治周期等 producer 可复用同一套
 * stable key、Seat 校验和幂等规则，而不把 Store 副作用引入组织 Engine。
 */

import type {
  CadreDepartureFact,
  OrganizationState,
  VacancyLifecycleResult,
} from '../../types/organization';
import { openVacancy } from './vacancy-lifecycle';
import type { DomainSignalSnapshot } from '../../domain/governance/types';

/**
 * 生成 NPC 离任 producer 的稳定幂等键。
 *
 * @param departureId 离任事实身份
 * @returns producer 幂等键
 */
export function cadreDepartureVacancyKey(departureId: string): string {
  return `vacancy:cadre_lifecycle:${departureId}`;
}

/**
 * 生成 NPC 离任 producer 的稳定 Vacancy 身份。
 *
 * @param departureId 离任事实身份
 * @returns Vacancy 身份
 */
export function cadreDepartureVacancyId(departureId: string): string {
  return `vacancy:${departureId}`;
}

function departureEquivalent(
  organization: OrganizationState,
  vacancy: OrganizationState['vacancies'][number],
  departure: CadreDepartureFact,
): boolean {
  const seat = departure.seatId
    ? organization.seats.find((item) => item.seatId === departure.seatId)
    : undefined;
  if (!seat) return false;
  return (
    vacancy.vacancyId === cadreDepartureVacancyId(departure.departureId) &&
    vacancy.seatId === departure.seatId &&
    vacancy.positionId === departure.positionId &&
    vacancy.positionNameSnapshot === seat.positionNameSnapshot &&
    vacancy.institutionId === departure.institutionId &&
    vacancy.institutionNameSnapshot === seat.institutionNameSnapshot &&
    vacancy.regionId === departure.regionId &&
    vacancy.institutionLevel === seat.institutionLevel &&
    vacancy.positionDomain === seat.positionDomain &&
    vacancy.leadershipRank === seat.leadershipRank &&
    vacancy.openedAtDay === departure.occurredAtDay &&
    vacancy.reason === departure.reason &&
    vacancy.sourceType === 'cadre_lifecycle' &&
    vacancy.sourceId === departure.departureId
  );
}

function failure(error: 'producer_conflict' | 'seat_not_found' | 'seat_occupied', detail: string) {
  return { success: false as const, error, detail };
}

/**
 * 消费全部 NPC 离任事实并打开对应 Seat 的 Vacancy。
 *
 * @param input 待读取的组织世界快照与稳定 ID 工厂
 * @returns 更新后的组织、最后处理的 Vacancy（无 Seat 时为 null）和 opened 信号
 */
export function produceCadreDepartureVacancies(input: {
  organization: Readonly<OrganizationState>;
  idFactory: () => string;
}): VacancyLifecycleResult {
  const departures = [...input.organization.departures].sort(
    (left, right) =>
      left.occurredAtDay - right.occurredAtDay || left.departureId.localeCompare(right.departureId),
  );
  let organization = structuredClone(input.organization);
  let latestVacancy: OrganizationState['vacancies'][number] | null = null;
  const emittedSignals: DomainSignalSnapshot[] = [];

  for (const departure of departures) {
    const key = cadreDepartureVacancyKey(departure.departureId);
    const existing = organization.vacancies.find(
      (vacancy) => vacancy.vacancyId === cadreDepartureVacancyId(departure.departureId),
    );
    if (organization.processedProducerKeys.includes(key)) {
      if (
        (departure.seatId !== null &&
          (!existing || !departureEquivalent(organization, existing, departure))) ||
        (departure.seatId === null && existing)
      )
        return failure(
          'producer_conflict',
          `Processed producer ${key} does not match its departure Vacancy`,
        );
      continue;
    }

    if (departure.seatId === null) {
      if (existing)
        return failure(
          'producer_conflict',
          `Unassigned departure ${departure.departureId} has a Vacancy`,
        );
      organization.processedProducerKeys.push(key);
      continue;
    }
    if (existing) {
      if (!departureEquivalent(organization, existing, departure))
        return failure(
          'producer_conflict',
          `Departure ${departure.departureId} conflicts with its existing Vacancy`,
        );
      const seat = organization.seats.find((item) => item.seatId === departure.seatId);
      if (
        !seat ||
        seat.occupant !== null ||
        seat.currentAppointmentId !== null ||
        seat.occupiedAtDay !== null
      )
        return failure(
          'producer_conflict',
          `Departure ${departure.departureId} cannot recover a Vacancy from an occupied Seat`,
        );
      const activeVacancies = organization.vacancies.filter(
        (item) =>
          item.seatId === departure.seatId &&
          (item.status === 'open' || item.status === 'selecting'),
      );
      if (activeVacancies.length !== 1 || activeVacancies[0]?.vacancyId !== existing.vacancyId)
        return failure(
          'producer_conflict',
          `Departure ${departure.departureId} does not identify one active Vacancy`,
        );
      organization.processedProducerKeys.push(key);
      latestVacancy = existing;
      continue;
    }
    const seat = organization.seats.find((item) => item.seatId === departure.seatId);
    if (!seat)
      return failure('seat_not_found', `Departure references missing Seat ${departure.seatId}`);
    if (seat.occupant !== null || seat.currentAppointmentId !== null || seat.occupiedAtDay !== null)
      return failure('seat_occupied', `Departure Seat ${departure.seatId} is not empty`);
    const result = openVacancy({
      organization,
      currentDay: departure.occurredAtDay,
      idFactory: input.idFactory,
      seatId: departure.seatId,
      reason: departure.reason,
      sourceType: 'cadre_lifecycle',
      sourceId: departure.departureId,
      closesAtDay: null,
      vacancyId: cadreDepartureVacancyId(departure.departureId),
    });
    if (!result.success) return result;
    organization = result.organization;
    latestVacancy = result.vacancy;
    emittedSignals.push(...result.emittedSignals);
    organization.processedProducerKeys.push(key);
  }

  return {
    success: true,
    organization,
    vacancy: latestVacancy,
    emittedSignals,
  };
}

/**
 * 处理离任账本 Vacancy producer 的通用名称别名。
 *
 * @param input 组织世界快照与稳定 ID 工厂
 * @returns Vacancy producer 处理结果
 */
export function produceVacanciesFromDepartures(input: {
  organization: Readonly<OrganizationState>;
  idFactory: () => string;
}): VacancyLifecycleResult {
  return produceCadreDepartureVacancies(input);
}
