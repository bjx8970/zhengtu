/**
 * Debug Trace 持久层（IndexedDB sidecar）
 *
 * 与正式存档（zhengtu_autosave / Supabase）完全隔离：
 * - 数据库 `zhengtu-debug`，object store `traces`（按 traceKey 存元数据+初始状态）
 *   与 `journal`（append-only 操作日志，按 traceKey 建索引）。
 * - 全部 API 失败时仅 console.warn，绝不影响游戏主流程。
 * - 运行环境无 IndexedDB（如 jsdom 测试）时自动降级为 no-op。
 */

import type { DebugActionRecord, DebugMetadata } from './debug-types';
import type { PlayerSave } from '../types/player';

const DB_NAME = 'zhengtu-debug';
const DB_VERSION = 1;
const TRACE_STORE = 'traces';
const JOURNAL_STORE = 'journal';
const TRACE_KEY_INDEX = 'traceKey';

/** traceKey 兜底前缀（旧存档无 saveId 时生成的临时轨迹标识） */
export const LEGACY_TRACE_PREFIX = 'legacy';

/** traceKey 分支前缀（saveId 命中但末状态不连续的回滚备份使用，避免污染原轨迹） */
export const BRANCH_TRACE_PREFIX = 'branch';

/** traces store 中的一条元数据记录 */
export interface StoredTraceMeta {
  /** 轨迹标识：优先 character.saveId，旧档为 legacy-*，回滚备份分支为 branch-* */
  traceKey: string;
  /** Bundle 元信息 */
  meta: DebugMetadata;
  /** 轨迹起点状态快照（重放起点） */
  initialState: PlayerSave;
  /** 最近一次提交后的状态哈希（用于载入存档时认领既有轨迹） */
  lastStateHash: string;
}

/** journal store 中的一条日志记录（id 为自增主键） */
export interface StoredJournalRecord {
  id?: number;
  traceKey: string;
  record: DebugActionRecord;
}

/** 运行环境是否支持 IndexedDB。 */
function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * 将 IDBRequest 包装为 Promise。
 *
 * @param request IDB 请求对象
 * @returns 请求结果
 */
function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 等待事务完成（全部请求成功提交后 resolve）。
 *
 * @param tx IDB 事务
 * @returns 事务提交完成后 resolve
 */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 已打开数据库的共享 Promise（打开失败后重置以支持重试） */
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * 打开（或创建）调试数据库。
 *
 * @returns IDBDatabase 实例
 */
function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TRACE_STORE)) {
          db.createObjectStore(TRACE_STORE, { keyPath: 'traceKey' });
        }
        if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
          const journal = db.createObjectStore(JOURNAL_STORE, {
            keyPath: 'id',
            autoIncrement: true,
          });
          journal.createIndex(TRACE_KEY_INDEX, 'traceKey', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/**
 * 在失败时输出警告（不打断游戏流程）。
 *
 * @param operation 操作名
 * @param error 捕获到的错误
 */
function warn(operation: string, error: unknown): void {
  console.warn(`[debug-trace] ${operation} 失败`, error);
}

/**
 * 写入（覆盖）轨迹元数据与初始状态快照。
 *
 * @param meta 轨迹元数据记录
 * @returns 完成后 resolve；失败时静默
 */
export async function persistTraceMeta(meta: StoredTraceMeta): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction(TRACE_STORE, 'readwrite');
    await promisify(tx.objectStore(TRACE_STORE).put(meta));
  } catch (error) {
    warn('persistTraceMeta', error);
  }
}

/**
 * 追加日志并更新元数据 —— 单个跨 store 原子事务。
 *
 * journal 追加与 meta 覆盖要么同时生效、要么同时失败，避免浏览器在两次
 * 独立事务之间退出时留下「meta 尾哈希已前进但 journal 缺尾记录」的组合
 * （认领连续性判断依赖 meta.lastStateHash 与 journal tail 一致）。
 *
 * @param meta 轨迹元数据（lastStateHash 必须等于 records 末条的 afterStateHash）
 * @param records 本批次追加的操作记录（按 seq 升序）
 * @returns 完成后 resolve；失败时静默
 */
export async function commitTraceBatch(
  meta: StoredTraceMeta,
  records: DebugActionRecord[],
): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction([TRACE_STORE, JOURNAL_STORE], 'readwrite');
    const journal = tx.objectStore(JOURNAL_STORE);
    for (const record of records) {
      journal.add({ traceKey: meta.traceKey, record } satisfies StoredJournalRecord);
    }
    tx.objectStore(TRACE_STORE).put(meta);
    await transactionDone(tx);
  } catch (error) {
    warn('commitTraceBatch', error);
  }
}

/**
 * 读取完整轨迹（元数据 + 初始状态 + 全部日志）。
 *
 * @param traceKey 轨迹标识
 * @returns 轨迹数据；不存在或环境不支持时为 null
 */
export async function loadStoredTrace(
  traceKey: string,
): Promise<(StoredTraceMeta & { records: DebugActionRecord[] }) | null> {
  if (!hasIndexedDb()) return null;
  try {
    const db = await openDatabase();
    const tx = db.transaction([TRACE_STORE, JOURNAL_STORE], 'readonly');
    const meta = await promisify(
      tx.objectStore(TRACE_STORE).get(traceKey) as IDBRequest<StoredTraceMeta | undefined>,
    );
    if (!meta) return null;
    const index = tx.objectStore(JOURNAL_STORE).index(TRACE_KEY_INDEX);
    const stored = await promisify(index.getAll(traceKey) as IDBRequest<StoredJournalRecord[]>);
    return { ...meta, records: stored.map((item) => item.record) };
  } catch (error) {
    warn('loadStoredTrace', error);
    return null;
  }
}

/**
 * 按「最近一次提交后的状态哈希」查找既有轨迹（用于载入存档时认领）。
 *
 * @param stateHash 当前存档状态哈希
 * @returns 匹配的 traceKey；未找到或环境不支持时为 null
 */
export async function findTraceKeyByStateHash(stateHash: string): Promise<string | null> {
  if (!hasIndexedDb()) return null;
  try {
    const db = await openDatabase();
    const tx = db.transaction(TRACE_STORE, 'readonly');
    const all = await promisify(
      tx.objectStore(TRACE_STORE).getAll() as IDBRequest<StoredTraceMeta[]>,
    );
    const matched = all.find((item) => item.lastStateHash === stateHash);
    return matched ? matched.traceKey : null;
  } catch (error) {
    warn('findTraceKeyByStateHash', error);
    return null;
  }
}

/**
 * 清除指定轨迹（元数据 + 全部日志）。
 *
 * @param traceKey 轨迹标识
 * @returns 完成后 resolve；失败时静默
 */
export async function clearTrace(traceKey: string): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openDatabase();
    const tx = db.transaction([TRACE_STORE, JOURNAL_STORE], 'readwrite');
    await promisify(tx.objectStore(TRACE_STORE).delete(traceKey));
    const index = tx.objectStore(JOURNAL_STORE).index(TRACE_KEY_INDEX);
    const keys = await promisify(index.getAllKeys(traceKey) as IDBRequest<IDBValidKey[]>);
    const store = tx.objectStore(JOURNAL_STORE);
    for (const key of keys) {
      store.delete(key);
    }
  } catch (error) {
    warn('clearTrace', error);
  }
}
