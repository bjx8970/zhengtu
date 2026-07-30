/** 公务员职级晋升 Store 事务：状态、职数和事件级联一起提交。 */
import { unwrap } from 'solid-js/store';
import { getConfigLoader } from '../../config/loader';
import { advanceCivilServiceRank } from '../../engine/career/civil-service-rank-progression';
import { processCascadeSignalsInTransaction } from './event-reducer';
import { createRuntimeIdFactory } from '../runtime-id';
import type { PlayerSave } from '../../types/player';

export interface AdvanceCivilServiceRankPayload {
  sourceType?: 'assessment' | 'event' | 'policy' | 'system';
  sourceId?: string | null;
  sourceAssessmentYear?: number | null;
  _idFactory?: () => string;
  _rng?: () => number;
}

/** @param draft Store 草稿 @param payload 晋升来源与注入依赖 @param currentDay 当前绝对日 @returns 是否完成晋升。 */
export function reduceAdvanceCivilServiceRank(
  draft: PlayerSave,
  payload: AdvanceCivilServiceRankPayload,
  currentDay: number,
): boolean {
  const loader = getConfigLoader();
  const rule = loader.getCivilServiceRankProgressionRule(draft.career.civilServiceRank);
  if (!rule) return false;
  const idFactory = payload._idFactory ?? createRuntimeIdFactory('rank');
  const transaction = structuredClone(unwrap(draft));
  const config = loader.getGameConfig();
  const result = advanceCivilServiceRank({
    state: transaction,
    currentDay,
    daysPerYear: config.daysPerMonth * config.monthsPerYear,
    rule,
    idFactory,
    sourceType: payload.sourceType ?? 'system',
    sourceId: payload.sourceId,
    sourceAssessmentYear: payload.sourceAssessmentYear,
  });
  if (!result.success) return false;
  transaction.career.civilServiceRank = result.currentRank;
  transaction.career.civilServiceRankStartedAtDay = currentDay;
  transaction.career.civilServiceRankHistory.push(result.historyRecord);
  if (result.quotaMetricId && result.quotaCurrentValue !== null)
    transaction.world.metrics[result.quotaMetricId] = result.quotaCurrentValue;
  processCascadeSignalsInTransaction(
    transaction,
    result.emittedSignals,
    currentDay,
    payload._rng ?? Math.random,
    idFactory,
    loader.getAllEventDefinitions(),
  );
  Object.assign(draft, transaction);
  return true;
}
