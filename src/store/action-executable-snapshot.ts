/**
 * 行动可执行快照构建器。
 *
 * Store 在行动启动或旧存档迁移时调用；完成事务只消费快照，
 * 从而避免内容配置变更影响已经开始的行动。
 */

import type { ActionTemplate, DepartmentConfig, GameConfig } from '../types/config';
import type { ActionExecutableSnapshot } from '../types/player';

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
): ActionExecutableSnapshot {
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
