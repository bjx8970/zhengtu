/**
 * 角色 Reducer
 *
 * 处理角色相关动作：
 * - NEW_GAME：初始化新游戏
 * - LOAD_SAVE：加载已经过迁移管道验证和规范化的存档
 */

import type { PlayerSave } from '../../types/player';
import type { NewGamePayload } from '../../types/actions';
import { getConfigLoader } from '../../config/loader';
import { clamp } from '../../utils/math';
import { applyPlayerAttr, initializeDepartmentStates } from './shared';

/**
 * 处理 LOAD_SAVE 动作。
 *
 * v4 变更：迁移逻辑已收敛到 migrations/ 版本管道。
 * LOAD_SAVE 只负责替换已经验证和规范化的状态。
 *
 * @param draft 当前游戏状态
 * @param save 已经过迁移管道处理的存档
 */
export function reduceLoadSave(draft: PlayerSave, save: PlayerSave): void {
  Object.assign(draft, save);
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
