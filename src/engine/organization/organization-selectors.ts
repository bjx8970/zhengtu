/**
 * 组织世界的只读派生查询。
 */

import type { OrganizationState } from '../../types/organization';

/**
 * 判断职位是否至少有一个可落位的实际空 Seat。
 *
 * @param organization 组织世界状态
 * @param positionId 目标职位 ID
 * @returns 存在未被玩家或 NPC 占据的 Seat 时返回 true
 */
export function hasVacantOrganizationSeat(
  organization: Readonly<OrganizationState>,
  positionId: string,
): boolean {
  return organization.seats.some(
    (seat) => seat.positionId === positionId && seat.occupant === null,
  );
}
