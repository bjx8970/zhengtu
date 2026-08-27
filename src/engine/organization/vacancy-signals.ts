/**
 * Vacancy 生命周期领域信号构造器。
 *
 * 信号只从已提交的 Vacancy 快照构造，保证下游机会编排看到的是同一组
 * 身份与审计字段，而不会重新读取 Store 或组织配置。
 */

import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { VacancyInstance } from '../../types/organization';

/**
 * 构造 Vacancy 开放信号。
 *
 * @param vacancy 已创建的 Vacancy 快照
 * @returns vacancy.opened 领域信号
 */
export function openedSignal(vacancy: VacancyInstance): DomainSignalSnapshot {
  return {
    signalId: `signal:${vacancy.vacancyId}:opened`,
    signalType: 'vacancy.opened',
    occurredAtDay: vacancy.openedAtDay,
    data: {
      vacancyId: vacancy.vacancyId,
      seatId: vacancy.seatId,
      positionId: vacancy.positionId,
      institutionId: vacancy.institutionId,
      regionId: vacancy.regionId,
      reason: vacancy.reason,
    },
  };
}

/**
 * 构造 Vacancy 填补信号。
 *
 * @param vacancy 已填补的 Vacancy 快照
 * @returns vacancy.filled 领域信号
 * @throws 当 Vacancy 缺少不可变填补快照时抛出一致性错误
 */
export function filledSignal(vacancy: VacancyInstance): DomainSignalSnapshot {
  const occupant = vacancy.filledBy;
  if (!occupant || !vacancy.filledAppointmentId)
    throw new Error(`Filled Vacancy ${vacancy.vacancyId} has no occupant snapshot`);
  return {
    signalId: `signal:${vacancy.vacancyId}:filled`,
    signalType: 'vacancy.filled',
    occurredAtDay: vacancy.closedAtDay ?? vacancy.openedAtDay,
    data: {
      vacancyId: vacancy.vacancyId,
      seatId: vacancy.seatId,
      positionId: vacancy.positionId,
      institutionId: vacancy.institutionId,
      regionId: vacancy.regionId,
      selectionId: vacancy.selectionId,
      occupantType: occupant.type,
      occupantId: occupant.id,
    },
  };
}

/**
 * 构造 Vacancy 取消/过期信号。
 *
 * @param vacancy 已进入取消或过期终态的 Vacancy 快照
 * @returns vacancy.cancelled 领域信号
 * @throws 当 Vacancy 缺少取消原因时抛出一致性错误
 */
export function cancelledSignal(vacancy: VacancyInstance): DomainSignalSnapshot {
  if (!vacancy.cancellationReason)
    throw new Error(`Cancelled Vacancy ${vacancy.vacancyId} has no cancellation reason`);
  return {
    signalId: `signal:${vacancy.vacancyId}:cancelled`,
    signalType: 'vacancy.cancelled',
    occurredAtDay: vacancy.closedAtDay ?? vacancy.openedAtDay,
    data: {
      vacancyId: vacancy.vacancyId,
      seatId: vacancy.seatId,
      positionId: vacancy.positionId,
      institutionId: vacancy.institutionId,
      regionId: vacancy.regionId,
      cancellationReason: vacancy.cancellationReason,
    },
  };
}
