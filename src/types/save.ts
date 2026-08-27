/**
 * 存档版本类型定义
 *
 * 存档外层封装和严格解码基础设施。
 * SaveEnvelope 包裹 PlayerSave，提供 schema 版本追踪和不兼容拒绝能力。
 *
 * Schema 13：当前版本，新增 Vacancy 终态审计字段及 CareerOpportunity vacancyId。
 * Schema 12：新增 NPC 离任事实账本。
 * Schema 10：新增个人任务制运行时状态（actions.personalTasks）。
 * Schema 9：试用期生命周期与评估审计。
 * Schema 2：确定性迁移至 Schema 3（治理指标空对象兼容）。
 * Schema 1：拒绝并保留原始只读备份（不实现自动迁移）。
 * 未来 Schema：拒绝。
 */

import type { PlayerSave } from './player';

/** 当前存档 Schema 版本号，每次不兼容变更递增 */
export const CURRENT_SCHEMA_VERSION = 13;

/** 受支持可迁移的最低 Schema 版本（低于此版本拒绝） */
export const MIN_MIGRATABLE_SCHEMA_VERSION = 2;

/** 当前内容版本号，用于标识配置/内容包的版本（格式：YYYY.MM.REVISION） */
export const CURRENT_CONTENT_VERSION = '2026.08.8';

/**
 * 存档外层封装
 *
 * 所有持久化存档均以此结构存储，提供：
 * - schemaVersion：存档结构版本，用于兼容性判断
 * - contentVersion：内容包版本
 * - revision：同一 schemaVersion 内的修订计数
 * - savedAt：存档写入的 Unix 时间戳
 * - state：实际游戏状态
 */
export interface SaveEnvelope {
  schemaVersion: number;
  contentVersion: string;
  revision: number;
  savedAt: number;
  state: PlayerSave;
}

/** 存档解码错误类型 */
export type SaveDecodeError =
  | 'invalid_json'
  | 'legacy_save_unsupported'
  | 'future_version'
  | 'invalid_envelope'
  | 'migration_failed';

/** 存档解码结果 */
export interface SaveDecodeResult {
  success: boolean;
  state?: PlayerSave;
  error?: SaveDecodeError;
  /** 错误详情（用于日志） */
  detail?: string;
  /** 不兼容存档的备份 key */
  backupKey?: string;
}
