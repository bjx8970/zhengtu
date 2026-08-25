/** NPC 任职关闭与不可变离任事实构建辅助。 */

import type { CadreDepartureFact, CadreProfile, OrganizationState } from '../../types/organization';

/**
 * 原子关闭 NPC 当前任职、履历与 Seat，并建立供 Vacancy producer 消费的事实。
 *
 * @param organization 结算副本中的组织状态
 * @param cadre 待关闭的干部
 * @param currentDay 离任绝对日
 * @param reason 离任原因
 * @returns 追加到离任账本的不可变事实
 */
export function closeNpcAppointment(
  organization: OrganizationState,
  cadre: CadreProfile,
  currentDay: number,
  reason: CadreDepartureFact['reason'],
): CadreDepartureFact {
  const appointment = cadre.currentAppointment;
  if (!appointment) throw new Error(`Cannot close NPC ${cadre.cadreId} without appointment`);
  const experience = cadre.experiences.find(
    (item) => item.appointmentId === appointment.appointmentId && item.endedAtDay === null,
  );
  const seat = organization.seats.find(
    (item) =>
      item.occupant?.type === 'npc' &&
      item.occupant.id === cadre.cadreId &&
      item.currentAppointmentId === appointment.appointmentId,
  );
  if (!experience || !seat)
    throw new Error(`Cannot close inconsistent NPC appointment ${appointment.appointmentId}`);
  experience.endedAtDay = currentDay;
  experience.endReason = reason;
  cadre.currentAppointment = null;
  cadre.status = reason === 'retirement' ? 'retired' : 'exited';
  cadre.exitedAtDay = currentDay;
  cadre.exitReason = reason;
  seat.occupant = null;
  seat.currentAppointmentId = null;
  seat.occupiedAtDay = null;
  seat.sourceTransitionId = appointment.appointmentId;
  return {
    departureId: `departure:${cadre.cadreId}:${appointment.appointmentId}`,
    cadreId: cadre.cadreId,
    appointmentId: appointment.appointmentId,
    experienceId: experience.id,
    seatId: seat.seatId,
    positionId: appointment.positionId,
    institutionId: appointment.institutionId,
    regionId: appointment.regionId,
    occurredAtDay: currentDay,
    reason,
    sourceType: 'cadre_lifecycle',
  };
}
