/**
 * 存档版本与迁移类型定义
 *
 * v4 基础工程引入的存档外层封装、版本标识和迁移基础设施。
 * SaveEnvelope 包裹 PlayerSave，提供 schema 版本追踪和安全迁移能力。
 */

import type { PlayerSave } from './player';

/** 当前存档 Schema 版本号，每次不兼容变更递增 */
export const CURRENT_SCHEMA_VERSION = 1;

/** 当前内容版本号，用于标识配置/内容包的版本 */
export const CURRENT_CONTENT_VERSION = '4.0.0-alpha';

/**
 * 存档外层封装
 *
 * 所有持久化存档均以此结构存储，提供：
 * - schemaVersion：存档结构版本，用于迁移判断
 * - contentVersion：内容包版本，用于兼容性提示
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

/** 存档迁移函数签名：接收旧状态，返回新状态 */
export type MigrationFn = (state: Record<string, unknown>) => Record<string, unknown>;

/** 单个版本迁移定义 */
export interface MigrationStep {
  /** 源版本号（从此版本迁移） */
  fromVersion: number;
  /** 目标版本号（迁移到此版本） */
  toVersion: number;
  /** 迁移描述 */
  description: string;
  /** 迁移函数 */
  migrate: MigrationFn;
}

/** 迁移结果 */
export type MigrationResult =
  | { success: true; state: PlayerSave; migratedFrom: number }
  | { success: false; error: string; backup: string | null };
