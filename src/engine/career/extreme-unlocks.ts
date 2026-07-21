/**
 * 极端内容解锁查询
 *
 * 根据玩家当前各风格得分与领导风格配置，查询已解锁的极端行动和事件。
 * 极端行动在得分达到 extremeThreshold 后解锁，极端事件在得分达到
 * extremeHighThreshold 后解锁。
 */

import type {
  LeadershipStyleConfig,
  ExtremeActionConfig,
  ExtremeEventConfig,
  UnlockedExtremeContent,
} from '../../types/config';

/**
 * 获取当前所有已解锁的极端内容。
 *
 * @param scores 玩家当前各风格/属性得分
 * @param config 领导风格系统配置
 * @returns 包含已解锁极端行动和事件的对象
 */
export function getUnlockedExtremes(
  scores: Record<string, number>,
  config: LeadershipStyleConfig,
): UnlockedExtremeContent {
  const actions: ExtremeActionConfig[] = [];
  const events: ExtremeEventConfig[] = [];

  for (const spectrum of config.styleSpectrums) {
    for (const member of spectrum.members) {
      const score = scores[member] ?? 0;
      if (score >= spectrum.extremeThreshold) {
        const extremeActions = spectrum.extremeActions[member] ?? [];
        for (const action of extremeActions) {
          if (score >= action.requiredScore) {
            actions.push(action);
          }
        }
        if (score >= spectrum.extremeHighThreshold) {
          const extremeEvents = spectrum.extremeEvents[member] ?? [];
          for (const event of extremeEvents) {
            if (score >= event.requiredScore) {
              events.push(event);
            }
          }
        }
      }
    }
  }

  return { actions, events };
}

/**
 * 检查单个极端行动是否已对玩家解锁。
 *
 * 极端行动需要：1) 对应风格得分 >= extremeThreshold（由调用方传入），
 * 2) 玩家得分 >= 该行动自身要求的 requiredScore。
 *
 * @param scores 玩家当前各风格/属性得分
 * @param action 待检查的极端行动配置
 * @param extremeThreshold 对应光谱的极端阈值
 * @returns 该行动是否已解锁
 */
export function isExtremeActionUnlocked(
  scores: Record<string, number>,
  action: ExtremeActionConfig,
  extremeThreshold: number,
): boolean {
  return (scores[action.styleAlignment] ?? 0) >= Math.max(action.requiredScore, extremeThreshold);
}
