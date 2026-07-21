/**
 * 游戏状态管理
 *
 * 核心设计：
 * 1. 单一 createStore<PlayerSave> 管理全部游戏状态
 * 2. 通过 dispatch(action) 修改状态，produce() 追踪变更
 * 3. 状态变更后组件自动细粒度响应（Solid 字段级追踪）
 * 4. 仅在实际状态变化时写入 localStorage
 *
 * 基础工程变更：
 * - 领域逻辑拆分到 reducers/ 子模块
 * - 时间推进使用统一时间轴（行动完成 → 月度结算 → 年度考核）
 * - 理念偏离倍率绑定到行动实例（SlotOccupant.runtimeSnapshot）
 * - 删除玩家级临时字段 _pendingDeviationMultiplier 和 pendingStyleConflict
 */

import { createStore, produce, unwrap } from 'solid-js/store';
import { CareerLine, PromotionStage, ReserveCadreTier, FileAction } from '../types/enums';
import type { TimeGranularity } from '../types/enums';
import type { PlayerSave, GameTime, SlotOccupant, SlotTierKey } from '../types/player';
import { getConfigLoader } from '../config/loader';
import { writeLocalSave } from '../services/save-repo';

// Reducer 模块
import { reduceStartAction } from './reducers/action-reducer';
import { reduceAdvanceTime } from './reducers/time-reducer';
import {
  reduceStartPromotion,
  reduceSelectPromotionTarget,
  reduceResetPromotion,
  reducePromotionResolveStage,
  canAct,
} from './reducers/career-reducer';
import { reduceLoadSave, reduceNewGame } from './reducers/character-reducer';

export type GameState = PlayerSave;

/** 创建默认时间状态 */
function getInitialTime(): GameTime {
  const cfg = getConfigLoader().getGameConfig();
  return { year: cfg.startYear, month: 1, day: 1, granularity: 'day' };
}

function makeEmptySlots(cfg: { slotTiers: Record<string, { count: number; label: string }> }) {
  const tiers = cfg.slotTiers as unknown as Record<
    'primary' | 'secondary' | 'reserve',
    { count: number; label: string }
  >;
  const makeTier = (key: 'primary' | 'secondary' | 'reserve') => ({
    label: tiers[key].label,
    count: tiers[key].count,
    occupants: new Array(tiers[key].count).fill(null) as (SlotOccupant | null)[],
  });
  return {
    primary: makeTier('primary'),
    secondary: makeTier('secondary'),
    reserve: makeTier('reserve'),
  };
}

/**
 * 创建初始游戏状态。
 *
 * @param overrides 可选的部分覆盖（用于建档时注入角色信息）
 * @returns 完整初始 PlayerSave
 */
export function createInitialState(overrides?: Partial<PlayerSave>): PlayerSave {
  const cfg = getConfigLoader().getGameConfig();
  const slots = makeEmptySlots(cfg);

  return {
    saveId: '',
    userId: '',
    characterName: '',
    gender: '男',
    birthPlace: { province: '', city: '' },
    birthYear: cfg.startYear - cfg.defaultStartingAge,
    gaokaoScore: 0,
    gaokaoTier: '本科',
    university: '',
    universityTier: '本科',
    familyBackground: 'worker',
    promotionPath: 'gongwuyuan',
    isPreparatory: false,
    currentPositionId: '',
    currentLevel: 1,
    currentCareerLine: 'admin' as CareerLine,
    yearsInCurrentPosition: 0,
    slots,
    vigor: cfg.initialAttributes['vigor'] ?? 100,
    politicalCapital: cfg.initialAttributes['politicalCapital'] ?? 0,
    remainingBudget: 1000,
    comprehensiveScore: 0,
    annualAssessments: [],
    integrity: cfg.initialAttributes['integrity'] ?? 50,
    stability: cfg.initialAttributes['stability'] ?? 50,
    performance: cfg.initialAttributes['performance'] ?? 0,
    charisma: cfg.initialAttributes['charisma'] ?? 50,
    competence: cfg.initialAttributes['competence'] ?? 50,
    diligence: cfg.initialAttributes['diligence'] ?? 50,
    network: cfg.initialAttributes['network'] ?? 0,
    promotionStage: 'idle' as PromotionStage,
    promotionAttempts: 0,
    frozenPeriods: 0,
    promotionState: null,
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
    philosophy: {
      scores: {
        innovation: 0,
        pragmatic: 0,
        principled: 0,
      },
    },
    reserveTier: 0 as ReserveCadreTier,
    ambition: cfg.initialAttributes['ambition'] ?? 100,
    corruptionRisk: cfg.initialAttributes['corruptionRisk'] ?? 0,
    isUnderInvestigation: false,
    time: getInitialTime(),
    successor: null,
    thinkTank: { science: null, economics: null, law: null },
    mentees: [],
    achievements: [],
    totalActions: 0,
    totalDaysPlayed: 0,
    lastCompletedActions: [],
    endgameReached: false,
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
  | { type: 'START_ACTION'; deptId: string; actionId: string; tierKey: SlotTierKey }
  | { type: 'ADVANCE_TIME'; granularity: TimeGranularity; _rng?: () => number }
  | { type: 'CHOOSE_EVENT_OPTION'; eventId: string; optionIndex: number }
  | { type: 'PROCESS_DOCUMENT'; docId: string; action: FileAction }
  | { type: 'START_PROMOTION' }
  | { type: 'SELECT_PROMOTION_TARGET'; positionId: string }
  | { type: 'RESET_PROMOTION' }
  | {
      type: 'PROMOTION_RESOLVE_STAGE';
      choices?: { useConnections?: boolean; influenceInspectors?: boolean };
      _rng?: () => number;
    }
  | { type: 'LOAD_SAVE'; save: PlayerSave }
  | { type: 'NEW_GAME'; data: Record<string, unknown> };

// Solid 响应式 store
const [state, setState] = createStore<GameState>(createInitialState());

/**
 * 纯状态 reducer：接收 draft 和 action，直接修改 draft。
 *
 * 委托给各领域 reducer 模块处理。
 * 返回是否发生了实际状态变化。
 */
function reduceGameState(draft: PlayerSave, action: GameAction): boolean {
  switch (action.type) {
    case 'START_ACTION': {
      if (!canAct(draft.promotionStage)) return false;
      const before = draft.totalActions;
      reduceStartAction(draft, {
        deptId: action.deptId,
        actionId: action.actionId,
        tierKey: action.tierKey,
      });
      return draft.totalActions !== before;
    }
    case 'ADVANCE_TIME': {
      if (!canAct(draft.promotionStage)) return false;
      reduceAdvanceTime(draft, {
        granularity: action.granularity,
        _rng: action._rng,
      });
      return true;
    }
    case 'LOAD_SAVE': {
      reduceLoadSave(draft, action.save);
      return false; // LOAD_SAVE 不触发持久化
    }
    case 'NEW_GAME': {
      reduceNewGame(draft, { data: action.data }, () => createInitialState());
      return true;
    }
    case 'RESET_PROMOTION': {
      const beforeStage = draft.promotionStage;
      reduceResetPromotion(draft);
      return draft.promotionStage !== beforeStage;
    }
    case 'START_PROMOTION': {
      const beforeStage = draft.promotionStage;
      reduceStartPromotion(draft);
      return draft.promotionStage !== beforeStage;
    }
    case 'SELECT_PROMOTION_TARGET': {
      const beforeStage = draft.promotionStage;
      reduceSelectPromotionTarget(draft, action.positionId);
      return draft.promotionStage !== beforeStage;
    }
    case 'PROMOTION_RESOLVE_STAGE': {
      const beforeStage = draft.promotionStage;
      reducePromotionResolveStage(draft, {
        choices: action.choices,
        _rng: action._rng,
      });
      return draft.promotionStage !== beforeStage;
    }
    default:
      return false;
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
 * 所有状态变更的唯一入口。仅在实际状态变化时更新 updatedAt 并持久化。
 * LOAD_SAVE 不触发持久化（避免启动时覆盖原存档）。
 */
export function dispatch(action: GameAction): void {
  let changed = false;
  setState(
    produce((draft) => {
      changed = reduceGameState(draft, action);
      if (changed) {
        draft.updatedAt = Date.now();
      }
    }),
  );

  // 仅在实际状态变化时写入本地
  if (changed) {
    writeLocalSave(unwrap(state));
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
      testSetState(
        produce((draft) => {
          const changed = reduceGameState(draft, action);
          if (changed) {
            draft.updatedAt = Date.now();
          }
        }),
      ),
  };
}

/**
 * 获取游戏 store 的操作句柄。
 * 组件中调用：const { state, dispatch } = useGameStore()
 */
export function useGameStore() {
  return { state, dispatch, getState, getRawState };
}
