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
import type { LocalSaveLoadResult } from './startup-save-state';
import { getSupabase } from './supabase';
import { decodeCurrentSave, wrapSaveEnvelope } from '../store/save-codec';
import { getConfigLoader } from '../config/loader';
import { INSTITUTION_LEVELS } from '../domain/career/types';
import type { PositionConfigV2 } from '../types/position-v2';

const TABLE_NAME = 'game_saves';
const SLOT_NAME = 'main';
const LOCAL_KEY = 'zhengtu_autosave';

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

    // 按错误类别分别返回
    const detail = result.detail ?? '存档无法加载';
    const backupKey = result.backupKey;
    switch (result.error) {
      case 'legacy_save_unsupported':
        return { status: 'legacy', detail, backupKey };
      case 'future_version':
        return { status: 'future', detail, backupKey };
      default:
        return { status: 'corrupted', detail, backupKey };
    }
  } catch (err) {
    return { status: 'corrupted', detail: `读取存档失败: ${err}` };
  }
}

/**
 * 写入 localStorage。
 *
 * 使用 SaveEnvelope 封装，包含 schemaVersion。
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
 * 构建远程存档的结构化索引列（兼容投影）。
 *
 * 历史背景：`current_level` / `current_career_line` 是旧 Schema 的索引列，
 * 原义分别为“职业等级（1-11）”与“职业线”。Schema 2 已移除这两个概念，
 * 但数据库列仍存在且被存档列表/筛选使用。这里建立明确的兼容投影：
 * - `current_level` ← 当前职位的机构层级序数（1=乡镇 … 5=中央，职业事实）
 * - `current_career_line` ← 当前职位的岗位领域（positionDomain）
 *
 * 该投影仅为列表展示提供近似值，不代表精确职业语义；
 * 后续云存档阶段应迁移列为 content_tier / position_domain。
 *
 * @param position 当前职位配置
 * @returns 索引列投影值
 */
export function buildRemoteIndexColumns(position: PositionConfigV2): {
  current_level: number;
  current_career_line: string;
} {
  // 机构层级序数（1-based）：INSTITUTION_LEVELS 已按从低到高排序
  const levelOrdinal = INSTITUTION_LEVELS.indexOf(position.institutionLevel) + 1;
  return {
    current_level: levelOrdinal,
    current_career_line: position.positionDomain,
  };
}

/**
 * 校验 revision 为非负有限整数，非法值返回 null。
 *
 * @param value 待校验值
 * @returns 合法的 revision 或 null
 */
export function normalizeRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * 保存存档：远程写入成功后同步本地备份。
 * Supabase 不可用时降级为纯本地存储。
 *
 * revision 语义（最佳努力，非原子）：读取现有远程 envelope 的 revision 并 +1。
 * 该值为单调递增计数器，不承担并发仲裁职责（仲裁使用 updatedAt）；
 * 读改写非原子，并发保存可能产生相同 revision，不保证严格递增。
 * 读取失败时明确失败（不猜测 revision），避免远端 revision 倒退。
 */
export async function upsertSave(save: PlayerSave): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    writeLocalSave(save);
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // 读取现有远程 envelope 的 revision，用于递增。
  // 严格区分“无记录”（revision=0）与“读取失败”（明确失败，不猜测）。
  const { data: existing, error: readError } = await sb
    .from(TABLE_NAME)
    .select('save_data')
    .eq('user_id', save.character.userId)
    .eq('slot_name', SLOT_NAME)
    .maybeSingle();
  if (readError) {
    console.error('Failed to read existing remote save revision:', readError.message);
    // 读取失败时不猜测 revision，避免以低 revision 覆盖远端。
    // 降级：保留本地备份，远程保存视为失败。
    writeLocalSave(save);
    return false;
  }

  // 无记录时 revision 从 0 开始；有记录时校验后递增。
  const rawRevision = existing?.save_data?.revision;
  const existingRevision = existing ? (normalizeRevision(rawRevision) ?? 0) : 0;

  // 使用 SaveEnvelope 封装（revision 递增）
  const envelope = wrapSaveEnvelope(save, existingRevision);

  // 从当前职位配置生成索引列投影。职位查不到时明确失败，不静默写 0。
  const position = getConfigLoader().getPositionById(save.career.appointment.positionId);
  if (!position) {
    console.error(
      `Cannot build remote index columns: position "${save.career.appointment.positionId}" not found in config`,
    );
    writeLocalSave(save);
    return false;
  }
  const indexColumns = buildRemoteIndexColumns(position);

  const { error } = await sb.from(TABLE_NAME).upsert(
    {
      user_id: save.character.userId,
      slot_name: SLOT_NAME,
      save_data: envelope,
      current_level: indexColumns.current_level,
      current_career_line: indexColumns.current_career_line,
      current_position_id: save.career.appointment.positionId,
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
