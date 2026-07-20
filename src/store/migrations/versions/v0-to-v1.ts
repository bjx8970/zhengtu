/**
 * v0 → v1 存档迁移
 *
 * 将无版本号的旧存档（v3 原型）迁移到 v4 版本化存档格式。
 * 这是唯一的 v0→v1 迁移入口，包含所有历史转换：
 *
 * 1. Phase A 属性迁移：health→vigor, demoralization→ambition, factions→philosophy
 * 2. Phase C 光谱归一化：旧 scores 归一化到新光谱约束
 * 3. 行动字段补齐：category, cooldownDays, actionCooldownUntilDays
 * 4. 理念偏离近似迁移：旧全局 _pendingDeviationMultiplier 分配到在途行动
 * 5. 晋升状态补齐：缺少 targetPositionId 时取目标等级第一个职位
 * 6. 删除废弃字段：_pendingDeviationMultiplier, pendingStyleConflict, superiorFavor
 *
 * 近似迁移策略说明：
 * 旧版使用玩家级 _pendingDeviationMultiplier 存储最近一次 START_ACTION 的偏离倍率。
 * 由于无法确定该倍率属于哪个具体行动，迁移时采用以下策略：
 * - 若旧存档存在 _pendingDeviationMultiplier，将其值应用到所有在途行动（近似）
 * - 若不存在，所有在途行动默认倍率 1（无偏离）
 * - pendingStyleConflict 同理：若为 true，所有在途行动标记冲突
 */

import type { MigrationFn } from '../../../types/save';
import { getConfigLoader } from '../../../config/loader';
import { normalizeAllSpectrums } from '../../../engine/career/spectrum-constraint';

/**
 * v0 → v1 迁移函数
 *
 * @param state 旧版存档状态（无 schemaVersion）
 * @returns 迁移后的状态
 */
export const migrateV0ToV1: MigrationFn = (state) => {
  const result = { ...state };

  // === Phase A: 属性体系迁移 ===
  if (typeof result.health === 'number' && typeof result.vigor !== 'number') {
    result.vigor = result.health;
  }
  if (typeof result.demoralization === 'number' && typeof result.ambition !== 'number') {
    result.ambition = 100 - (result.demoralization as number);
  }
  if (result.factions && typeof result.factions === 'object') {
    const factions = result.factions as Record<string, unknown>;
    if (factions.reputation && typeof factions.reputation === 'object') {
      const rep = factions.reputation as Record<string, number>;
      const existing = (result.philosophy as Record<string, unknown> | undefined)?.scores as
        Record<string, number> | undefined;
      result.philosophy = {
        scores: {
          innovation: rep.reform ?? existing?.innovation ?? 0,
          pragmatic: rep.pragmatic ?? existing?.pragmatic ?? 0,
          principled: rep.conservative ?? existing?.principled ?? 0,
        },
      };
    }
  }

  // === Phase C: 光谱归一化 ===
  if (result.philosophy && typeof result.philosophy === 'object') {
    const philosophy = result.philosophy as { scores: Record<string, number> };
    if (philosophy.scores && typeof philosophy.scores === 'object') {
      try {
        const styleCfg = getConfigLoader().getLeadershipStyleConfig();
        philosophy.scores = normalizeAllSpectrums(philosophy.scores, styleCfg.styleSpectrums);
      } catch {
        // 配置加载失败时保持原值
      }
    }
  }

  // === 理念偏离近似迁移 ===
  // 旧全局倍率应用到所有在途行动（近似策略，见文件头说明）
  const oldDevMult =
    typeof result._pendingDeviationMultiplier === 'number'
      ? (result._pendingDeviationMultiplier as number)
      : 1;
  const oldConflict = result.pendingStyleConflict === true;

  // === 行动字段补齐 + runtimeSnapshot ===
  const slots = result.slots as Record<string, { occupants: unknown[] }> | undefined;
  if (slots) {
    for (const tierKey of ['primary', 'secondary', 'reserve'] as const) {
      const tier = slots[tierKey];
      if (!tier?.occupants) continue;
      for (let i = 0; i < tier.occupants.length; i++) {
        const occupant = tier.occupants[i] as Record<string, unknown> | null;
        if (!occupant) continue;

        // 补齐 category 和 cooldownDays
        if (!('category' in occupant) || occupant.category === undefined) {
          occupant.category = 'routine';
        }
        if (!('cooldownDays' in occupant) || occupant.cooldownDays === undefined) {
          occupant.cooldownDays = 0;
        }

        // 绑定 runtimeSnapshot（使用旧全局倍率作为近似）
        if (!occupant.runtimeSnapshot) {
          occupant.runtimeSnapshot = {
            effectivenessMultiplier: oldDevMult,
            styleConflictTriggered: oldConflict,
          };
        }
      }
    }
  }

  // === 部门冷却表补齐 ===
  const departmentStates = result.departmentStates as
    Record<string, Record<string, unknown>> | undefined;
  if (departmentStates) {
    for (const deptState of Object.values(departmentStates)) {
      if (!deptState.actionCooldownUntilDays) {
        deptState.actionCooldownUntilDays = {};
      }
    }
  }

  // === 晋升状态补齐 ===
  const promotionState = result.promotionState as Record<string, unknown> | null;
  if (
    promotionState &&
    result.promotionStage !== 'idle' &&
    result.promotionStage !== 'completed' &&
    result.promotionStage !== 'failed' &&
    (!promotionState.targetPositionId || promotionState.targetPositionId === '')
  ) {
    try {
      const lineCfg = getConfigLoader().getCareerLine(
        result.currentCareerLine as Parameters<
          ReturnType<typeof getConfigLoader>['getCareerLine']
        >[0],
      );
      const targetLevelCfg = lineCfg?.levels.find(
        (l) => l.level === (promotionState.targetLevel as number),
      );
      if (targetLevelCfg && targetLevelCfg.positions.length > 0) {
        promotionState.targetPositionId = targetLevelCfg.positions[0]!.id;
      }
    } catch {
      // 配置加载失败时不补齐
    }
  }

  // === 删除废弃字段 ===
  delete result.health;
  delete result.demoralization;
  delete result.factions;
  delete result.superiorFavor;
  delete result._pendingDeviationMultiplier;
  delete result.pendingStyleConflict;

  return result;
};
