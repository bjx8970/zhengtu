/**
 * 个人任务制引擎（科员阶段工作模型）
 *
 * 核心职责：
 * 1. describePersonalTaskAvailability — 评估任务前置条件（职务阶段/职级/资历/事实）
 * 2. validatePersonalTaskStart — 校验并安排任务入槽（分类、预算、重复、冷却、槽位）
 * 3. applyPersonalTaskKpiEffects — 将任务 KPI 贡献写入个人工作隐藏台账
 *
 * 个人任务与部门行动共用槽位调度与统一时间轴（复用 SlotOccupant），
 * 本模块只提供任务语义的纯函数校验与台账结算，不复制调度引擎。
 */

import type { PersonalTaskKpiEffect, PersonalTaskTemplate } from '../../types/config';
import type { DepartmentState, SlotTierKey } from '../../types/player';
import { PERSONAL_TASK_LEDGER_ID } from '../../types/player';
import type { PersonalTaskStartInput, StartActionResult } from '../../types/game';
import type { ActionExecutableSnapshot } from '../../types/player';
import type { CivilServiceRank, LeadershipRank } from '../../domain/career/types';
import { isCivilServiceRankAtLeast } from '../../domain/career/types';

const TIER_ORDER: SlotTierKey[] = ['primary', 'secondary', 'reserve'];

/** 个人任务前置条件评估上下文（由调用方从 PlayerSave 派生） */
export interface PersonalTaskAvailabilityContext {
  leadershipRank: LeadershipRank;
  civilServiceRank: CivilServiceRank;
  totalCompletedTasks: number;
  /** 持久化世界事实（world.facts），缺项视为未满足 */
  facts: Readonly<Record<string, boolean | number | string | null>>;
}

/** 前置条件评估结果 */
export interface PersonalTaskAvailability {
  available: boolean;
  /** 不可承接的原因（UI 展示用） */
  reason?: string;
}

/**
 * 评估个人任务的前置条件是否满足。
 *
 * @param task 任务模板
 * @param context 玩家当前阶段上下文
 * @returns 是否可承接及不可承接原因
 */
export function describePersonalTaskAvailability(
  task: PersonalTaskTemplate,
  context: PersonalTaskAvailabilityContext,
): PersonalTaskAvailability {
  const prerequisites = task.prerequisites;
  if (!prerequisites) return { available: true };

  if (
    prerequisites.allowedLeadershipRanks &&
    !prerequisites.allowedLeadershipRanks.includes(context.leadershipRank)
  )
    return { available: false, reason: '当前职务阶段不可承接' };

  if (prerequisites.civilServiceRankMin) {
    if (!isCivilServiceRankAtLeast(context.civilServiceRank, prerequisites.civilServiceRankMin))
      return { available: false, reason: '职级尚未达到要求' };
  }

  if (
    prerequisites.minCompletedTasks !== undefined &&
    context.totalCompletedTasks < prerequisites.minCompletedTasks
  )
    return { available: false, reason: `需先完成 ${prerequisites.minCompletedTasks} 项任务` };

  if (prerequisites.requiredFacts) {
    // 契约为"必须为真"的布尔事实：false/数值/字符串/缺失一律视为未满足，
    // 避免 #121/#122 消费时把已证伪事实误判为满足。
    for (const factId of prerequisites.requiredFacts) {
      if (context.facts[factId] !== true) return { available: false, reason: '尚不满足承接条件' };
    }
  }

  return { available: true };
}

/**
 * 判断任务是否允许同 ID 实例并行（首份完成前再次承接）。
 *
 * once 任务整局仅可完成一次，并行会结算多次，契约优先于配置，恒为否；
 * 其余任务缺省按分类推导（routine 可并行，major/minor 不可），
 * 可由配置的 allowParallel 显式覆盖。
 *
 * @param task 任务模板
 * @returns 是否允许并行承接
 */
export function taskAllowsParallel(task: PersonalTaskTemplate): boolean {
  if (task.repeatPolicy === 'once') return false;
  return task.allowParallel ?? task.category === 'routine';
}

/**
 * 校验任务分类、预算、重复性、冷却和玩家选择的槽位。
 *
 * 与部门行动 startAction 的规则对齐：major 仅主要槽位、预算不足拒绝、
 * 非 routine 检查重复与冷却、所选槽位等级须有空位。
 *
 * @param input 任务、槽位状态、冷却及玩家选择槽位的不可变输入
 * @returns 成功时返回槽位位置；失败时返回错误信息
 */
export function validatePersonalTaskStart(input: PersonalTaskStartInput): StartActionResult {
  const {
    task,
    slotState,
    remainingBudget,
    currentDay,
    tierKey,
    cooldownUntilDay,
    completedCount,
  } = input;

  if (task.category === 'major' && tierKey !== 'primary') {
    return { success: false, error: '重大任务只能使用主要槽位' };
  }

  if (remainingBudget < task.budgetDelta) {
    return { success: false, error: '预算不足' };
  }

  if (task.repeatPolicy === 'once' && completedCount > 0) {
    return { success: false, error: '该任务已完成后不可再次承接' };
  }

  // 并行规则是任务配置语义（allowParallel，缺省按分类推导）；
  // once 任务恒不允许并行：首份尚未完成时 completedCount 仍为 0，
  // 若放行会在结算时完成多次，违反"整局仅可完成一次"契约。
  if (!taskAllowsParallel(task)) {
    const duplicate = TIER_ORDER.some((key) =>
      slotState[key].occupants.some(
        (occupant) => occupant?.actionId === task.id && occupant.deptId === PERSONAL_TASK_LEDGER_ID,
      ),
    );
    if (duplicate) {
      return { success: false, error: '该任务已在执行中' };
    }
  }

  if (task.category !== 'routine') {
    if (currentDay < cooldownUntilDay) {
      return { success: false, error: `任务冷却中，需等待至第 ${cooldownUntilDay} 天` };
    }
  }

  const slotIndex = slotState[tierKey].occupants.findIndex((occupant) => occupant === null);
  if (slotIndex === -1) {
    return { success: false, error: '所选槽位等级无空闲槽位' };
  }

  return { success: true, tierKey, slotIndex };
}

/**
 * 将任务 KPI 贡献写入个人工作隐藏台账（departmentStates 的保留条目）。
 *
 * 台账参与现有 calculateKPI 聚合，随任命变更整体重置；
 * 条目缺失时惰性创建，无需在初始状态预置。
 *
 * @param departmentStates 可变的部门状态表
 * @param kpiEffects 任务的 KPI 贡献列表
 * @returns 供完成通知展示的变更标签
 */
export function applyPersonalTaskKpiEffects(
  departmentStates: Record<string, DepartmentState>,
  kpiEffects: readonly PersonalTaskKpiEffect[],
): string[] {
  const ledger = departmentStates[PERSONAL_TASK_LEDGER_ID];
  if (ledger) {
    return applyKpiEffectsToLedger(ledger.kpiValues, kpiEffects);
  }
  departmentStates[PERSONAL_TASK_LEDGER_ID] = {
    id: PERSONAL_TASK_LEDGER_ID,
    kpiValues: {},
    monthlyConsumption: 0,
    cumulativeConsumption: 0,
    lastActionDay: 0,
    actionCooldownUntilDays: {},
  };
  return applyKpiEffectsToLedger(departmentStates[PERSONAL_TASK_LEDGER_ID].kpiValues, kpiEffects);
}

function applyKpiEffectsToLedger(
  kpiValues: Record<string, number>,
  kpiEffects: readonly PersonalTaskKpiEffect[],
): string[] {
  const labels: string[] = [];
  for (const effect of kpiEffects) {
    const current = kpiValues[effect.indicatorId] ?? 0;
    kpiValues[effect.indicatorId] =
      effect.operation === 'set'
        ? effect.value
        : effect.operation === 'multiply'
          ? current * effect.value
          : current + effect.value;
    labels.push(`${effect.indicatorId} ${effect.operation} ${effect.value}`);
  }
  return labels;
}

/**
 * 判断槽位占用记录是否为个人任务（按快照判别，不依赖冗余标志）。
 *
 * @param occupant 槽位占用记录
 * @returns 是否个人任务
 */
export function isPersonalTaskOccupant(
  occupant: Readonly<{ deptId: string; executableSnapshot: ActionExecutableSnapshot }>,
): boolean {
  return occupant.deptId === PERSONAL_TASK_LEDGER_ID && 'task' in occupant.executableSnapshot;
}
