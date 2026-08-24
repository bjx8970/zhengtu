/**
 * 玩家任职事实与组织 Seat 占用的原子事务辅助函数。
 *
 * Phase 4 后续 Vacancy 事务会扩展离任后的 producer；本模块先保证任何既有
 * 玩家任职变化都不会让 Schema 11 的 CareerState 与 Seat occupant 漂移。
 */

import type { CurrentAppointment } from '../../domain/career/state';
import type { OrganizationState } from '../../types/organization';

/**
 * 将玩家从旧任职 Seat 移动到新任职 Seat。
 *
 * @param organization 待提交事务副本中的组织状态
 * @param previousAppointmentId 变更前的玩家任职 ID
 * @param nextAppointment 已完成资格复核的新任职
 * @returns 找到唯一旧席位和空目标席位时返回 true
 */
export function transitionPlayerSeat(
  organization: OrganizationState,
  previousAppointmentId: string,
  nextAppointment: CurrentAppointment,
): boolean {
  const previousSeat = organization.seats.find(
    (seat) =>
      seat.occupant?.type === 'player' && seat.currentAppointmentId === previousAppointmentId,
  );
  const targetSeat = organization.seats.find(
    (seat) => seat.positionId === nextAppointment.positionId && seat.occupant === null,
  );
  if (!previousSeat || !targetSeat || nextAppointment.status !== 'active') return false;
  previousSeat.occupant = null;
  previousSeat.currentAppointmentId = null;
  previousSeat.occupiedAtDay = null;
  previousSeat.sourceTransitionId = nextAppointment.appointmentId;
  targetSeat.occupant = { type: 'player', id: 'player' };
  targetSeat.currentAppointmentId = nextAppointment.appointmentId;
  targetSeat.occupiedAtDay = nextAppointment.startedAtDay;
  targetSeat.sourceTransitionId = nextAppointment.appointmentId;
  return true;
}

/**
 * 在玩家职业阶段结束时释放其实际 Seat。
 *
 * @param organization 待提交事务副本中的组织状态
 * @param appointmentId 正在结束的玩家任职 ID
 * @returns 成功找到并释放唯一玩家席位时返回 true
 */
export function releasePlayerSeat(organization: OrganizationState, appointmentId: string): boolean {
  const seat = organization.seats.find(
    (candidate) =>
      candidate.occupant?.type === 'player' && candidate.currentAppointmentId === appointmentId,
  );
  if (!seat) return false;
  seat.occupant = null;
  seat.currentAppointmentId = null;
  seat.occupiedAtDay = null;
  seat.sourceTransitionId = appointmentId;
  return true;
}
