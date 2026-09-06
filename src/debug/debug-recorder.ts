/**
 * Debug Trace 录制器
 *
 * 旁路式录制「有效操作」（changed === true 的 GameAction）：
 * - NEW_GAME → 重置轨迹，completeness = complete（自建档起完整记录）；
 * - LOAD_SAVE → 先以 partial 建立会话，再异步认领 IndexedDB 中的既有轨迹
 *   （saveId 命中或末状态哈希命中），认领期间已记录的动作按原顺序续接；
 * - 其余动作 → pending 捕获 → commit（追加 journal + IndexedDB）或 discard。
 *
 * 正式游戏状态与存档 schema 不依赖本模块；关闭编译开关后全部为 no-op。
 */

import { createSignal } from 'solid-js';
import type { GameAction } from '../types/game';
import type { PlayerSave } from '../types/player';
import { CURRENT_CONTENT_VERSION, CURRENT_SCHEMA_VERSION } from '../types/save';
import { DEBUG_TRACE_ENABLED } from './debug-flags';
import {
  createDebugCapture,
  instrumentGameAction,
  serializeAction,
  type DebugCapture,
} from './debug-instrumentation';
import {
  BRANCH_TRACE_PREFIX,
  LEGACY_TRACE_PREFIX,
  clearTrace,
  commitTraceBatch,
  findTraceKeyByStateHash,
  loadStoredTrace,
  persistTraceMeta,
  type StoredTraceMeta,
} from './debug-storage';
import { hashSave } from './state-hash';
import {
  DEBUG_SCHEMA_VERSION,
  type DebugActionRecord,
  type TraceCompleteness,
} from './debug-types';

/** UI 响应式读取的轨迹状态摘要 */
export interface DebugTraceStatus {
  /** 是否正在记录 */
  active: boolean;
  /** 轨迹标识 */
  traceKey: string;
  /** 完整性 */
  completeness: TraceCompleteness;
  /** 记录起点的游戏日 */
  startedAtDay: number;
  /** 已记录的有效操作数 */
  journalLength: number;
  /** 关联存档的 saveId */
  saveId: string;
  /** 角色名 */
  characterName: string;
}

/** 会话内存态（journal 的唯一权威来源，IndexedDB 为 append-only 持久层） */
interface TraceSession {
  traceKey: string;
  completeness: TraceCompleteness;
  startedAtDay: number;
  /** 轨迹起点状态快照（重放起点） */
  initialState: PlayerSave;
  journal: DebugActionRecord[];
  seq: number;
  /** 认领未决期间为 true：commit 仅入内存，落定后才以最终键/seq 持久化 */
  adopting?: boolean;
}

interface PendingCapture {
  actionType: GameAction['type'];
  action: Record<string, unknown>;
  gameDayBefore: number;
  beforeStateHash: string;
  capture: DebugCapture;
}

const [traceStatus, setTraceStatus] = createSignal<DebugTraceStatus | null>(null);

let session: TraceSession | null = null;
let pending: PendingCapture | null = null;

/**
 * 获取当前轨迹状态（设置页响应式读取）。
 *
 * @returns Solid signal（无活动轨迹时为 null）
 */
export function getTraceStatusSignal(): () => DebugTraceStatus | null {
  return traceStatus;
}

/**
 * 生成轨迹兜底 ID（旧存档无 saveId 时使用）。
 *
 * @returns 唯一 ID 字符串
 */
function generateTraceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return uuid
    ? uuid()
    : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * 构建响应式状态摘要。
 *
 * @param current 当前会话
 * @returns UI 状态摘要
 */
function toStatus(current: TraceSession): DebugTraceStatus {
  return {
    active: true,
    traceKey: current.traceKey,
    completeness: current.completeness,
    startedAtDay: current.startedAtDay,
    journalLength: current.journal.length,
    saveId: current.initialState.character.saveId,
    characterName: current.initialState.character.characterName,
  };
}

/**
 * 构建 IndexedDB 元数据记录。
 *
 * @param current 当前会话
 * @param lastStateHash 最近一次提交后的状态哈希
 * @returns 可持久化的元数据记录
 */
function toStoredMeta(current: TraceSession, lastStateHash: string): StoredTraceMeta {
  return {
    traceKey: current.traceKey,
    initialState: current.initialState,
    lastStateHash,
    meta: {
      appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
      commitSha: typeof __GIT_COMMIT_SHA__ === 'string' ? __GIT_COMMIT_SHA__ : null,
      saveSchemaVersion: CURRENT_SCHEMA_VERSION,
      contentVersion: CURRENT_CONTENT_VERSION,
      debugSchemaVersion: DEBUG_SCHEMA_VERSION,
      saveId: current.initialState.character.saveId,
      characterName: current.initialState.character.characterName,
      traceCompleteness: current.completeness,
      startedAtDay: current.startedAtDay,
      startedAtWallClock: current.initialState.updatedAt,
      exportedAtDay: current.initialState.time.totalDaysPlayed,
      exportedAtWallClock: Date.now(),
    },
  };
}

/**
 * 在 dispatch 边界开始一次动作捕获并注入记录型 _rng/_idFactory。
 *
 * LOAD_SAVE 不捕获（其本身 changed === false，走 adopt 流程）。
 *
 * @param action 原始动作
 * @param stateBefore 动作执行前的游戏状态（unwrap 后）
 * @returns 交给 reducer 的动作（调试关闭时与输入相同）
 */
export function debugTraceWrapAction(action: GameAction, stateBefore: PlayerSave): GameAction {
  if (!DEBUG_TRACE_ENABLED || action.type === 'LOAD_SAVE') return action;
  // 防御：上一次 pending 未收口（正常流程不会发生）时静默丢弃
  pending = {
    actionType: action.type,
    action: serializeAction(action),
    gameDayBefore: stateBefore.time.totalDaysPlayed,
    beforeStateHash: hashSave(stateBefore),
    capture: createDebugCapture(),
  };
  return instrumentGameAction(action, pending.capture);
}

/**
 * 动作产生状态变化后收口：NEW_GAME 重置轨迹为 complete，其余追加记录。
 *
 * @param stateAfter 动作执行后的游戏状态（unwrap 后）
 * @param actionType 动作类型
 */
export function debugTraceCommit(stateAfter: PlayerSave, actionType: GameAction['type']): void {
  if (!DEBUG_TRACE_ENABLED) return;
  if (actionType === 'NEW_GAME') {
    startCompleteTrace(stateAfter);
    return;
  }
  const current = session;
  if (!current || !pending) {
    pending = null;
    return;
  }
  const afterStateHash = hashSave(stateAfter);
  const record: DebugActionRecord = {
    seq: current.seq + 1,
    actionType,
    action: pending.action,
    gameDayBefore: pending.gameDayBefore,
    gameDayAfter: stateAfter.time.totalDaysPlayed,
    randomDraws: pending.capture.randomDraws,
    generatedIds: pending.capture.generatedIds,
    beforeStateHash: pending.beforeStateHash,
    afterStateHash,
    recordedAt: Date.now(),
  };
  current.seq = record.seq;
  current.journal.push(record);
  setTraceStatus(toStatus(current));
  // 认领未决期间只入内存：此时最终 traceKey/连续性尚未确定，
  // 提前落盘会污染将被放弃的候选键或与认领结果重复
  if (!current.adopting) {
    void commitTraceBatch(toStoredMeta(current, afterStateHash), [record]);
  }
  pending = null;
}

/** 丢弃当前 pending 捕获（动作未产生状态变化）。 */
export function debugTraceAbort(): void {
  pending = null;
}

/**
 * NEW_GAME 后以建档状态重置轨迹（完整记录）。
 *
 * @param stateAfter 建档完成后的游戏状态
 */
function startCompleteTrace(stateAfter: PlayerSave): void {
  pending = null;
  const saveId = stateAfter.character.saveId;
  session = {
    traceKey: saveId || `${LEGACY_TRACE_PREFIX}-${generateTraceId()}`,
    completeness: 'complete',
    startedAtDay: stateAfter.time.totalDaysPlayed,
    initialState: structuredClone(stateAfter),
    journal: [],
    seq: 0,
  };
  setTraceStatus(toStatus(session));
  void persistTraceMeta(toStoredMeta(session, hashSave(stateAfter)));
}

/**
 * LOAD_SAVE 后认领或新建轨迹。
 *
 * 先以 partial 建立候选会话（adopting = true，从载入时刻开始记录），
 * 再异步按「saveId 主键 → 末状态哈希」查找**末状态连续**的既有轨迹：
 * - 主键命中且 `lastStateHash` 等于本次载入哈希 → 继承完整历史；
 * - 主键不连续（例如载入同一 saveId 的更旧/回滚备份）时退回哈希匹配，
 *   命中则续接此前为该快照建立的分支轨迹；
 * - 均无连续轨迹且主键下已有不相关历史 → 换用全新 `branch-` 键，
 *   绝不覆盖或拼接原历史；主键下无任何历史 → 保留候选键。
 *
 * @param stateAfter 载入完成后的游戏状态
 */
export function debugTraceAdoptLoadedSave(stateAfter: PlayerSave): void {
  if (!DEBUG_TRACE_ENABLED) return;
  pending = null;
  const stateHash = hashSave(stateAfter);
  const saveId = stateAfter.character.saveId;
  const candidate: TraceSession = {
    traceKey: saveId || `${LEGACY_TRACE_PREFIX}-${generateTraceId()}`,
    completeness: 'partial',
    startedAtDay: stateAfter.time.totalDaysPlayed,
    initialState: structuredClone(stateAfter),
    journal: [],
    seq: 0,
    adopting: true,
  };
  session = candidate;
  setTraceStatus(toStatus(candidate));
  void adoptExistingTrace(candidate, stateHash);
}

/**
 * 异步认领既有轨迹（查找规则见 debugTraceAdoptLoadedSave）。
 *
 * @param candidate 发起认领的会话引用（会话已被重置时放弃）
 * @param stateHash 当前存档状态哈希
 */
async function adoptExistingTrace(candidate: TraceSession, stateHash: string): Promise<void> {
  const primary = await loadStoredTrace(candidate.traceKey);
  const primaryContinuous = primary !== null && primary.lastStateHash === stateHash;
  const hashedKey = primaryContinuous ? null : await findTraceKeyByStateHash(stateHash);
  const hashed =
    !primaryContinuous && hashedKey && hashedKey !== candidate.traceKey
      ? await loadStoredTrace(hashedKey)
      : null;
  const continuous = primaryContinuous ? primary : hashed;

  if (!session || session !== candidate) return;

  if (continuous) {
    inheritStoredTrace(candidate, continuous, stateHash);
    return;
  }
  // 无连续既有轨迹：窗口期记录统一补写落盘（刷新后不丢）。
  // 主键下已有不相关历史时换用全新 branch 键，不覆盖/拼接原历史；
  // 主键下无任何历史时保留候选键（saveId / legacy-uuid）。
  finalizeCandidate(
    candidate,
    primary ? `${BRANCH_TRACE_PREFIX}-${generateTraceId()}` : candidate.traceKey,
    stateHash,
  );
}

/**
 * 认领落定（无继承）：以最终 traceKey 统一补写窗口期记录与元数据。
 *
 * @param candidate 发起认领的会话引用（已通过会话存续校验）
 * @param finalKey 落定后的轨迹标识
 * @param stateHash 载入快照哈希（窗口期无记录时作为 meta 尾哈希）
 */
function finalizeCandidate(candidate: TraceSession, finalKey: string, stateHash: string): void {
  candidate.traceKey = finalKey;
  candidate.adopting = false;
  setTraceStatus(toStatus(candidate));
  const tail = candidate.journal[candidate.journal.length - 1];
  void commitTraceBatch(toStoredMeta(candidate, tail ? tail.afterStateHash : stateHash), [
    ...candidate.journal,
  ]);
}

/**
 * 继承末状态连续的既有轨迹：恢复持久化日志与元数据，认领窗口期内的
 * 记录以最终键与最终 seq 续接，一次性原子落盘。
 *
 * @param candidate 发起认领的会话引用
 * @param stored 末状态连续的既有轨迹
 * @param stateHash 载入快照哈希（窗口期无记录时作为 meta 尾哈希）
 */
function inheritStoredTrace(
  candidate: TraceSession,
  stored: StoredTraceMeta & { records: DebugActionRecord[] },
  stateHash: string,
): void {
  const lastStored = stored.records[stored.records.length - 1];
  const offset = lastStored ? lastStored.seq : 0;
  const carried = candidate.journal.map((record, index) => ({
    ...record,
    seq: offset + index + 1,
  }));
  session = {
    traceKey: stored.traceKey,
    completeness: stored.meta.traceCompleteness,
    startedAtDay: stored.meta.startedAtDay,
    initialState: structuredClone(stored.initialState),
    journal: [...stored.records, ...carried],
    seq: offset + carried.length,
    adopting: false,
  };
  setTraceStatus(toStatus(session));
  // 尾哈希取最终 journal tail：窗口期已有新动作时，载入时的 stateHash 已过期，
  // 否则认领后立即刷新会因 meta 落后而误判不连续
  const carriedTail = carried[carried.length - 1];
  void commitTraceBatch(
    toStoredMeta(session, carriedTail ? carriedTail.afterStateHash : stateHash),
    carried,
  );
}

/**
 * 清除当前轨迹（内存 + IndexedDB）。
 *
 * @param currentState 当前游戏状态；提供时以 partial 立即重建会话继续记录
 */
export async function clearDebugTrace(currentState?: PlayerSave): Promise<void> {
  if (!DEBUG_TRACE_ENABLED) return;
  pending = null;
  const removedKey = session?.traceKey ?? null;
  session = null;
  setTraceStatus(null);
  if (removedKey) await clearTrace(removedKey);
  if (currentState) debugTraceAdoptLoadedSave(currentState);
}

/**
 * 读取会话快照（导出器使用；返回内部引用，勿修改）。
 *
 * @returns 会话数据；无活动轨迹时为 null
 */
export function getDebugTraceSession(): {
  traceKey: string;
  completeness: TraceCompleteness;
  startedAtDay: number;
  initialState: PlayerSave;
  journal: DebugActionRecord[];
} | null {
  return session
    ? {
        traceKey: session.traceKey,
        completeness: session.completeness,
        startedAtDay: session.startedAtDay,
        initialState: session.initialState,
        journal: session.journal,
      }
    : null;
}
