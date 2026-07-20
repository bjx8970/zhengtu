/**
 * 角色 Reducer
 *
 * 处理角色相关动作：
 * - NEW_GAME：初始化新游戏
 * - LOAD_SAVE：加载存档（含迁移）
 */

import type { PlayerSave } from '../../types/player';
import { getConfigLoader } from '../../config/loader';
import { clamp } from '../../utils/math';
import { applyPlayerAttr, initializeDepartmentStates } from './shared';
import { normalizeAllSpectrums } from '../../engine/career/spectrum-constraint';
import { PromotionStage } from '../../types/enums';

/**
 * 将旧存档迁移到 Phase A 属性体系。
 *
 * @param draft 从旧存档反序列化的 PlayerSave
 */
function migrateSaveToPhaseA(draft: PlayerSave): void {
  const save = draft as unknown as Record<string, unknown>;

  if (typeof save.health === 'number' && typeof save.vigor !== 'number') {
    save.vigor = save.health;
  }

  if (typeof save.demoralization === 'number' && typeof save.ambition !== 'number') {
    save.ambition = 100 - (save.demoralization as number);
  }

  if (save.factions && typeof save.factions === 'object') {
    const factions = save.factions as Record<string, unknown>;
    if (factions.reputation && typeof factions.reputation === 'object') {
      const rep = factions.reputation as Record<string, number>;
      const existing = (save.philosophy as Record<string, unknown> | undefined)?.scores as
        Record<string, number> | undefined;
      save.philosophy = {
        scores: {
          innovation: rep.reform ?? existing?.innovation ?? 0,
          pragmatic: rep.pragmatic ?? existing?.pragmatic ?? 0,
          principled: rep.conservative ?? existing?.principled ?? 0,
        },
      };
    }
  }

  delete save.health;
  delete save.demoralization;
  delete save.factions;
  delete (save as Record<string, unknown>).superiorFavor;
}

/** Phase C 存档迁移：旧 scores 归一化到新光谱约束 */
function migrateSaveToPhaseC(draft: PlayerSave): void {
  const styleCfg = getConfigLoader().getLeadershipStyleConfig();
  draft.philosophy.scores = normalizeAllSpectrums(draft.philosophy.scores, styleCfg.styleSpectrums);
}

/**
 * 补齐旧版本本地存档中尚不存在的行动分类与冷却字段。
 *
 * @param draft 已载入的可变游戏状态
 */
function migrateActionState(draft: PlayerSave): void {
  const position = getConfigLoader().getPosition(
    draft.currentCareerLine,
    draft.currentLevel,
    parseInt(draft.currentPositionId.split('_').pop() ?? '0', 10),
  );

  for (const departmentState of Object.values(draft.departmentStates)) {
    departmentState.actionCooldownUntilDays ??= {};
  }

  const tierKeys = ['primary', 'secondary', 'reserve'] as const;
  for (const tierKey of tierKeys) {
    for (const occupant of draft.slots[tierKey].occupants) {
      if (!occupant) continue;

      const actionConfig = position?.departments
        .find((department) => department.id === occupant.deptId)
        ?.actions.find((configuredAction) => configuredAction.id === occupant.actionId);

      if (!('category' in occupant) || occupant.category === undefined) {
        occupant.category = actionConfig?.category ?? 'routine';
      }
      if (!('cooldownDays' in occupant) || occupant.cooldownDays === undefined) {
        occupant.cooldownDays = actionConfig?.cooldownDays ?? 0;
      }

      // v4: 补充 runtimeSnapshot
      if (!occupant.runtimeSnapshot) {
        occupant.runtimeSnapshot = {
          effectivenessMultiplier: 1,
          styleConflictTriggered: false,
        };
      }
    }
  }

  // 兼容旧存档：若晋升流程进行中但缺少 targetPositionId
  if (
    draft.promotionState &&
    draft.promotionStage !== PromotionStage.Idle &&
    draft.promotionStage !== PromotionStage.Completed &&
    draft.promotionStage !== PromotionStage.Failed &&
    (!draft.promotionState.targetPositionId || draft.promotionState.targetPositionId === '')
  ) {
    const lineCfgMigrate = getConfigLoader().getCareerLine(draft.currentCareerLine);
    const targetLevelCfg = lineCfgMigrate?.levels.find(
      (l) => l.level === draft.promotionState!.targetLevel,
    );
    if (targetLevelCfg && targetLevelCfg.positions.length > 0) {
      draft.promotionState.targetPositionId = targetLevelCfg.positions[0]!.id;
    }
  }
}

/**
 * 处理 LOAD_SAVE 动作。
 *
 * @param draft 当前游戏状态
 * @param save 要加载的存档
 */
export function reduceLoadSave(draft: PlayerSave, save: PlayerSave): void {
  Object.assign(draft, save);
  migrateSaveToPhaseA(draft);
  migrateSaveToPhaseC(draft);
  migrateActionState(draft);

  // v4: 删除已废弃的玩家级临时字段
  const saveObj = draft as unknown as Record<string, unknown>;
  delete saveObj._pendingDeviationMultiplier;
  delete saveObj.pendingStyleConflict;
}

/** NEW_GAME 动作参数 */
export interface NewGamePayload {
  data: Record<string, unknown>;
}

/**
 * 处理 NEW_GAME 动作。
 *
 * @param draft 当前游戏状态
 * @param payload 动作参数
 * @param createInitialState 创建初始状态的函数（避免循环依赖）
 */
export function reduceNewGame(
  draft: PlayerSave,
  payload: NewGamePayload,
  createInitialState: () => PlayerSave,
): void {
  const fresh = createInitialState();
  Object.assign(draft, fresh, payload.data);

  // 应用家庭背景 + 晋升通道的属性加成
  const bgId = payload.data.familyBackground as string | undefined;
  const pathId = payload.data.promotionPath as string | undefined;
  if (bgId || pathId) {
    const loader = getConfigLoader();
    const bonuses: Record<string, number> = {};
    if (bgId) {
      const bg = loader.getFamilyBackground(bgId);
      if (bg) Object.assign(bonuses, bg.bonuses);
    }
    if (pathId) {
      const path = loader.getPromotionPath(pathId);
      if (path) Object.assign(bonuses, path.bonuses);
    }
    for (const [key, delta] of Object.entries(bonuses)) {
      switch (key) {
        case 'politicalCapital':
          draft.politicalCapital = clamp(draft.politicalCapital + delta, 0, 500);
          break;
        case 'innovation':
        case 'pragmatic':
        case 'principled':
          draft.philosophy.scores[key] = clamp((draft.philosophy.scores[key] ?? 0) + delta, 0, 100);
          break;
        default:
          applyPlayerAttr(draft, key, delta, getConfigLoader().getGameConfig().attributeBounds);
      }
    }
  }
  initializeDepartmentStates(draft);
}
