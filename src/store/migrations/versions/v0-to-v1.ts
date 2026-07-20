/**
 * v0 → v1 存档迁移
 *
 * 将无版本号的旧存档（v3 原型）迁移到 v4 版本化存档格式。
 * 主要变更：
 * - 删除玩家级临时字段 _pendingDeviationMultiplier 和 pendingStyleConflict
 * - 为 SlotOccupant 补充 runtimeSnapshot（默认无偏离）
 * - 补齐 actionCooldownUntilDays 字段
 */

import type { MigrationFn } from '../../../types/save';

/**
 * v0 → v1 迁移函数
 *
 * @param state 旧版存档状态（无 schemaVersion）
 * @returns 迁移后的状态
 */
export const migrateV0ToV1: MigrationFn = (state) => {
  const result = { ...state };

  // 删除已废弃的玩家级临时字段
  delete result._pendingDeviationMultiplier;
  delete result.pendingStyleConflict;

  // 为所有槽位中的行动补充 runtimeSnapshot
  const slots = result.slots as Record<string, { occupants: unknown[] }> | undefined;
  if (slots) {
    for (const tierKey of ['primary', 'secondary', 'reserve'] as const) {
      const tier = slots[tierKey];
      if (!tier?.occupants) continue;
      for (let i = 0; i < tier.occupants.length; i++) {
        const occupant = tier.occupants[i] as Record<string, unknown> | null;
        if (occupant && !occupant.runtimeSnapshot) {
          // 旧存档中的行动默认无偏离
          occupant.runtimeSnapshot = {
            effectivenessMultiplier: 1,
            styleConflictTriggered: false,
          };
        }
      }
    }
  }

  // 补齐部门冷却表
  const departmentStates = result.departmentStates as
    Record<string, Record<string, unknown>> | undefined;
  if (departmentStates) {
    for (const deptState of Object.values(departmentStates)) {
      if (!deptState.actionCooldownUntilDays) {
        deptState.actionCooldownUntilDays = {};
      }
    }
  }

  return result;
};
