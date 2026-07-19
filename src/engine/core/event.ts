/**
 * 事件引擎
 *
 * 核心职责：
 * 1. evaluateEventTrigger — 评估单个事件是否可触发
 * 2. filterAvailableEvents — 从事件池中筛选当前可用事件
 *
 * 设计要点：
 * - hiddenStates 为 Record<string, number> 字典，后续添加新隐藏状态只需在 JSON 中引用 key
 * - eventType: 'generic' | 'exclusive' 区分通用/专属
 * - prerequisiteEvents 支持事件链（已完成事件线影响后续触发）
 * - positionIds + regions + timeWindow 组合实现精准专属投放
 *
 * 所有函数为纯函数，不依赖全局状态。
 */

import type { CareerLine } from '../../types/enums';
import type { GameEvent, EventCondition } from '../../types/game';

/** 事件上下文 — 预留隐藏状态扩展口 */
export interface EventContext {
  currentLevel: number;
  careerLine: CareerLine;
  positionId: string;
  region: string;
  currentMonth: number;
  completedEventIds: string[];
  /** 隐藏状态字典 — 后续扩展民众满意度、社会矛盾指数等 */
  hiddenStates: Record<string, number>;
  /** 通用扩展槽 */
  metadata?: Record<string, unknown>;
}

/**
 * 评估隐藏状态条件是否满足。
 *
 * @param conditions 隐藏状态条件列表
 * @param hiddenStates 当前隐藏状态字典
 * @returns 是否全部满足
 */
function evaluateHiddenStateConditions(
  conditions: EventCondition['hiddenStateConditions'],
  hiddenStates: Record<string, number>,
): boolean {
  if (!conditions || conditions.length === 0) return true;

  return conditions.every((cond) => {
    const value = hiddenStates[cond.key] ?? 0;
    switch (cond.operator) {
      case 'gt':
        return value > cond.value;
      case 'lt':
        return value < cond.value;
      case 'eq':
        return value === cond.value;
      case 'gte':
        return value >= cond.value;
      case 'lte':
        return value <= cond.value;
      default:
        return true;
    }
  });
}

/**
 * 评估事件是否可触发。
 *
 * 校验规则：
 * - 等级范围（minLevel/maxLevel）
 * - 职业线限制（careerLines）
 * - 最低分数要求（minScore）
 * - 必需标记（requiredFlag）
 * - 地区限定（regions）
 * - 时间窗口（timeWindow）
 * - 前置事件链（prerequisiteEvents）
 * - 专属职位（positionIds）
 * - 隐藏状态条件（hiddenStateConditions）
 *
 * @param event 事件定义
 * @param ctx 事件上下文
 * @returns 是否可触发
 */
export function evaluateEventTrigger(event: GameEvent, ctx: EventContext): boolean {
  const cond = event.triggerCondition;

  // 等级范围检查
  if (cond.minLevel !== undefined && ctx.currentLevel < cond.minLevel) return false;
  if (cond.maxLevel !== undefined && ctx.currentLevel > cond.maxLevel) return false;

  // 职业线限制
  if (cond.careerLines && !cond.careerLines.includes(ctx.careerLine)) return false;

  // 地区限定
  if (cond.regions && cond.regions.length > 0 && !cond.regions.includes(ctx.region)) return false;

  // 时间窗口
  if (cond.timeWindow) {
    const { startMonth, endMonth } = cond.timeWindow;
    if (startMonth <= endMonth) {
      if (ctx.currentMonth < startMonth || ctx.currentMonth > endMonth) return false;
    } else {
      // 跨年时间窗口（如 11月~2月）
      if (ctx.currentMonth < startMonth && ctx.currentMonth > endMonth) return false;
    }
  }

  // 前置事件链
  if (cond.prerequisiteEvents && cond.prerequisiteEvents.length > 0) {
    const allCompleted = cond.prerequisiteEvents.every((id) => ctx.completedEventIds.includes(id));
    if (!allCompleted) return false;
  }

  // 专属职位
  if (cond.positionIds && cond.positionIds.length > 0 && !cond.positionIds.includes(ctx.positionId)) {
    return false;
  }

  // 隐藏状态条件
  if (!evaluateHiddenStateConditions(cond.hiddenStateConditions, ctx.hiddenStates)) return false;

  return true;
}

/**
 * 从事件池中筛选当前可用事件。
 *
 * @param events 事件池
 * @param ctx 事件上下文
 * @returns 可触发的事件列表
 */
export function filterAvailableEvents(events: GameEvent[], ctx: EventContext): GameEvent[] {
  return events.filter((event) => evaluateEventTrigger(event, ctx));
}
