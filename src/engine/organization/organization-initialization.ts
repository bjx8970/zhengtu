/**
 * 组织世界的确定性初始化。
 *
 * 配置、玩家当前任职和初始化日全部由调用方传入；本模块不访问 Store、DOM
 * 或 ConfigLoader，保证新游戏与存档迁移可复用同一纯函数。
 */

import type { CurrentAppointment } from '../../domain/career/state';
import type {
  OrganizationInitializationInput,
  OrganizationSeat,
  OrganizationState,
} from '../../types/organization';

function seatId(positionId: string, ordinal: number): string {
  return `seat:${positionId}:${ordinal}`;
}

/**
 * 确定性建立有限干部、席位和空的运行时流程集合。
 *
 * @param input 初始化日、玩家任职与配置目录
 * @returns 引用完整、可直接持久化的组织世界状态
 */
export function createOrganizationState(input: OrganizationInitializationInput): OrganizationState {
  const positions = new Map(input.positions.map((position) => [position.id, position]));
  const institutions = new Map(
    input.institutions.map((institution) => [institution.id, institution]),
  );
  const relevantPositionIds = new Set(input.cadreTemplates.map((template) => template.positionId));
  relevantPositionIds.add(input.playerAppointment.positionId);

  const seats: OrganizationSeat[] = [];
  for (const positionId of relevantPositionIds) {
    const position = positions.get(positionId);
    if (!position)
      throw new Error(`Organization initialization references unknown position ${positionId}`);
    const institution = institutions.get(position.institutionId);
    if (!institution)
      throw new Error(
        `Organization initialization references unknown institution ${position.institutionId}`,
      );
    for (let ordinal = 1; ordinal <= position.vacancyCount; ordinal += 1) {
      seats.push({
        seatId: seatId(position.id, ordinal),
        positionId: position.id,
        positionNameSnapshot: position.name,
        institutionId: institution.id,
        institutionNameSnapshot: institution.name,
        regionId: position.regionId,
        institutionLevel: position.institutionLevel,
        positionDomain: position.positionDomain,
        leadershipRank: position.leadershipRank,
        occupant: null,
        currentAppointmentId: null,
        occupiedAtDay: null,
        sourceTransitionId: null,
      });
    }
  }

  const playerSeat = seats.find((seat) => seat.positionId === input.playerAppointment.positionId);
  if (!playerSeat) throw new Error('Player appointment has no configured organization seat');
  if (input.playerAppointment.status === 'active') {
    playerSeat.occupant = { type: 'player', id: 'player' };
    playerSeat.currentAppointmentId = input.playerAppointment.appointmentId;
    playerSeat.occupiedAtDay = input.playerAppointment.startedAtDay;
  }

  const cadres = input.cadreTemplates.map((template) => {
    const targetSeat = template.initiallyUnassigned
      ? undefined
      : seats.find((seat) => seat.positionId === template.positionId && seat.occupant === null);
    const position = positions.get(template.positionId);
    if (!position) throw new Error(`Cadre ${template.cadreId} references unknown position`);
    const institution = institutions.get(position.institutionId);
    if (!institution) throw new Error(`Cadre ${template.cadreId} references unknown institution`);
    const appointmentId = `npc-appointment:${template.cadreId}:${input.initializedAtDay}`;
    const currentAppointment: CurrentAppointment | null = targetSeat
      ? {
          appointmentId,
          positionId: position.id,
          institutionId: position.institutionId,
          regionId: position.regionId,
          institutionLevel: position.institutionLevel,
          positionDomain: position.positionDomain,
          leadershipRank: position.leadershipRank,
          startedAtDay: input.initializedAtDay,
          appointmentType: 'substantive',
          appointmentReason: 'initial_assignment',
          sourceOpportunityId: null,
          status: 'active',
          endedAtDay: null,
          endReason: null,
          probation: null,
        }
      : null;
    if (targetSeat && currentAppointment) {
      targetSeat.occupant = { type: 'npc', id: template.cadreId };
      targetSeat.currentAppointmentId = currentAppointment.appointmentId;
      targetSeat.occupiedAtDay = currentAppointment.startedAtDay;
    }
    return {
      cadreId: template.cadreId,
      name: template.name,
      gender: template.gender,
      birthYear: template.birthYear,
      civilServiceRank: template.civilServiceRank,
      civilServiceRankStartedAtDay: input.initializedAtDay,
      currentAppointment,
      experiences:
        currentAppointment === null
          ? []
          : [
              {
                id: `npc-experience:${template.cadreId}:${input.initializedAtDay}`,
                appointmentId,
                positionId: position.id,
                positionNameSnapshot: position.name,
                institutionId: institution.id,
                institutionNameSnapshot: institution.name,
                institutionLevel: position.institutionLevel,
                regionId: position.regionId,
                positionDomain: position.positionDomain,
                leadershipRank: position.leadershipRank,
                startedAtDay: input.initializedAtDay,
                endedAtDay: null,
                appointmentReason: 'initial_assignment' as const,
                appointmentType: 'substantive' as const,
                sourceOpportunityId: null,
                endReason: null,
                assessmentResults: [],
              },
            ],
      assessments: [],
      specialties: structuredClone(template.specialties),
      restrictions: [],
      status: 'active' as const,
      exitedAtDay: null,
      exitReason: null,
    };
  });

  return {
    initializedAtDay: input.initializedAtDay,
    cadres,
    seats,
    vacancies: [],
    selections: [],
    departures: [],
    processedProducerKeys: [],
  };
}
