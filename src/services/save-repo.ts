/**
 * 存档仓库
 *
 * 本版本不兼容任何旧存档，不提供自动迁移。
 * 仅支持当前 schemaVersion 的完整 SaveEnvelope。
 *
 * Supabase 读写及本地/远程仲裁函数保留给后续云存档阶段。
 */

import type { PlayerSave } from '../types/player';
import type { SaveEnvelope, SaveDecodeResult } from '../types/save';
import { getSupabase } from './supabase';
import { decodeCurrentSave, wrapSaveEnvelope } from '../store/save-codec';

const TABLE_NAME = 'game_saves';
const SLOT_NAME = 'main';
const LOCAL_KEY = 'zhengtu_autosave';

/** 本地存档加载结果 */
export type LocalSaveLoadResult =
  | { status: 'loaded'; state: PlayerSave }
  | { status: 'empty' }
  | { status: 'incompatible' | 'corrupted'; detail: string; backupKey?: string };

/**
 * 从 localStorage 读取本地存档。
 *
 * 使用严格解码器，只接受当前版本的完整 SaveEnvelope。
 * 返回结构化结果，便于 UI 显示不兼容提示。
 *
 * @returns 结构化加载结果
 */
export function readLocalSave(): LocalSaveLoadResult {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { status: 'empty' };

    const result: SaveDecodeResult = decodeCurrentSave(raw);

    if (result.success && result.state) {
      return { status: 'loaded', state: result.state };
    }

    // 不兼容或损坏
    const status = result.error === 'legacy_save_unsupported' ? 'incompatible' : 'corrupted';
    return {
      status,
      detail: result.detail ?? '存档无法加载',
      backupKey: result.backupKey,
    };
  } catch (err) {
    return { status: 'corrupted', detail: `读取存档失败: ${err}` };
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
    // 读取现有 revision（只接受非负有限整数）
    let revision = 0;
    const existing = localStorage.getItem(LOCAL_KEY);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as Partial<SaveEnvelope>;
        const candidate = parsed.revision;
        revision =
          Number.isInteger(candidate) && (candidate as number) >= 0 ? (candidate as number) : 0;
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

  // 使用相同的严格解码器
  const result = decodeCurrentSave(JSON.stringify(data.save_data));
  if (result.success && result.state) {
    return result.state;
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
