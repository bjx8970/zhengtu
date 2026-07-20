/**
 * 存档仓库
 *
 * v4 基础工程变更：
 * - 使用 SaveEnvelope 封装存档（含 schemaVersion）
 * - 加载时通过迁移管道处理旧版本存档
 * - 迁移失败时保留备份，不静默加载损坏状态
 *
 * Supabase 读写及本地/远程仲裁函数保留给后续云存档阶段。
 */

import type { PlayerSave } from '../types/player';
import type { SaveEnvelope } from '../types/save';
import { getSupabase } from './supabase';
import {
  migrateSave,
  wrapSaveEnvelope,
  validatePlayerSave,
  extractPlayerSave,
} from '../store/migrations';

const TABLE_NAME = 'game_saves';
const SLOT_NAME = 'main';
const LOCAL_KEY = 'zhengtu_autosave';

/** 迁移失败备份的 key 前缀 */
const MIGRATION_FAILED_KEY = 'zhengtu_migration_failed';

/**
 * 从 localStorage 读取本地存档。
 *
 * v4 变更：通过迁移管道处理旧版本存档。
 * 迁移失败时保存错误信息到 localStorage 并返回 null。
 *
 * @returns PlayerSave 或 null（无存档/迁移失败）
 */
export function readLocalSave(): PlayerSave | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;

    // 尝试通过迁移管道处理
    const result = migrateSave(raw);

    if (result.success) {
      return result.state;
    }

    // 迁移失败：记录错误，保留备份
    console.error('存档迁移失败:', result.error);
    if (result.backup) {
      localStorage.setItem(
        MIGRATION_FAILED_KEY,
        JSON.stringify({
          error: result.error,
          backupKey: result.backup,
          timestamp: Date.now(),
        }),
      );
    }
    return null;
  } catch (err) {
    console.error('读取存档失败:', err);
    return null;
  }
}

/**
 * 写入 localStorage。
 *
 * v4 变更：使用 SaveEnvelope 封装，包含 schemaVersion。
 *
 * @param save 游戏状态
 */
export function writeLocalSave(save: PlayerSave): void {
  try {
    // 读取现有 revision（如果存在）
    let revision = 0;
    const existing = localStorage.getItem(LOCAL_KEY);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as Partial<SaveEnvelope>;
        revision = parsed.revision ?? 0;
      } catch {
        // 忽略解析错误
      }
    }

    const envelope = wrapSaveEnvelope(save, revision);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(envelope));
  } catch {
    console.warn('Failed to write local save');
  }
}

/**
 * 校验 JSON 解析结果是否为合法的 PlayerSave 对象。
 *
 * @param data 待校验数据
 * @returns 是否为合法 PlayerSave
 */
function isValidPlayerSave(data: unknown): data is PlayerSave {
  const result = validatePlayerSave(data);
  return result.valid;
}

/** 从 Supabase 读取远程存档 */
export async function fetchRemoteSave(userId: string): Promise<PlayerSave | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from(TABLE_NAME)
    .select('save_data')
    .eq('user_id', userId)
    .eq('slot_name', SLOT_NAME)
    .single();

  if (error || !data) return null;

  // 尝试从 SaveEnvelope 或裸 PlayerSave 中提取
  const extracted = extractPlayerSave(data.save_data);
  if (extracted && isValidPlayerSave(extracted)) {
    return extracted;
  }

  return null;
}

/**
 * 保存存档：远程写入成功后同步本地备份。
 * Supabase 不可用时降级为纯本地存储。
 */
export async function upsertSave(save: PlayerSave): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    writeLocalSave(save);
    return true;
  }

  // 使用 SaveEnvelope 封装
  const envelope = wrapSaveEnvelope(save);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { error } = await sb.from(TABLE_NAME).upsert(
    {
      user_id: save.userId,
      slot_name: SLOT_NAME,
      save_data: envelope,
      current_level: save.currentLevel,
      current_career_line: save.currentCareerLine,
      current_position_id: save.currentPositionId,
      game_year: save.time.year,
      game_month: save.time.month,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,slot_name' },
  );

  if (error) {
    console.error('Failed to save to Supabase:', error.message);
    // 降级：即使远程失败也保留本地
    writeLocalSave(save);
    return false;
  }

  // 成功后同步本地备份
  writeLocalSave(save);
  return true;
}

/**
 * 选择较新的存档版本。
 * 用于加载时在本地和远程之间仲裁。
 */
export function selectNewer(a: PlayerSave | null, b: PlayerSave | null): PlayerSave | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return (a.updatedAt ?? 0) > (b.updatedAt ?? 0) ? a : b;
}

/**
 * 获取上次迁移失败的信息。
 *
 * @returns 迁移失败信息或 null
 */
export function getMigrationFailureInfo(): {
  error: string;
  backupKey: string;
  timestamp: number;
} | null {
  try {
    const raw = localStorage.getItem(MIGRATION_FAILED_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 清除迁移失败记录。
 */
export function clearMigrationFailureInfo(): void {
  localStorage.removeItem(MIGRATION_FAILED_KEY);
}
