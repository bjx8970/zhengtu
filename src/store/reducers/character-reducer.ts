/**
 * 角色 Reducer（Schema 2）
 *
 * 处理角色相关动作：
 * - NEW_GAME：初始化新游戏
 * - LOAD_SAVE：加载已经 save-codec 严格解码验证的存档
 */

import type { PlayerSave } from '../../types/player';
import type { NewGamePayload } from '../../types/actions';
import { getConfigLoader } from '../../config/loader';
import { clampAttr } from '../../utils/math';

/**
 * 处理 LOAD_SAVE 动作。
 *
 * 存档已经 save-codec 严格解码验证，LOAD_SAVE 只负责替换状态。
 *
 * @param draft 当前游戏状态
 * @param save 已经过 save-codec 验证的存档
 */
export function reduceLoadSave(draft: PlayerSave, save: PlayerSave): void {
  Object.assign(draft, save);
}

/**
 * 处理 NEW_GAME 动作。
 *
 * @param draft 当前游戏状态
 * @param payload 建档数据
 * @param createFresh 创建新初始状态的工厂函数
 */
export function reduceNewGame(
  draft: PlayerSave,
  payload: NewGamePayload,
  createFresh: () => PlayerSave,
): void {
  // 先完全重置为 fresh state，避免继承旧存档的事件、政策、履历等
  const fresh = createFresh();
  Object.assign(draft, fresh);

  const d = payload.data;
  const cfg = getConfigLoader();

  // 角色基础信息
  draft.character.saveId = (d.saveId as string) ?? '';
  draft.character.userId = (d.userId as string) ?? '';
  draft.character.characterName = (d.characterName as string) ?? '';
  draft.character.gender = (d.gender as '男' | '女') ?? '男';
  draft.character.birthPlace = (d.birthPlace as { province: string; city: string }) ?? {
    province: '',
    city: '',
  };
  draft.character.birthYear = (d.birthYear as number) ?? 1990;
  draft.character.gaokaoScore = (d.gaokaoScore as number) ?? 0;
  draft.character.gaokaoTier = (d.gaokaoTier as string) ?? '';
  draft.character.university = (d.university as string) ?? '';
  draft.character.universityTier = (d.universityTier as string) ?? '';
  draft.character.familyBackground =
    (d.familyBackground as PlayerSave['character']['familyBackground']) ?? 'peasant';
  draft.character.promotionPath =
    (d.promotionPath as PlayerSave['character']['promotionPath']) ?? 'gongwuyuan';
  draft.character.isPreparatory = (d.isPreparatory as boolean) ?? false;

  // 初始理念
  if (d.philosophy && typeof d.philosophy === 'object') {
    draft.character.philosophy = d.philosophy as PlayerSave['character']['philosophy'];
  }

  // 应用家庭背景与晋升通道的属性加成
  const gameCfg = cfg.getGameConfig();
  const bonuses: Record<string, number> = {};
  const bgId = draft.character.familyBackground;
  const pathId = draft.character.promotionPath;
  if (bgId) {
    const bg = cfg.getFamilyBackground(bgId);
    if (bg) Object.assign(bonuses, bg.bonuses);
  }
  if (pathId) {
    const path = cfg.getPromotionPath(pathId);
    if (path) Object.assign(bonuses, path.bonuses);
  }
  for (const [key, delta] of Object.entries(bonuses)) {
    if (key === 'politicalCapital') {
      draft.character.politicalCapital = Math.max(
        0,
        Math.min(500, draft.character.politicalCapital + delta),
      );
    } else if (key === 'innovation' || key === 'pragmatic' || key === 'principled') {
      const scores = draft.character.philosophy.scores;
      scores[key] = Math.max(0, Math.min(100, (scores[key] ?? 50) + delta));
    } else {
      const char = draft.character as unknown as Record<string, unknown>;
      const current = typeof char[key] === 'number' ? (char[key] as number) : 0;
      char[key] = clampAttr(key, current + delta, gameCfg.attributeBounds);
    }
  }

  // 初始任职（从配置读取 initialPositionId）
  const firstPosition = cfg.getPositionById(gameCfg.initialPositionId);
  if (firstPosition) {
    draft.career.appointment = {
      positionId: firstPosition.id,
      institutionId: firstPosition.institutionId,
      regionId: firstPosition.regionId,
      institutionLevel: firstPosition.institutionLevel,
      positionDomain: firstPosition.positionDomain,
      leadershipRank: firstPosition.leadershipRank,
      startedAtDay: 0,
      appointmentType: 'substantive',
      probationEndsAtDay: 360,
    };
    draft.remainingBudget = firstPosition.annualBudget;

    // 初始化部门状态
    const depts = cfg.resolvePositionDepartments(firstPosition.id);
    for (const dept of depts) {
      draft.actions.departmentStates[dept.id] = {
        id: dept.id,
        kpiValues: {},
        monthlyConsumption: 0,
        cumulativeConsumption: 0,
        lastActionDay: 0,
        actionCooldownUntilDays: {},
      };
    }
  }

  // 时间
  draft.time = { ...fresh.time };
  draft.updatedAt = Date.now();
}
