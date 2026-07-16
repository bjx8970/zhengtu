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
import { getSlotLimits, executeAction } from '../engine/core/action';
import { advanceTime, getGranularityDays } from '../engine/core/time';
import { monthlySettlement } from '../engine/governance/budget';
import { calculateKPI } from '../engine/governance/kpi';
import { annualAssessment as runAnnualAssessment } from '../engine/governance/assessment';
import { getConfigLoader } from '../config/loader';
import { clamp, clampAttr } from '../utils/math';
import { writeLocalSave, upsertSave } from '../services/save-repo';

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
    politicalCapital: cfg.initialAttributes['politicalCapital'] ?? 0,
    remainingBudget: 1000,
    comprehensiveScore: 0,
    annualAssessments: [],
    integrity: cfg.initialAttributes['integrity'] ?? 50,
    stability: cfg.initialAttributes['stability'] ?? 50,
    performance: cfg.initialAttributes['performance'] ?? 0,
    charisma: cfg.initialAttributes['charisma'] ?? 50,
    competence: cfg.initialAttributes['competence'] ?? 50,
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
    superiorFavor: cfg.initialAttributes['superiorFavor'] ?? 20,
    reserveTier: 0 as ReserveCadreTier,
    demoralization: cfg.initialAttributes['demoralization'] ?? 0,
    corruptionRisk: cfg.initialAttributes['corruptionRisk'] ?? 0,
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

/** 可被行动修改的玩家数值属性，运行时从配置的 attributeBounds keys 派生 */
const cfg = getConfigLoader().getGameConfig();
const PLAYER_NUMERIC_ATTRS = new Set(Object.keys(cfg.attributeBounds));

/**
 * 将行动效果的属性变更应用到 draft 上，含边界钳位。
 *
 * @param draft  当前状态 draft
 * @param attr   属性名（"player." 前缀已剥离）
 * @param delta  变化量
 * @param bounds 属性边界表
 */
function applyPlayerAttr(
  draft: PlayerSave,
  attr: string,
  delta: number,
  bounds: Record<string, [number, number]>,
): void {
  if (!PLAYER_NUMERIC_ATTRS.has(attr)) return;
  const d = draft as unknown as Record<string, number>;
  d[attr] = clampAttr(attr, (d[attr] ?? 0) + delta, bounds);
}

/** 从 positionId（如 "admin_l3_0"）提取职位索引 */
function extractPositionIndex(positionId: string): number {
  const idx = parseInt(positionId.split('_').pop() ?? '0', 10);
  return Number.isNaN(idx) ? 0 : idx;
}

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
    extractPositionIndex(draft.currentPositionId),
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
        const kpiResult = calculateKPI(position.kpiIndicators, draft.departmentStates, cfg);
        // 年度评价
        const assessment = runAnnualAssessment(kpiResult, draft.yearsInCurrentPosition, cfg);
        draft.comprehensiveScore = assessment.score;
        draft.frozenPeriods += assessment.frozenPeriods;
        draft.frozenPeriods = clamp(draft.frozenPeriods, 0, cfg.maxFrozenPeriods);
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
 * 纯状态 reducer：接收 draft 和 action，直接修改 draft。
 *
 * 所有业务逻辑在此函数中，不依赖 store 实例。
 * 供 dispatch 和 createTestStore 复用。
 */
function reduceGameState(draft: PlayerSave, action: GameAction): void {
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
      const loader = getConfigLoader();
      const cfg = loader.getGameConfig();
      const positionIndex = extractPositionIndex(draft.currentPositionId);
      const position = loader.getPosition(
        draft.currentCareerLine,
        draft.currentLevel,
        positionIndex,
      );
      if (!position) break;

      const deptConfig = position.departments.find((d) => d.id === action.deptId);
      if (!deptConfig) break;
      const actionConfig = deptConfig.actions.find((a) => a.id === action.actionId);
      if (!actionConfig) break;

      const deptState = draft.departmentStates[action.deptId] ?? {
        id: action.deptId,
        kpiValues: {},
        monthlyConsumption: 0,
        cumulativeConsumption: 0,
        actionCooldowns: {},
        lastActionDay: 0,
      };
      if (!draft.departmentStates[action.deptId]) {
        draft.departmentStates[action.deptId] = deptState;
      }

      const result = executeAction(
        actionConfig,
        deptState,
        draft.slots.available,
        draft.remainingBudget,
        draft.totalDaysPlayed,
        cfg,
      );

      if (!result.success) break;

      for (const kpi of result.kpiChanges) {
        deptState.kpiValues[kpi.indicatorId] =
          (deptState.kpiValues[kpi.indicatorId] ?? 0) + kpi.delta;
      }

      for (const change of result.playerChanges) {
        applyPlayerAttr(draft, change.attr, change.delta, cfg.attributeBounds);
      }

      deptState.actionCooldowns[result.newCooldown.actionId] = result.newCooldown.expiresAt;
      deptState.lastActionDay = draft.totalDaysPlayed;

      draft.slots.available -= result.slotCost;
      draft.remainingBudget -= result.budgetDelta;

      const timeResult = advanceTime(
        draft.time,
        result.daysAdvanced,
        draft.birthYear,
        draft.currentLevel,
        cfg,
      );
      draft.time.year = timeResult.newState.year;
      draft.time.month = timeResult.newState.month;
      draft.time.day = timeResult.newState.day;
      draft.totalDaysPlayed += result.daysAdvanced;
      resolveTriggers(draft, timeResult.triggers);

      draft.totalActions += 1;
      break;
    }
    case 'ADVANCE_TIME': {
      const cfgAdv = getConfigLoader().getGameConfig();
      const days = getGranularityDays(action.granularity, cfgAdv);
      const timeResult = advanceTime(draft.time, days, draft.birthYear, draft.currentLevel, cfgAdv);

      draft.time.year = timeResult.newState.year;
      draft.time.month = timeResult.newState.month;
      draft.time.day = timeResult.newState.day;
      draft.totalDaysPlayed += days;
      resolveTriggers(draft, timeResult.triggers);

      const max = getSlotLimits(action.granularity, cfgAdv);
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
}

/**
 * 派发动作修改游戏状态。
 *
 * 所有状态变更的唯一入口。引擎函数在此处被调用，
 * 结果通过 produce() 直接修改 draft，Solid 自动追踪变更并通知组件。
 */
export function dispatch(action: GameAction): void {
  setState(produce((draft) => reduceGameState(draft, action)));

  // 每次操作实时写入本地
  writeLocalSave(unwrap(state));

  // 推进时间时同步到 Supabase
  if (action.type === 'ADVANCE_TIME') {
    upsertSave(unwrap(state)).catch((e: unknown) => console.warn('Supabase sync failed:', e));
  }
}

/**
 * 创建独立的测试用 store。
 * 返回独立的 state、dispatch、getRawState，测试间互不干扰。
 */
export function createTestStore(initialOverrides?: Partial<PlayerSave>) {
  const [testState, testSetState] = createStore<GameState>(createInitialState(initialOverrides));

  return {
    state: testState,
    getRawState: () => unwrap(testState),
    dispatch: (action: GameAction) =>
      testSetState(produce((draft) => reduceGameState(draft, action))),
  };
}

/**
 * 获取游戏 store 的操作句柄。
 * 组件中调用：const { state, dispatch } = useGameStore()
 */
export function useGameStore() {
  return { state, dispatch, getState, getRawState };
}
