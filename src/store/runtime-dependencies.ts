/**
 * 运行时依赖默认解析
 *
 * 集中维护各动作类型在 reducer 回退分支使用的默认运行时 ID 工厂前缀，
 * 供 reducer 与 Debug instrumentation（debug-instrumentation）共同使用，
 * 保证「调试注入的默认工厂」与「reducer 自身回退」语义完全一致、不漂移。
 *
 * 新增动作类型时本映射的穷举 Record 会强制补充对应前缀。
 */

import type { GameAction } from '../types/game';
import { createRuntimeIdFactory } from './runtime-id';

/** 每个动作类型的默认运行时 ID 前缀（与对应 reducer 的回退语义一致） */
const DEFAULT_ID_PREFIX: Record<GameAction['type'], string> = {
  NEW_GAME: 'game',
  LOAD_SAVE: 'game',
  START_ACTION: 'action',
  START_PERSONAL_TASK: 'task',
  ADVANCE_TIME: 'timeline',
  CHOOSE_EVENT_OPTION: 'event',
  PROPOSE_POLICY: 'policy',
  APPROVE_POLICY: 'policy',
  ACTIVATE_POLICY: 'policy',
  SUSPEND_POLICY: 'policy',
  RESUME_POLICY: 'policy',
  FAIL_POLICY: 'policy',
  REPEAL_POLICY: 'policy',
  ADVANCE_CIVIL_SERVICE_RANK: 'rank',
  ACCEPT_CAREER_OPPORTUNITY: 'career',
  REJECT_CAREER_OPPORTUNITY: 'career',
  CANCEL_CAREER_OPPORTUNITY: 'career',
  ADVANCE_CAREER_PROCESS: 'career',
};

/**
 * 创建动作类型对应的默认运行时 ID 工厂。
 *
 * @param actionType 动作类型
 * @returns 与该动作 reducer 回退语义一致的 ID 工厂
 */
export function createDefaultIdFactoryFor(actionType: GameAction['type']): () => string {
  return createRuntimeIdFactory(DEFAULT_ID_PREFIX[actionType]);
}
