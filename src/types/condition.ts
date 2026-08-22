/** 条件解释器跨模块共享的只读评估上下文。 */

import type { DomainSignalSnapshot } from '../domain/governance/types';
import type { CareerExperienceQualificationRules } from './config';
import type { PlayerSave } from './player';

/** 条件解释器所需的信号、存档、时间和履历规则。 */
export interface ConditionEvaluationContext {
  /** 触发信号快照。 */
  signal: DomainSignalSnapshot;
  /** 当前游戏状态。 */
  state: Readonly<PlayerSave>;
  /** 当前绝对游戏日。 */
  currentDay: number;
  /** 每年游戏日数。 */
  daysPerYear: number;
  /** 履历资格规则；缺失时履历条件不成立。 */
  careerExperienceQualificationRules?: Readonly<CareerExperienceQualificationRules>;
}
