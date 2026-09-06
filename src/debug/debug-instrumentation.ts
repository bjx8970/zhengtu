/**
 * Debug 动作注入
 *
 * 在 dispatch 边界把 GameAction 的 `_rng` / `_idFactory` 替换为记录型包装：
 * reducer 内部全部走 `payload._rng ?? Math.random` / `payload._idFactory ?? createDefaultIdFactoryFor(...)`
 * 的回退模式，生产端 dispatch 通常不携带这两个字段，因此必须**总是注入**
 * 包装实现（调用方已提供时包装之，未提供时包装与 reducer 完全一致的默认实现），
 * 否则回退分支会产生未录制的随机数/ID，破坏确定性重放。
 *
 * 默认工厂经 `runtime-dependencies` 按动作类型解析出与 reducer 相同的领域
 * 前缀（timeline/event/policy/rank/career/task/action），因此本模块是纯
 * 旁路观察：Debug 开启前后产生的运行时 ID 语义完全一致。
 */

import type { GameAction } from '../types/game';
import { createDefaultIdFactoryFor } from '../store/runtime-dependencies';

/** 单次动作的随机性与 ID 捕获容器 */
export interface DebugCapture {
  /** 按消费顺序记录的随机数 */
  randomDraws: number[];
  /** 按生成顺序记录的运行时 ID */
  generatedIds: string[];
}

/**
 * 创建空的捕获容器。
 *
 * @returns 空 randomDraws / generatedIds 的捕获容器
 */
export function createDebugCapture(): DebugCapture {
  return { randomDraws: [], generatedIds: [] };
}

/**
 * 包装动作的 `_rng` / `_idFactory`，把每次调用结果记入 capture。
 *
 * 对支持这两个字段的动作总是注入：字段缺失或非函数时以 reducer 的真实默认
 * （Math.random / 按动作类型解析的领域前缀 ID 工厂）为源，保证 reducer
 * 不再走未记录的回退分支，且领域 ID 前缀与关闭 Debug 时完全一致。
 *
 * @param action 原始动作
 * @param capture 捕获容器（由 recorder 创建并随动作生命周期收口）
 * @returns 交给 reducer 的动作（注入不影响业务参数）
 */
export function instrumentGameAction(action: GameAction, capture: DebugCapture): GameAction {
  const sourceRng =
    '_rng' in action && typeof action._rng === 'function' ? action._rng : Math.random;
  const sourceIdFactory =
    '_idFactory' in action && typeof action._idFactory === 'function'
      ? action._idFactory
      : createDefaultIdFactoryFor(action.type);

  const wrapped = { ...action } as GameAction;
  (wrapped as { _rng?: () => number })._rng = () => {
    const drawn = sourceRng();
    capture.randomDraws.push(drawn);
    return drawn;
  };
  (wrapped as { _idFactory?: () => string })._idFactory = () => {
    const id = sourceIdFactory();
    capture.generatedIds.push(id);
    return id;
  };
  return wrapped;
}

/**
 * 序列化动作为纯数据对象（剥离函数字段）。
 *
 * `_rng` / `_idFactory` 的调用结果进入 randomDraws / generatedIds，
 * 函数本身不属于可序列化业务输入，不得进入日志。
 *
 * @param action 原始动作
 * @returns 无函数字段的键值对象（可直接 JSON 序列化）
 */
export function serializeAction(action: GameAction): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action)) {
    if (typeof value === 'function') continue;
    output[key] = value;
  }
  return output;
}
