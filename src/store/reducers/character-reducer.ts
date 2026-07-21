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
  const fresh = createFresh();
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

  // 初始任职（默认乡镇科员）
  const firstPosition = cfg.getPositionById('admin_l1_0');
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
