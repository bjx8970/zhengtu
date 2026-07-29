/**
 * Reducer 动作载荷类型定义
 *
 * 所有 reducer 模块的 payload 接口集中定义于此，
 * 遵循 AGENTS.md "所有类型在 src/types/" 规范。
 */

import type { SlotTierKey } from './player';
import type { TimeGranularity } from './enums';

/** START_ACTION 动作参数 */
export interface StartActionPayload {
  deptId: string;
  actionId: string;
  tierKey: SlotTierKey;
  _idFactory?: () => string;
}

/** ADVANCE_TIME 动作参数 */
export interface AdvanceTimePayload {
  granularity: TimeGranularity;
  _rng?: () => number;
  _idFactory?: () => string;
}

/** PROMOTION_RESOLVE_STAGE 动作参数 */
export interface PromotionResolvePayload {
  choices?: { useConnections?: boolean; influenceInspectors?: boolean };
  _rng?: () => number;
}

/** NEW_GAME 动作参数 */
export interface NewGamePayload {
  data: Record<string, unknown>;
}

// ===== Phase 2: 政策运行时 =====

/** 共同政策运行时载荷（RNG/ID 可注入） */
export interface PolicyRuntimePayload {
  policyInstanceId: string;
  _rng?: () => number;
  _idFactory?: () => string;
}

/** 提议政策载荷 */
export interface ProposePolicyPayload {
  policyId: string;
  regionId?: string;
  institutionId?: string;
  _idFactory?: () => string;
}
