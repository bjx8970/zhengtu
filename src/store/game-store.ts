/**
 * 游戏状态管理（Schema 12）
 *
 * 核心设计：
 * 1. 单一 createStore<PlayerSave> 管理全部游戏状态
 * 2. 通过 dispatch(action) 修改状态，produce() 追踪变更
 * 3. 仅在实际状态变化时写入 localStorage
 *
 * 当前持久化结构为 Schema 12，新增 NPC 离任事实账本。
 */

import { createStore, produce, unwrap } from 'solid-js/store';
import type { PlayerSave } from '../types/player';
import type { GameAction } from '../types/game';
import type { GovernanceState } from '../domain/governance/state';
import type { EventRuntimeState } from '../domain/events/state';
import type { WorldState } from '../domain/world-state';
import { getConfigLoader } from '../config/loader';
import { writeLocalSave } from '../services/save-repo';
import { createAppointmentProbation } from '../engine/career/probation-evaluation';
import { createOrganizationState } from '../engine/organization/organization-initialization';
import type { CurrentAppointment } from '../domain/career/state';

// Reducer 模块
import { reduceStartAction } from './reducers/action-reducer';
import { reduceStartPersonalTask } from './reducers/personal-task-reducer';
import { reduceAdvanceTime } from './reducers/time-reducer';
import { reduceNewGame, reduceLoadSave } from './reducers/character-reducer';
import { reduceChooseEventOption } from './reducers/event-reducer';
import {
  reduceProposePolicy,
  reduceApprovePolicy,
  reduceActivatePolicy,
  reduceSuspendPolicy,
  reduceResumePolicy,
  reduceFailPolicy,
  reduceRepealPolicy,
} from './reducers/policy-reducer';
import { reduceAdvanceCivilServiceRank } from './reducers/career-rank-reducer';
import {
  reduceAcceptCareerOpportunity,
  reduceAdvanceCareerProcess,
  reduceCancelCareerOpportunity,
  reduceRejectCareerOpportunity,
} from './reducers/career-opportunity-reducer';

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
    cooldowns: [],
    chainInstances: {},
    processedSignalIds: [],
    deferredSignals: [],
    deferredContinuations: [],
  };
}

/** 创建默认世界状态 */
function createDefaultWorldState(): WorldState {
  return {
    facts: {},
    metrics: getConfigLoader().getInitialCivilServiceRankQuotaMetrics(),
    activeCycles: [],
  };
}

/**
 * 创建初始游戏状态（当前 Schema）
 *
 * @param overrides 可选的部分覆盖
 * @returns 完整的 PlayerSave
 */
export function createInitialState(overrides?: Partial<PlayerSave>): PlayerSave {
  const cfg = getConfigLoader().getGameConfig();
  const loader = getConfigLoader();

  // 从配置获取初始职位（缺失时直接抛错，不回退）
  const initialPosition = loader.getPositionById(cfg.initialPositionId);
  if (!initialPosition) {
    throw new Error(`Initial position "${cfg.initialPositionId}" not found in config`);
  }
  const initialInstitution = loader.getInstitutionById(initialPosition.institutionId);
  if (!initialInstitution) {
    throw new Error(`Initial institution "${initialPosition.institutionId}" not found in config`);
  }
  const initialAppointmentId = `initial-appointment-${initialPosition.id}`;
  const initialAppointment: CurrentAppointment = {
    appointmentId: initialAppointmentId,
    positionId: initialPosition.id,
    institutionId: initialPosition.institutionId,
    regionId: initialPosition.regionId,
    institutionLevel: initialPosition.institutionLevel,
    positionDomain: initialPosition.positionDomain,
    leadershipRank: initialPosition.leadershipRank,
    startedAtDay: 0,
    appointmentType: 'substantive',
    appointmentReason: 'initial_assignment',
    sourceOpportunityId: null,
    status: 'active',
    endedAtDay: null,
    endReason: null,
    probation: createAppointmentProbation(0, cfg.probation),
  };

  // 属性初始值从 constants.json.initialAttributes 读取
  const initAttrs = cfg.initialAttributes;

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
      vigor: initAttrs['vigor'] ?? 100,
      politicalCapital: initAttrs['politicalCapital'] ?? 0,
      integrity: initAttrs['integrity'] ?? 50,
      stability: initAttrs['stability'] ?? 50,
      performance: initAttrs['performance'] ?? 0,
      charisma: initAttrs['charisma'] ?? 50,
      competence: initAttrs['competence'] ?? 50,
      network: initAttrs['network'] ?? 0,
      diligence: initAttrs['diligence'] ?? 50,
      ambition: initAttrs['ambition'] ?? 100,
      corruptionRisk: initAttrs['corruptionRisk'] ?? 0,
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
      year: cfg.startYear,
      month: 7,
      day: 1,
      granularity: 'day',
      totalDaysPlayed: 0,
      pendingContinuation: null,
    },
    career: {
      appointment: structuredClone(initialAppointment),
      civilServiceRank: 'clerk_2',
      civilServiceRankStartedAtDay: 0,
      civilServiceRankHistory: [],
      restrictions: [],
      experiences: [
        {
          id: `initial-experience-${initialPosition.id}`,
          appointmentId: initialAppointmentId,
          positionId: initialPosition.id,
          positionNameSnapshot: initialPosition.name,
          institutionId: initialInstitution.id,
          institutionNameSnapshot: initialInstitution.name,
          regionId: initialPosition.regionId,
          institutionLevel: initialPosition.institutionLevel,
          positionDomain: initialPosition.positionDomain,
          leadershipRank: initialPosition.leadershipRank,
          appointmentType: 'substantive',
          appointmentReason: 'initial_assignment',
          sourceOpportunityId: null,
          startedAtDay: 0,
          endedAtDay: null,
          endReason: null,
          assessmentResults: [],
        },
      ],
      specialties: {},
      opportunities: [],
      activeProcess: null,
      completedProcesses: [],
    },
    governance: createDefaultGovernanceState(),
    events: createDefaultEventRuntimeState(),
    world: createDefaultWorldState(),
    organization: createOrganizationState({
      initializedAtDay: 0,
      playerAppointment: initialAppointment,
      cadreTemplates: loader.getCadreTemplates(),
      positions: loader.getAllPositions(),
      institutions: loader.getAllInstitutions(),
    }),
    actions: {
      slots: {
        primary: {
          label: cfg.slotTiers.primary.label,
          count: cfg.slotTiers.primary.count,
          occupants: Array(cfg.slotTiers.primary.count).fill(null),
        },
        secondary: {
          label: cfg.slotTiers.secondary.label,
          count: cfg.slotTiers.secondary.count,
          occupants: Array(cfg.slotTiers.secondary.count).fill(null),
        },
        reserve: {
          label: cfg.slotTiers.reserve.label,
          count: cfg.slotTiers.reserve.count,
          occupants: Array(cfg.slotTiers.reserve.count).fill(null),
        },
      },
      departmentStates: {},
      totalActions: 0,
      lastCompletedActions: [],
      personalTasks: { cooldownUntilDays: {}, completedCounts: {}, totalCompleted: 0 },
    },
    assessments: {
      comprehensiveScore: 0,
      annualAssessments: [],
    },
    remainingBudget: initialPosition.annualBudget,
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
  const careerStageEnded = draft.career.appointment.status === 'ended';
  if (careerStageEnded && action.type !== 'NEW_GAME' && action.type !== 'LOAD_SAVE') return false;
  switch (action.type) {
    case 'START_ACTION': {
      const before = draft.actions.totalActions;
      reduceStartAction(draft, {
        deptId: action.deptId,
        actionId: action.actionId,
        tierKey: action.tierKey,
        _idFactory: action._idFactory,
      });
      return draft.actions.totalActions !== before;
    }
    case 'START_PERSONAL_TASK': {
      const before = draft.actions.totalActions;
      reduceStartPersonalTask(draft, {
        taskId: action.taskId,
        tierKey: action.tierKey,
        _idFactory: action._idFactory,
      });
      return draft.actions.totalActions !== before;
    }
    case 'ADVANCE_TIME': {
      reduceAdvanceTime(draft, {
        granularity: action.granularity,
        _rng: action._rng,
        _idFactory: action._idFactory,
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
    case 'CHOOSE_EVENT_OPTION': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceChooseEventOption(
        draft,
        {
          eventInstanceId: action.eventInstanceId,
          optionId: action.optionId,
          _rng: action._rng,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'PROPOSE_POLICY': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceProposePolicy(
        draft,
        {
          policyId: action.policyId,
          regionId: action.regionId,
          institutionId: action.institutionId,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'APPROVE_POLICY': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceApprovePolicy(
        draft,
        {
          policyInstanceId: action.policyInstanceId,
          _rng: action._rng,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'ACTIVATE_POLICY': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceActivatePolicy(
        draft,
        {
          policyInstanceId: action.policyInstanceId,
          _rng: action._rng,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'SUSPEND_POLICY': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceSuspendPolicy(
        draft,
        {
          policyInstanceId: action.policyInstanceId,
          _rng: action._rng,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'RESUME_POLICY': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceResumePolicy(
        draft,
        {
          policyInstanceId: action.policyInstanceId,
          _rng: action._rng,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'FAIL_POLICY': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceFailPolicy(
        draft,
        {
          policyInstanceId: action.policyInstanceId,
          _rng: action._rng,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'REPEAL_POLICY': {
      const currentDay = draft.time.totalDaysPlayed;
      const result = reduceRepealPolicy(
        draft,
        {
          policyInstanceId: action.policyInstanceId,
          _rng: action._rng,
          _idFactory: action._idFactory,
        },
        currentDay,
      );
      return result !== null;
    }
    case 'ADVANCE_CIVIL_SERVICE_RANK':
      return reduceAdvanceCivilServiceRank(draft, action, draft.time.totalDaysPlayed);
    case 'ACCEPT_CAREER_OPPORTUNITY':
      return reduceAcceptCareerOpportunity(draft, action, draft.time.totalDaysPlayed);
    case 'REJECT_CAREER_OPPORTUNITY':
      return reduceRejectCareerOpportunity(draft, action, draft.time.totalDaysPlayed);
    case 'CANCEL_CAREER_OPPORTUNITY':
      return reduceCancelCareerOpportunity(draft, action, draft.time.totalDaysPlayed);
    case 'ADVANCE_CAREER_PROCESS':
      return reduceAdvanceCareerProcess(draft, action, draft.time.totalDaysPlayed);
    default:
      return false;
  }
}

/**
 * 模块级 dispatch（生产用）。
 * 仅在实际状态变化时写入 localStorage 和更新 updatedAt。
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

  // 仅在实际变化时持久化（LOAD_SAVE 不触发）
  if (changed && action.type !== 'LOAD_SAVE') {
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
