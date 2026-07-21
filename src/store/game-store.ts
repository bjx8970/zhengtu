/**
 * 游戏状态管理（Schema 2）
 *
 * 核心设计：
 * 1. 单一 createStore<PlayerSave> 管理全部游戏状态
 * 2. 通过 dispatch(action) 修改状态，produce() 追踪变更
 * 3. 仅在实际状态变化时写入 localStorage
 *
 * Schema 2 变更：
 * - PlayerSave 重构为子状态结构（character/career/governance/events/world/actions/assessments）
 * - 删除旧职业事实来源（currentLevel/currentCareerLine/promotionStage 等）
 * - 旧主动晋升运行时已删除
 */

import { createStore, produce, unwrap } from 'solid-js/store';
import type { PlayerSave } from '../types/player';
import type { CareerState } from '../domain/career/state';
import type { GovernanceState } from '../domain/governance/state';
import type { EventRuntimeState } from '../domain/events/state';
import type { WorldState } from '../domain/world-state';
import { getConfigLoader } from '../config/loader';
import { writeLocalSave } from '../services/save-repo';

// Reducer 模块
import { reduceStartAction } from './reducers/action-reducer';
import { reduceAdvanceTime } from './reducers/time-reducer';
import { reduceNewGame, reduceLoadSave } from './reducers/character-reducer';

/** 游戏动作联合类型（Schema 2 精简版） */
export type GameAction =
  | { type: 'NEW_GAME'; data: Record<string, unknown> }
  | { type: 'LOAD_SAVE'; save: PlayerSave }
  | {
      type: 'START_ACTION';
      deptId: string;
      actionId: string;
      tierKey: 'primary' | 'secondary' | 'reserve';
    }
  | { type: 'ADVANCE_TIME'; granularity: 'day' | 'week' | 'month'; _rng?: () => number };

/** 创建默认职业状态（初始任职：乡镇科员） */
function createDefaultCareerState(): CareerState {
  return {
    appointment: {
      positionId: 'admin_l1_0',
      institutionId: 'township_govt_01',
      regionId: 'region_qingyun_town',
      institutionLevel: 'township',
      positionDomain: 'local_governance',
      leadershipRank: 'none',
      startedAtDay: 0,
      appointmentType: 'substantive',
      probationEndsAtDay: 360,
    },
    civilServiceRank: 'clerk_2',
    experiences: [],
    specialties: {},
    opportunities: [],
    activeProcess: null,
  };
}

/** 创建默认治理状态 */
function createDefaultGovernanceState(): GovernanceState {
  return {
    policies: [],
    projects: [],
    institutionMetrics: {},
    regionMetrics: {},
  };
}

/** 创建默认事件运行时状态 */
function createDefaultEventRuntimeState(): EventRuntimeState {
  return {
    activeBlockingEventId: null,
    pending: [],
    scheduled: [],
    history: [],
    cooldownUntilDay: {},
    chainInstances: {},
  };
}

/** 创建默认世界状态 */
function createDefaultWorldState(): WorldState {
  return {
    facts: {},
    metrics: {},
    activeCycles: [],
  };
}

/**
 * 创建初始游戏状态（Schema 2）
 *
 * @param overrides 可选的部分覆盖
 * @returns 完整的 PlayerSave
 */
export function createInitialState(overrides?: Partial<PlayerSave>): PlayerSave {
  const cfg = getConfigLoader().getGameConfig();

  const base: PlayerSave = {
    character: {
      saveId: '',
      userId: '',
      characterName: '',
      gender: '男',
      birthPlace: { province: '', city: '' },
      birthYear: 1990,
      gaokaoScore: 0,
      gaokaoTier: '',
      university: '',
      universityTier: '',
      familyBackground: 'peasant',
      promotionPath: 'gongwuyuan',
      isPreparatory: false,
      vigor: 100,
      politicalCapital: 0,
      integrity: 50,
      stability: 50,
      performance: 50,
      charisma: 50,
      competence: 50,
      network: 50,
      diligence: 50,
      ambition: 50,
      corruptionRisk: 0,
      isUnderInvestigation: false,
      philosophy: { scores: { innovation: 50, pragmatic: 50, principled: 50 } },
      relations: {
        classmates: {},
        colleagues: {},
        business: {},
        academic: {},
        media: {},
        central: {},
      },
    },
    time: {
      year: 2012,
      month: 7,
      day: 1,
      granularity: 'day',
      totalDaysPlayed: 0,
    },
    career: createDefaultCareerState(),
    governance: createDefaultGovernanceState(),
    events: createDefaultEventRuntimeState(),
    world: createDefaultWorldState(),
    actions: {
      slots: {
        primary: {
          label: '主要',
          count: cfg.slotTiers.primary.count,
          occupants: Array(cfg.slotTiers.primary.count).fill(null),
        },
        secondary: {
          label: '次要',
          count: cfg.slotTiers.secondary.count,
          occupants: Array(cfg.slotTiers.secondary.count).fill(null),
        },
        reserve: {
          label: '备用',
          count: cfg.slotTiers.reserve.count,
          occupants: Array(cfg.slotTiers.reserve.count).fill(null),
        },
      },
      departmentStates: {},
      totalActions: 0,
      lastCompletedActions: [],
    },
    assessments: {
      comprehensiveScore: 0,
      annualAssessments: [],
    },
    remainingBudget: 800,
    updatedAt: Date.now(),
  };

  if (overrides) {
    return { ...base, ...overrides };
  }
  return base;
}

// ===== Store 创建 =====

const [state, setState] = createStore<PlayerSave>(createInitialState());

/** 获取游戏 Store */
export function useGameStore() {
  return { state, dispatch };
}

/**
 * 纯状态 reducer：接收 draft 和 action，直接修改 draft。
 * 返回是否发生了实际状态变化。
 */
function reduceGameState(draft: PlayerSave, action: GameAction): boolean {
  switch (action.type) {
    case 'START_ACTION': {
      const before = draft.actions.totalActions;
      reduceStartAction(draft, {
        deptId: action.deptId,
        actionId: action.actionId,
        tierKey: action.tierKey,
      });
      return draft.actions.totalActions !== before;
    }
    case 'ADVANCE_TIME': {
      reduceAdvanceTime(draft, {
        granularity: action.granularity,
        _rng: action._rng,
      });
      return true;
    }
    case 'LOAD_SAVE': {
      reduceLoadSave(draft, action.save);
      return false;
    }
    case 'NEW_GAME': {
      reduceNewGame(draft, { data: action.data }, () => createInitialState());
      return true;
    }
    default:
      return false;
  }
}

/**
 * 模块级 dispatch（生产用）。
 * 仅在实际状态变化时写入 localStorage 和更新 updatedAt。
 */
export function dispatch(action: GameAction): void {
  setState(
    produce((draft) => {
      const changed = reduceGameState(draft, action);
      if (changed) {
        draft.updatedAt = Date.now();
      }
    }),
  );

  // 仅在实际变化时持久化（LOAD_SAVE 不触发）
  if (action.type !== 'LOAD_SAVE') {
    writeLocalSave(unwrap(state));
  }
}

/**
 * 创建隔离测试 Store。
 * dispatch 不触发 localStorage 写入。
 */
export function createTestStore(overrides?: Partial<PlayerSave>) {
  const [testState, setTestState] = createStore<PlayerSave>(createInitialState(overrides));

  return {
    getState: () => testState,
    getRawState: () => unwrap(testState),
    dispatch(action: GameAction) {
      setTestState(
        produce((draft) => {
          reduceGameState(draft, action);
        }),
      );
    },
  };
}
