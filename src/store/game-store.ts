/**
 * 游戏状态管理
 *
 * 核心设计：
 * 1. 单一 createStore<PlayerSave> 管理全部游戏状态
 * 2. 通过 dispatch(action) 修改状态，produce() 追踪变更
 * 3. 状态变更后组件自动细粒度响应（Solid 字段级追踪）
 * 4. 持久化不在此层：推进时间时由调用方触发 saveRepo
 *
 * 操作阶段 vs 提交阶段：
 * - 操作阶段（执行行动、处理文件、选择事件）：只修改 store，不持久化
 * - 提交阶段（推进时间）：一次性结算 + 保存
 */

import { createStore, produce, unwrap } from 'solid-js/store';
import type {
  CareerLine,
  PromotionStage,
  ReserveCadreTier,
  TimeGranularity,
  FileAction,
} from '../types/enums';
import type { PlayerSave, GameTime } from '../types/player';
import type { PromotionResult, TimeTrigger } from '../types/game';
import { getSlotLimits } from '../engine/core/action';
import { advanceTime } from '../engine/core/time';
import { monthlySettlement } from '../engine/governance/budget';
import { calculateKPI } from '../engine/governance/kpi';
import { annualAssessment as runAnnualAssessment } from '../engine/governance/assessment';
import { getConfigLoader } from '../config/loader';
import { getGranularityDays } from '../types/config';
import { clamp } from '../utils/math';

export type GameState = PlayerSave;

/** 创建默认时间状态 */
function getInitialTime(): GameTime {
  const cfg = getConfigLoader().getGameConfig();
  return { year: cfg.startYear, month: 1, day: 1, granularity: 'day' };
}

/**
 * 创建初始游戏状态。
 *
 * @param overrides 可选的部分覆盖（用于建档时注入角色信息）
 * @returns 完整初始 PlayerSave
 */
export function createInitialState(overrides?: Partial<PlayerSave>): PlayerSave {
  const cfg = getConfigLoader().getGameConfig();
  const slots = (() => {
    const m = getSlotLimits('day', cfg);
    return { max: m, available: m };
  })();

  return {
    saveId: '',
    userId: '',
    characterName: '',
    gender: '男',
    birthPlace: '',
    birthYear: 1990,
    education: '本科',
    motivation: '为民服务',
    personality: '稳健型',
    familyBackground: '普通家庭',
    currentPositionId: '',
    currentLevel: 1,
    currentCareerLine: 'admin' as CareerLine,
    yearsInCurrentPosition: 0,
    slots,
    politicalCapital: 0,
    remainingBudget: 1000,
    comprehensiveScore: 0,
    annualAssessments: [],
    integrity: 50,
    stability: 50,
    performance: 0,
    charisma: 50,
    competence: 50,
    promotionStage: 'idle' as PromotionStage,
    promotionAttempts: 0,
    frozenPeriods: 0,
    transferCount: cfg.initialTransferCount,
    isLineLocked: false,
    departmentStates: {},
    careerHistory: [],
    secretary: null,
    relations: {
      classmates: {},
      colleagues: {},
      business: {},
      academic: {},
      media: {},
      central: {},
    },
    factions: {
      alignment: 'independent',
      reputation: {
        reform: 0,
        pragmatic: 0,
        conservative: 0,
      },
    },
    superiorFavor: 20,
    reserveTier: 0 as ReserveCadreTier,
    demoralization: 0,
    corruptionRisk: 0,
    isUnderInvestigation: false,
    time: getInitialTime(),
    successor: null,
    thinkTank: { science: null, economics: null, law: null },
    mentees: [],
    achievements: [],
    totalActions: 0,
    totalDaysPlayed: 0,
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * 全局可派发的动作类型。
 *
 * 新增系统时在此 union 中添加对应的 action type。
 */
export type GameAction =
  | { type: 'EXECUTE_ACTION'; deptId: string; actionId: string }
  | { type: 'ADVANCE_TIME'; granularity: TimeGranularity }
  | { type: 'SET_GRANULARITY'; granularity: TimeGranularity }
  | { type: 'CHOOSE_EVENT_OPTION'; eventId: string; optionIndex: number }
  | { type: 'PROCESS_DOCUMENT'; docId: string; action: FileAction }
  | { type: 'START_PROMOTION'; targetPositionId: string }
  | { type: 'PROMOTION_RESOLVE_STAGE'; result: PromotionResult }
  | { type: 'LOAD_SAVE'; save: PlayerSave }
  | { type: 'NEW_GAME'; data: Record<string, unknown> };

// Solid 响应式 store
const [state, setState] = createStore<GameState>(createInitialState());

/**
 * 处理时间推进产生的周期事件触发器。
 *
 * monthly_settlement：执行预算月度结算
 * annual_assessment：执行 KPI 考核 + 年度评价
 *
 * 该方法直接修改 draft（在 produce 回调中调用）。
 */
function resolveTriggers(draft: PlayerSave, triggers: TimeTrigger[]): void {
  const loader = getConfigLoader();
  const position = loader.getPosition(
    draft.currentCareerLine,
    draft.currentLevel,
    // 从 positionId 提取索引：如 "admin_l3_0" → 2
    (() => {
      const parts = draft.currentPositionId.split('_');
      return parseInt(parts[parts.length - 1] ?? '0', 10);
    })(),
  );

  for (const trigger of triggers) {
    switch (trigger.type) {
      case 'monthly_settlement': {
        if (!position) break;
        // 扣除各消耗部门的预算
        const settlement = monthlySettlement(
          draft.departmentStates,
          position.departments,
          draft.remainingBudget,
        );
        draft.remainingBudget = settlement.newRemaining;

        // 更新各部门累计消耗和月度记录
        for (const dept of position.departments) {
          const ds = draft.departmentStates[dept.id];
          if (ds) {
            ds.monthlyConsumption = settlement.deptConsumptions[dept.id] ?? 0;
            ds.cumulativeConsumption += settlement.deptConsumptions[dept.id] ?? 0;
          }
        }
        break;
      }
      case 'annual_assessment': {
        if (!position) break;
        // KPI 考核
        const kpiResult = calculateKPI(position.kpiIndicators, draft.departmentStates);
        // 年度评价
        const assessment = runAnnualAssessment(kpiResult, draft.yearsInCurrentPosition);
        draft.comprehensiveScore = assessment.score;
        draft.frozenPeriods += assessment.frozenPeriods;
        draft.frozenPeriods = clamp(draft.frozenPeriods, 0, 5); // 最多冻结5届
        draft.annualAssessments.push({
          year: trigger.year ?? draft.time.year,
          score: assessment.score,
          tier: assessment.tier,
        });
        draft.yearsInCurrentPosition += 1;
        break;
      }
      default:
        // congress_cycle、retirement_check、random_event、sentiment_generate
        // Phase 3+ 实现
        break;
    }
  }
}

/** 读取当前状态（只读，组件自动追踪访问的字段） */
export function getState(): Readonly<GameState> {
  return state;
}

/** 获取纯对象快照（用于序列化/存档） */
export function getRawState(): PlayerSave {
  return unwrap(state);
}

/**
 * 派发动作修改游戏状态。
 *
 * 所有状态变更的唯一入口。引擎函数在此处被调用，
 * 结果通过 produce() 直接修改 draft，Solid 自动追踪变更并通知组件。
 */
export function dispatch(action: GameAction): void {
  setState(
    produce((draft) => {
      switch (action.type) {
        case 'SET_GRANULARITY': {
          const cfg = getConfigLoader().getGameConfig();
          const max = getSlotLimits(action.granularity, cfg);
          draft.time.granularity = action.granularity;
          draft.slots.max = max;
          draft.slots.available = max;
          break;
        }
        case 'EXECUTE_ACTION': {
          // Phase 2 实现：调用 actionEngine.execute() + 应用效果 + 推进天数
          break;
        }
        case 'ADVANCE_TIME': {
          const cfg = getConfigLoader().getGameConfig();
          const days = getGranularityDays(action.granularity, cfg);
          const timeResult = advanceTime(draft.time, days, draft.birthYear, draft.currentLevel);

          draft.time.year = timeResult.newState.year;
          draft.time.month = timeResult.newState.month;
          draft.time.day = timeResult.newState.day;
          draft.totalDaysPlayed += days;

          // 处理周期事件触发器
          resolveTriggers(draft, timeResult.triggers);

          // 重置槽位
          const max = getSlotLimits(action.granularity, cfg);
          draft.slots.max = max;
          draft.slots.available = max;
          draft.time.granularity = action.granularity;
          draft.updatedAt = Date.now();
          break;
        }
        case 'LOAD_SAVE': {
          Object.assign(draft, action.save);
          break;
        }
        case 'NEW_GAME': {
          const fresh = createInitialState();
          Object.assign(draft, fresh, action.data);
          break;
        }
        default:
          break;
      }
    }),
  );
}

/**
 * 获取游戏 store 的操作句柄。
 * 组件中调用：const { state, dispatch } = useGameStore()
 */
export function useGameStore() {
  return { state, dispatch, getState, getRawState };
}
