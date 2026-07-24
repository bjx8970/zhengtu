/**
 * Store 运行时 ID 工厂
 *
 * 为一次 reducer 事务提供共享工厂，并在不同 dispatch/页面会话间避免 ID 冲突。
 */

let fallbackSequence = 0;

/**
 * 创建生产运行时 ID 工厂。
 *
 * @param prefix ID 前缀
 * @returns 每次调用生成唯一 ID 的函数
 */
export function createRuntimeIdFactory(prefix: string): () => string {
  return () => {
    const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    if (randomUUID) return `${prefix}_${randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${fallbackSequence++}`;
  };
}
