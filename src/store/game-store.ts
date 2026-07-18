/**
 * 游戏状态管理
 *
 * 核心设计：
 * 1. 单一 createStore<PlayerSave> 管理全部游戏状态
 * 2. 通过 dispatch(action) 修改状态，produce() 追踪变更
 * 3. 状态变更后组件自动细粒度响应（Solid 字段级追踪）
 * 4. 每次 dispatch 实时写入 localStorage；ADVANCE_TIME 额外同步 Supabase
 *
 * 操作阶段 vs 提交阶段：
 * - 操作阶段（执行行动、处理文件、选择事件）：修改 store + 实时写入 localStorage
 * - 提交阶段（推进时间）：结算所有到期行动 + localStorage + Supabase 同步
 */

import { createStore, produce, unwrap } from 'solid-js/store';
import {
  CareerLine,
  PromotionStage,
  OrgInspectResult,
  ReserveCadreTier,
  FileAction,
} from '../types/enums';
import type { TimeGranularity } from '../types/enums';
import type {
  PlayerSave,
  GameTime,
  SlotOccupant,
  CompletedActionNotification,
} from '../types/player';
import type { TimeTrigger } from '../types/game';
import {
  startAction,
  completeActions,
  resolveActionEffects,
  hasActiveActions,
} from '../engine/core/action';
import { advanceTime, getGranularityDays } from '../engine/core/time';
import { monthlySettlement } from '../engine/governance/budget';
import { calculateKPI } from '../engine/governance/kpi';
import { annualAssessment as runAnnualAssessment } from '../engine/governance/assessment';
import { getConfigLoader } from '../config/loader';
import { clamp, clampAttr } from '../utils/math';
import { writeLocalSave, upsertSave } from '../services/save-repo';
import {
  checkPrerequisites,
  resolveDemocraticVote,
  resolveOrgInspection,
} from '../engine/career/promotion';
import {
  resolveJointReview,
  resolveCommitteeVote,
  resolvePublicNotice,
  resolveProbation,
} from '../engine/career/promotion-final';
import type { PromotionContext } from '../types/game';
import type { CareerRecord } from '../types/player';

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
    health: cfg.initialAttributes['health'] ?? 100,
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
    lastCompletedActions: [],
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
  | { type: 'START_ACTION'; deptId: string; actionId: string }
  | { type: 'ADVANCE_TIME'; granularity: TimeGranularity; _rng?: () => number }
  | { type: 'CHOOSE_EVENT_OPTION'; eventId: string; optionIndex: number }
  | { type: 'PROCESS_DOCUMENT'; docId: string; action: FileAction }
  | { type: 'START_PROMOTION' }
  | { type: 'RESET_PROMOTION' }
  | {
      type: 'PROMOTION_RESOLVE_STAGE';
      choices?: { useConnections?: boolean; influenceInspectors?: boolean };
      /** 仅测试用：注入随机数生成器 */
      _rng?: () => number;
    }
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
  const cur = (draft as unknown as Record<string, number>)[attr] ?? 0;
  setPlayerAttrDirect(draft, attr, cur + delta, bounds);
}

/**
 * 直接设置玩家数值属性（含边界钳位）。
 * 用于 multiply/set 等非加法操作，"加性"操作请用 applyPlayerAttr。
 */
function setPlayerAttrDirect(
  draft: PlayerSave,
  attr: string,
  value: number,
  bounds: Record<string, [number, number]>,
): void {
  if (!PLAYER_NUMERIC_ATTRS.has(attr)) return;
  (draft as unknown as Record<string, number>)[attr] = clampAttr(attr, value, bounds);
}

/** 读取玩家数值属性当前值 */
function getPlayerAttr(draft: PlayerSave, attr: string): number {
  if (!PLAYER_NUMERIC_ATTRS.has(attr)) return 0;
  return (draft as unknown as Record<string, number>)[attr] ?? 0;
}

/** 从 positionId（如 "admin_l3_0"）提取职位索引 */
function extractPositionIndex(positionId: string): number {
  const idx = parseInt(positionId.split('_').pop() ?? '0', 10);
  return Number.isNaN(idx) ? 0 : idx;
}

/**
 * 初始化当前职位的所有部门运行时状态。
 *
 * @param draft 当前游戏状态（mutable produce draft）
 */
function initializeDepartmentStates(draft: PlayerSave): void {
  const idx = extractPositionIndex(draft.currentPositionId);
  const pos = getConfigLoader().getPosition(draft.currentCareerLine, draft.currentLevel, idx);
  if (!pos) return;
  draft.departmentStates = {};
  for (const dept of pos.departments) {
    draft.departmentStates[dept.id] = {
      id: dept.id,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
    };
  }
}

/** 非 idle/completed/failed 时禁止执行其他操作 */
function canAct(stage: PromotionStage): boolean {
  return (
    stage === PromotionStage.Idle ||
    stage === PromotionStage.Completed ||
    stage === PromotionStage.Failed
  );
}

/**
 * 从 draft 中提取晋升引擎所需的上下文快照。
 *
 * @param draft 当前游戏状态
 * @returns PromotionContext
 */
function buildPromotionContext(draft: PlayerSave): PromotionContext {
  return {
    playerLevel: draft.currentLevel,
    playerScore: draft.comprehensiveScore,
    yearsInPosition: draft.yearsInCurrentPosition,
    politicalCapital: draft.politicalCapital,
    corruptionRisk: draft.corruptionRisk,
    factionReputation: draft.factions.reputation,
    relations: { colleagues: draft.relations.colleagues },
    assessmentHistory: draft.annualAssessments.map((a) => ({ score: a.score, tier: a.tier })),
    hasDisciplinaryRecord: false, // TODO: 待处分系统实现后动态计算
    hasGrassrootsExperience:
      draft.currentLevel <= 2 || draft.careerHistory.some((r) => r.level <= 2),
    hasMultiRegionExperience: draft.careerHistory.filter((r) => r.archived).length >= 2,
    charisma: draft.charisma,
    superiorFavor: draft.superiorFavor,
    performance: draft.performance,
    competence: draft.competence,
    integrity: draft.integrity,
  };
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
        // 冻结期每年递减 1，再累加不称职处罚
        if (draft.frozenPeriods > 0) draft.frozenPeriods -= 1;
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
    case 'START_ACTION': {
      if (!canAct(draft.promotionStage)) break;
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

      const result = startAction(
        actionConfig,
        draft.slots,
        draft.remainingBudget,
        draft.totalDaysPlayed,
      );

      if (!result.success) break;

      const occupant: SlotOccupant = {
        actionId: actionConfig.id,
        deptId: action.deptId,
        actionName: actionConfig.name,
        startedAtDay: draft.totalDaysPlayed,
        durationDays: actionConfig.durationDays,
      };

      const tierKey = result.tierKey;
      const slotIdx = result.slotIndex;
      draft.slots[tierKey].occupants[slotIdx] = occupant;

      draft.remainingBudget -= actionConfig.budgetDelta;
      draft.totalActions += 1;

      if (tierKey === 'reserve') {
        const penalty = cfg.reservePenalty;
        draft.health = clampAttr(
          'health',
          (draft.health ?? 100) + penalty.health,
          cfg.attributeBounds,
        );
        draft.demoralization = clampAttr(
          'demoralization',
          (draft.demoralization ?? 0) + penalty.demoralization,
          cfg.attributeBounds,
        );
      }

      const deptState = draft.departmentStates[action.deptId];
      if (deptState) {
        deptState.lastActionDay = draft.totalDaysPlayed;
      }
      break;
    }
    case 'ADVANCE_TIME': {
      if (!canAct(draft.promotionStage)) break;
      const cfgAdv = getConfigLoader().getGameConfig();
      const posIdx = extractPositionIndex(draft.currentPositionId);
      const currentPosition = getConfigLoader().getPosition(
        draft.currentCareerLine,
        draft.currentLevel,
        posIdx,
      );
      const days = getGranularityDays(action.granularity, cfgAdv);
      const timeResult = advanceTime(draft.time, days, draft.birthYear, draft.currentLevel, cfgAdv);

      draft.time = {
        ...draft.time,
        year: timeResult.newState.year,
        month: timeResult.newState.month,
        day: timeResult.newState.day,
      };
      draft.totalDaysPlayed += days;
      resolveTriggers(draft, timeResult.triggers);

      const completed = completeActions(draft.slots, draft.totalDaysPlayed);
      const notifications: CompletedActionNotification[] = [];

      for (const c of completed) {
        const slotOccupant = c.occupant;
        const deptCfg = currentPosition?.departments.find((d) => d.id === slotOccupant.deptId);
        const aCfg = deptCfg?.actions.find((a) => a.id === slotOccupant.actionId);
        const deptName = deptCfg?.name ?? slotOccupant.deptId;

        if (aCfg) {
          const effects = resolveActionEffects(aCfg, action._rng);
          const deptState = draft.departmentStates[slotOccupant.deptId];
          if (deptState) {
            for (const kpi of effects.kpiChanges) {
              const cur = deptState.kpiValues[kpi.indicatorId] ?? 0;
              if (kpi.operation === 'multiply') {
                deptState.kpiValues[kpi.indicatorId] = cur * kpi.delta;
              } else if (kpi.operation === 'set') {
                deptState.kpiValues[kpi.indicatorId] = kpi.delta;
              } else {
                deptState.kpiValues[kpi.indicatorId] = cur + kpi.delta;
              }
            }
          }
          for (const change of effects.playerChanges) {
            if (change.operation === 'add') {
              applyPlayerAttr(draft, change.attr, change.delta, cfgAdv.attributeBounds);
            } else if (change.operation === 'multiply' || change.operation === 'set') {
              const cur = getPlayerAttr(draft, change.attr);
              const newVal = change.operation === 'multiply' ? cur * change.delta : change.delta;
              setPlayerAttrDirect(draft, change.attr, newVal, cfgAdv.attributeBounds);
            }
          }

          notifications.push({
            actionName: slotOccupant.actionName,
            deptName,
            effects: [
              ...effects.kpiChanges.map((k) =>
                k.operation === 'multiply'
                  ? `KPI×${k.delta}`
                  : k.operation === 'set'
                    ? `KPI=${k.delta}`
                    : `KPI${k.delta >= 0 ? '+' : ''}${k.delta}`,
              ),
              ...effects.playerChanges.map((p) =>
                p.operation === 'multiply'
                  ? `${p.attr}×${p.delta}`
                  : p.operation === 'set'
                    ? `${p.attr}=${p.delta}`
                    : `${p.attr}${p.delta >= 0 ? '+' : ''}${p.delta}`,
              ),
            ],
            completedAtDay: draft.totalDaysPlayed,
          });
        }

        draft.slots[c.tierKey].occupants[c.slotIndex] = null;
      }

      if (notifications.length > 0) {
        draft.lastCompletedActions = [...notifications, ...draft.lastCompletedActions].slice(0, 5);
      }

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

      // 应用家庭背景 + 晋升通道的属性加成
      const bgId = (action.data as Record<string, unknown>).familyBackground as string | undefined;
      const pathId = (action.data as Record<string, unknown>).promotionPath as string | undefined;
      if (bgId || pathId) {
        const loader = getConfigLoader();
        const bonuses: Record<string, number> = {};
        if (bgId) {
          const bg = loader.getFamilyBackground(bgId);
          if (bg) Object.assign(bonuses, bg.bonuses);
        }
        if (pathId) {
          const path = loader.getPromotionPath(pathId);
          if (path) Object.assign(bonuses, path.bonuses);
        }
        for (const [key, delta] of Object.entries(bonuses)) {
          switch (key) {
            case 'politicalCapital':
              draft.politicalCapital = clamp(draft.politicalCapital + delta, 0, 500);
              break;
            case 'superiorFavor':
              draft.superiorFavor = clamp(draft.superiorFavor + delta, 0, 100);
              break;
            case 'reform':
            case 'pragmatic':
            case 'conservative':
              draft.factions.reputation[key] = clamp(
                (draft.factions.reputation[key] ?? 0) + delta,
                0,
                100,
              );
              break;
            default:
              applyPlayerAttr(draft, key, delta, getConfigLoader().getGameConfig().attributeBounds);
          }
        }
      }
      initializeDepartmentStates(draft);
      break;
    }
    case 'RESET_PROMOTION': {
      if (
        draft.promotionStage !== PromotionStage.Completed &&
        draft.promotionStage !== PromotionStage.Failed
      ) {
        break;
      }
      draft.promotionStage = PromotionStage.Idle;
      draft.promotionState = null;
      break;
    }
    case 'START_PROMOTION': {
      if (draft.promotionStage !== PromotionStage.Idle) break;
      // 冻结期中不能晋升
      if (draft.frozenPeriods > 0) break;
      // 旧岗位行动依赖当前部门配置，必须先完成后再进入晋升流程。
      if (hasActiveActions(draft.slots)) break;

      const nextLevel = draft.currentLevel + 1;
      const lineCfg = getConfigLoader().getCareerLine(draft.currentCareerLine);
      if (!lineCfg) break;
      const nextLevelCfg = lineCfg.levels.find((l) => l.level === nextLevel);
      if (!nextLevelCfg || nextLevelCfg.positions.length === 0) break;
      const targetPos = nextLevelCfg.positions[0];
      if (!targetPos) break;

      draft.promotionAttempts += 1;

      const ctx = buildPromotionContext(draft);
      const prereq = checkPrerequisites(ctx, nextLevelCfg.promotionRequirements);

      if (!prereq.eligible) {
        draft.promotionStage = PromotionStage.Failed;
        draft.promotionState = {
          targetPositionId: targetPos.id,
          targetLevel: nextLevel,
          currentStage: PromotionStage.Failed,
          stageResults: {},
        };
        break;
      }

      draft.promotionStage = PromotionStage.DemocraticVote;
      draft.promotionState = {
        targetPositionId: targetPos.id,
        targetLevel: nextLevel,
        currentStage: PromotionStage.DemocraticVote,
        stageResults: {},
      };
      break;
    }
    case 'PROMOTION_RESOLVE_STAGE': {
      const ps = draft.promotionState;
      if (!ps) break;

      const cfgPromoStore = getConfigLoader().getGameConfig();
      const ctxStore = buildPromotionContext(draft);
      const choices = action.choices ?? {};
      const rng = action._rng ?? Math.random;

      switch (ps.currentStage) {
        case PromotionStage.DemocraticVote: {
          const result = resolveDemocraticVote(ctxStore, choices, cfgPromoStore, rng);
          ps.stageResults.democraticVotes = result.votes;
          if (result.flaggedForRisk) ps.flaggedForRisk = true;
          if (result.passed) {
            ps.currentStage = PromotionStage.OrgInspection;
            draft.promotionStage = PromotionStage.OrgInspection;
          } else {
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
            draft.demoralization = clamp(
              (draft.demoralization ?? 0) +
                cfgPromoStore.promotion.progression.demoralizationOnFail,
              0,
              100,
            );
          }
          break;
        }
        case PromotionStage.OrgInspection: {
          const result = resolveOrgInspection(ctxStore, choices, cfgPromoStore);
          ps.stageResults.inspectionResult = result.result;
          if (result.politicalCost > 0) {
            draft.politicalCapital -= result.politicalCost;
          }
          if (result.passed) {
            ps.currentStage = PromotionStage.JointReview;
            draft.promotionStage = PromotionStage.JointReview;
          } else if (result.result === OrgInspectResult.Rejected) {
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
            draft.frozenPeriods = clamp(draft.frozenPeriods + 2, 0, cfgPromoStore.maxFrozenPeriods);
            draft.demoralization = clamp(
              (draft.demoralization ?? 0) +
                cfgPromoStore.promotion.progression.demoralizationOnRejected,
              0,
              100,
            );
          } else {
            // Suspended — 本次搁置
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
          }
          break;
        }
        case PromotionStage.JointReview: {
          const result = resolveJointReview(ctxStore, cfgPromoStore, rng);
          ps.stageResults.reviewPassedDepts = Object.entries(result.opinions)
            .filter(([, v]) => v)
            .map(([k]) => k);
          ps.stageResults.reviewFailedDepts = Object.entries(result.opinions)
            .filter(([, v]) => !v)
            .map(([k]) => k);
          if (result.passed) {
            ps.currentStage = PromotionStage.CommitteeVote;
            draft.promotionStage = PromotionStage.CommitteeVote;
          } else {
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
            draft.demoralization = clamp(
              (draft.demoralization ?? 0) +
                cfgPromoStore.promotion.progression.demoralizationOnFail,
              0,
              100,
            );
          }
          break;
        }
        case PromotionStage.CommitteeVote: {
          const result = resolveCommitteeVote(ctxStore, cfgPromoStore, rng);
          ps.stageResults.committeeForVotes = result.forVotes;
          ps.stageResults.committeeAgainstVotes = result.againstVotes;
          if (result.passed) {
            ps.currentStage = PromotionStage.PublicNotice;
            draft.promotionStage = PromotionStage.PublicNotice;
          } else {
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
            draft.demoralization = clamp(
              (draft.demoralization ?? 0) +
                cfgPromoStore.promotion.progression.demoralizationOnFail,
              0,
              100,
            );
          }
          break;
        }
        case PromotionStage.PublicNotice: {
          const result = resolvePublicNotice(ctxStore, cfgPromoStore, rng);
          ps.stageResults.hasComplaint = result.hasComplaint;
          ps.stageResults.sentimentEscalated = result.sentimentEscalated;
          if (result.passed) {
            ps.currentStage = PromotionStage.Appointment;
            draft.promotionStage = PromotionStage.Appointment;
          } else {
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
            draft.demoralization = clamp(
              (draft.demoralization ?? 0) +
                cfgPromoStore.promotion.progression.demoralizationOnFail,
              0,
              100,
            );
          }
          break;
        }
        case PromotionStage.Appointment: {
          ps.currentStage = PromotionStage.Probation;
          draft.promotionStage = PromotionStage.Probation;
          break;
        }
        case PromotionStage.Probation: {
          const result = resolveProbation(ctxStore, cfgPromoStore, rng);
          if (result.passed) {
            if (ps.targetLevel !== draft.currentLevel + 1) {
              draft.promotionStage = PromotionStage.Failed;
              ps.currentStage = PromotionStage.Failed;
              break;
            }

            const loader = getConfigLoader();
            const oldPos = loader.getPosition(
              draft.currentCareerLine,
              draft.currentLevel,
              extractPositionIndex(draft.currentPositionId),
            );
            const targetPos = loader.getPosition(
              draft.currentCareerLine,
              ps.targetLevel,
              extractPositionIndex(ps.targetPositionId),
            );
            if (!targetPos || targetPos.id !== ps.targetPositionId) {
              draft.promotionStage = PromotionStage.Failed;
              ps.currentStage = PromotionStage.Failed;
              break;
            }

            const careerRecord: CareerRecord = {
              positionId: draft.currentPositionId,
              positionName: oldPos?.name ?? draft.currentPositionId,
              level: draft.currentLevel,
              careerLine: draft.currentCareerLine,
              startYear: draft.time.year - draft.yearsInCurrentPosition,
              endYear: draft.time.year,
              assessmentResults: draft.annualAssessments.map((assessment) => ({
                ...assessment,
              })),
              archived: false,
            };
            draft.careerHistory.push(careerRecord);
            draft.currentPositionId = ps.targetPositionId;
            draft.currentLevel = ps.targetLevel;
            draft.yearsInCurrentPosition = 0;
            draft.remainingBudget = targetPos.annualBudget;
            draft.annualAssessments = [];
            draft.comprehensiveScore = 0;
            draft.politicalCapital = clamp(
              draft.politicalCapital +
                cfgPromoStore.promotion.progression.politicalCapitalBonusOnSuccess,
              0,
              500,
            );
            initializeDepartmentStates(draft);
            draft.promotionStage = PromotionStage.Completed;
            ps.currentStage = PromotionStage.Completed;
          } else {
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
            draft.demoralization = clamp(
              (draft.demoralization ?? 0) +
                cfgPromoStore.promotion.progression.demoralizationOnFail,
              0,
              100,
            );
          }
          break;
        }
        default:
          break;
      }
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
