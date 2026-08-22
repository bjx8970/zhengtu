/**
 * 行动可执行快照构建器。
 *
 * Store 在行动启动或旧存档迁移时调用；完成事务只消费快照，
 * 从而避免内容配置变更影响已经开始的行动。
 */

import type {
  ActionTemplate,
  DepartmentConfig,
  GameConfig,
  PersonalTaskTemplate,
} from '../types/config';
import type {
  ActionExecutableSnapshot,
  DepartmentActionExecutableSnapshot,
  PersonalTaskExecutableSnapshot,
} from '../types/player';
import { PERSONAL_TASK_LEDGER_ID } from '../types/player';

/**
 * 冻结行动完成所需的完整配置语义。
 *
 * @param department 行动所属部门配置
 * @param action 行动配置
 * @param contentVersion 快照对应的内容包版本
 * @param attributeBounds 行动效果结算使用的属性边界
 * @returns 与当前配置对象完全隔离的可持久化快照
 */
export function createActionExecutableSnapshot(
  department: Pick<DepartmentConfig, 'id' | 'name'>,
  action: ActionTemplate,
  contentVersion: string,
  attributeBounds: GameConfig['attributeBounds'],
): DepartmentActionExecutableSnapshot {
  return structuredClone({
    contentVersion,
    department: {
      id: department.id,
      name: department.name,
    },
    action,
    attributeBounds,
  });
}

/**
 * 冻结个人任务完成所需的完整配置语义。
 *
 * 个人任务不属于任何真实部门，department 固定为台账哨兵；
 * 完成事务按快照内是否携带 task 判别结算分支。
 *
 * @param task 任务配置
 * @param contentVersion 快照对应的内容包版本
 * @param attributeBounds 任务效果结算使用的属性边界
 * @returns 与当前配置对象完全隔离的可持久化快照
 */
export function createPersonalTaskExecutableSnapshot(
  task: PersonalTaskTemplate,
  contentVersion: string,
  attributeBounds: GameConfig['attributeBounds'],
): PersonalTaskExecutableSnapshot {
  return structuredClone({
    contentVersion,
    department: {
      id: PERSONAL_TASK_LEDGER_ID,
      name: '个人任务',
    },
    task,
    attributeBounds,
  });
}

/** 类型守卫：快照为部门行动（供结算事务与存档校验使用）。 */
export function isDepartmentActionSnapshot(
  snapshot: ActionExecutableSnapshot,
): snapshot is DepartmentActionExecutableSnapshot {
  return 'action' in snapshot;
}
