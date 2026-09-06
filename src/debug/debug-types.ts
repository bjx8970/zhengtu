/**
 * Debug Bundle 类型定义
 *
 * Debug Bundle 是「旁路式可重放诊断包」：记录从建档（或载入存档）开始的全部
 * 有效操作（changed === true 的 GameAction）及其消费的随机数/运行时 ID。
 *
 * 硬约束：Debug 数据完全独立于正式 PlayerSave / SaveEnvelope schema，
 * 仅通过 character.saveId 关联；普通「导入存档」功能不得接受本文件。
 */

import type { GameAction } from '../types/game';
import type { PlayerSave } from '../types/player';

/** Debug Bundle 自身的结构版本（与存档 schemaVersion 无关，独立演进） */
export const DEBUG_SCHEMA_VERSION = 1 as const;

/** 轨迹完整性：complete = 自建档起完整记录；partial = 从载入既有存档的时刻起记录 */
export type TraceCompleteness = 'complete' | 'partial';

/** 单次有效操作（changed === true）的轨迹记录 */
export interface DebugActionRecord {
  /** 会话内递增序号（从 1 开始），重放时用于定位首个分歧 */
  seq: number;
  /** 动作类型（冗余存储，便于不重放快速浏览） */
  actionType: GameAction['type'];
  /** 序列化后的动作（已剥离 _rng/_idFactory 等函数字段） */
  action: Record<string, unknown>;
  /** 动作执行前的游戏日 */
  gameDayBefore: number;
  /** 动作执行后的游戏日 */
  gameDayAfter: number;
  /** 该动作执行期间实际消费的全部随机数（按消费顺序） */
  randomDraws: number[];
  /** 该动作执行期间实际生成的全部运行时 ID（按生成顺序） */
  generatedIds: string[];
  /** 动作执行前的状态哈希（排除 updatedAt 等墙钟字段） */
  beforeStateHash: string;
  /** 动作执行后的状态哈希 */
  afterStateHash: string;
  /** 记录时刻（Unix 毫秒），仅诊断用途 */
  recordedAt: number;
}

/** Bundle 元信息 */
export interface DebugMetadata {
  /** 应用版本（package.json version） */
  appVersion: string;
  /** 构建时的 git 短 SHA（无法获取时为 null） */
  commitSha: string | null;
  /** 存档 schema 版本（记录录制环境的 CURRENT_SCHEMA_VERSION） */
  saveSchemaVersion: number;
  /** 内容版本（记录录制环境的 CURRENT_CONTENT_VERSION） */
  contentVersion: string;
  /** Debug Bundle 结构版本 */
  debugSchemaVersion: number;
  /** 关联存档的 saveId（旧档可能为空串，此时以轨迹 ID 兜底） */
  saveId: string;
  /** 角色名（便于人工识别文件） */
  characterName: string;
  /** 轨迹完整性 */
  traceCompleteness: TraceCompleteness;
  /** 记录起点的游戏日 */
  startedAtDay: number;
  /** 记录起点的 Unix 毫秒 */
  startedAtWallClock: number;
  /** 导出时的游戏日 */
  exportedAtDay: number;
  /** 导出时的 Unix 毫秒 */
  exportedAtWallClock: number;
}

/** Bundle 完整性校验信息 */
export interface DebugIntegrity {
  /** journal 长度 */
  journalLength: number;
  /** 末状态哈希（应等于最后一条记录的 afterStateHash；journal 为空时等于初始状态哈希） */
  finalStateHash: string;
}

/** 录制环境实际加载的配置快照（版本演进后旧 Bundle 仍可解释当时规则） */
export interface DebugConfigSnapshot {
  contentVersion: string;
  gameConfig: unknown;
  positions: unknown;
  institutions: unknown;
  eventDefinitions: unknown;
  policyDefinitions: unknown;
  careerOpportunityDefinitions: unknown;
  personalTaskTemplates: unknown;
  cadreTemplates: unknown;
  relativeSelectionConfig: unknown;
  civilServiceRankDefinitions: unknown;
  civilServiceRankProgressionRules: unknown;
  experienceQualificationRules: unknown;
  leadershipStyleConfig: unknown;
}

/** 可重放 Debug Bundle（zhengtu-debug-*.json 的顶层结构） */
export interface DebugBundle {
  debugSchemaVersion: number;
  metadata: DebugMetadata;
  /** 轨迹起点状态快照（建档完成或载入存档后的 PlayerSave） */
  initialState: PlayerSave;
  /** 导出时的完整状态快照 */
  currentState: PlayerSave;
  /** 有效操作日志 */
  journal: DebugActionRecord[];
  /** 录制环境配置快照 */
  configSnapshot: DebugConfigSnapshot;
  integrity: DebugIntegrity;
}

/** 单步重放分歧信息 */
export interface ReplayDivergence {
  /** 发生分歧的记录序号（终态分歧为 -1） */
  seq: number;
  /** 分歧类别 */
  reason:
    | 'before_hash_mismatch'
    | 'not_changed'
    | 'after_hash_mismatch'
    | 'rng_under_consumed'
    | 'id_under_consumed'
    | 'replay_threw'
    | 'final_state_mismatch';
  /** 期望值 */
  expected: string;
  /** 实际值 */
  actual: string;
}

/** 重放结果 */
export interface ReplayResult {
  /** 是否全程一致（含终态与导出快照一致） */
  ok: boolean;
  /** 首个分歧（ok 为 true 时为 null）；重放在首个分歧处停止 */
  firstDivergence: ReplayDivergence | null;
  /** 已重放的记录数 */
  replayedCount: number;
  /** 重放终态哈希 */
  finalStateHash: string;
  /** 重放终态是否与导出的 currentState 快照一致 */
  replayMatchesExport: boolean;
}
