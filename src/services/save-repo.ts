/**
 * 存档仓库
 *
 * 提供游戏存档的读写和仲裁逻辑：
 * - 本地存储（localStorage）：作为即时恢复备份
 * - 远程存储（Supabase game_saves 表）：作为权威数据源
 *
 * 持久化发生时点：在阶段提交（玩家点击"推进时间"）后调用 upsertSave()
 * 加载仲裁逻辑：比较本地与远程的 updatedAt，取较新的版本
 */

import type { PlayerSave } from '../types/player';
import { getSupabase } from './supabase';

const TABLE_NAME = 'game_saves';
const SLOT_NAME = 'main';
const LOCAL_KEY = 'zhengtu_autosave';

/**
 * 校验 JSON 解析结果是否为合法的 PlayerSave 对象。
 */
function isValidPlayerSave(data: unknown): data is PlayerSave {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  const slots = obj.slots as Record<string, unknown> | undefined;
  const time = obj.time as Record<string, unknown> | undefined;
  return (
    typeof obj.currentPositionId === 'string' &&
    typeof obj.currentLevel === 'number' &&
    typeof obj.characterName === 'string' &&
    typeof slots?.primary === 'object' &&
    typeof slots?.secondary === 'object' &&
    typeof slots?.reserve === 'object' &&
    Array.isArray((slots.primary as Record<string, unknown>)?.occupants) &&
    typeof time?.year === 'number'
  );
}

/** 从 localStorage 读取本地存档 */
export function readLocalSave(): PlayerSave | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidPlayerSave(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 写入 localStorage（失败时静默忽略） */
export function writeLocalSave(save: PlayerSave): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(save));
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

  return isValidPlayerSave(data.save_data) ? (data.save_data as PlayerSave) : null;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { error } = await sb.from(TABLE_NAME).upsert(
    {
      user_id: save.userId,
      slot_name: SLOT_NAME,
      save_data: save,
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
