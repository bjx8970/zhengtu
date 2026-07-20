/**
 * 游戏状态管理
 *
 * 核心设计：
 * 1. 单一 createStore<PlayerSave> 管理全部游戏状态
 * 2. 通过 dispatch(action) 修改状态，produce() 追踪变更
 * 3. 状态变更后组件自动细粒度响应（Solid 字段级追踪）
 * 4. 每次 dispatch 实时写入 localStorage
 *
 * 操作阶段 vs 提交阶段：
 * - 操作阶段（执行行动、处理文件、选择事件）：修改 store + 实时写入 localStorage
 * - 提交阶段（推进时间）：结算所有到期行动 + localStorage
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
  SlotTierKey,
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
import { computeFiveDimensions, computeComprehensiveScore } from '../engine/governance/dimensions';
import { scoreToKPITier } from '../engine/governance/kpi';
import { getConfigLoader } from '../config/loader';
import { normalizeAllSpectrums } from '../engine/career/spectrum-constraint';
import { calculateDeviationPenalty } from '../engine/career/deviation-penalty';
import { deriveStyleDeltas, collectAllStyleIds } from '../engine/career/style-derivation';
import { decayStyleScores } from '../engine/career/style-decay';
import type { AnnualActionRecord } from '../engine/career/style-derivation';
import { clamp, clampAttr } from '../utils/math';
import { writeLocalSave } from '../services/save-repo';
import { resolveDemocraticVote, resolveOrgInspection } from '../engine/career/promotion';
import { validatePromotionTarget } from '../engine/career/promotion-target';
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

/** Phase C: 修改风格评分并自动归一化光谱约束 */
function applyStyleDelta(draft: PlayerSave, styleId: string, delta: number): void {
  const styleCfg = getConfigLoader().getLeadershipStyleConfig();
  const current = draft.philosophy.scores[styleId] ?? 0;
  draft.philosophy.scores[styleId] = clamp(current + delta, 0, 100);
  const normalized = normalizeAllSpectrums(draft.philosophy.scores, styleCfg.styleSpectrums);
  draft.philosophy.scores = normalized;
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
      actionCooldownUntilDays: {},
    };
  }
}

/**
 * 将旧存档迁移到 Phase A 属性体系。
 *
 * 迁移规则：
 * - health → vigor（直接映射）
 * - demoralization → ambition（反转：100 - 旧值）
 * - factions.reputation → philosophy.scores（reform→innovation, conservative→principled）
 * - 删除旧字段
 *
 * @param draft 从旧存档反序列化的 PlayerSave（已通过 Object.assign 合并）
 */
function migrateSaveToPhaseA(draft: PlayerSave): void {
  const save = draft as unknown as Record<string, unknown>;

  if (typeof save.health === 'number' && typeof save.vigor !== 'number') {
    save.vigor = save.health;
  }

  if (typeof save.demoralization === 'number' && typeof save.ambition !== 'number') {
    save.ambition = 100 - (save.demoralization as number);
  }

  if (save.factions && typeof save.factions === 'object') {
    const factions = save.factions as Record<string, unknown>;
    if (factions.reputation && typeof factions.reputation === 'object') {
      const rep = factions.reputation as Record<string, number>;
      const existing = (save.philosophy as Record<string, unknown> | undefined)?.scores as
        Record<string, number> | undefined;
      save.philosophy = {
        scores: {
          innovation: rep.reform ?? existing?.innovation ?? 0,
          pragmatic: rep.pragmatic ?? existing?.pragmatic ?? 0,
          principled: rep.conservative ?? existing?.principled ?? 0,
        },
      };
    }
  }

  delete save.health;
  delete save.demoralization;
  delete save.factions;
  delete (save as Record<string, unknown>).superiorFavor;
}

/** Phase C 存档迁移：旧 scores 归一化到新光谱约束 */
function migrateSaveToPhaseC(draft: PlayerSave): void {
  const styleCfg = getConfigLoader().getLeadershipStyleConfig();
  draft.philosophy.scores = normalizeAllSpectrums(draft.philosophy.scores, styleCfg.styleSpectrums);
}

/**
 * 补齐旧版本本地存档中尚不存在的行动分类与冷却字段。
 *
 * @param draft 已载入的可变游戏状态
 */
function migrateActionState(draft: PlayerSave): void {
  const position = getConfigLoader().getPosition(
    draft.currentCareerLine,
    draft.currentLevel,
    extractPositionIndex(draft.currentPositionId),
  );

  for (const departmentState of Object.values(draft.departmentStates)) {
    departmentState.actionCooldownUntilDays ??= {};
  }

  const tierKeys: SlotTierKey[] = ['primary', 'secondary', 'reserve'];
  for (const tierKey of tierKeys) {
    for (const occupant of draft.slots[tierKey].occupants) {
      if (!occupant) continue;

      const actionConfig = position?.departments
        .find((department) => department.id === occupant.deptId)
        ?.actions.find((configuredAction) => configuredAction.id === occupant.actionId);

      if (!('category' in occupant) || occupant.category === undefined) {
        occupant.category = actionConfig?.category ?? 'routine';
      }
      if (!('cooldownDays' in occupant) || occupant.cooldownDays === undefined) {
        occupant.cooldownDays = actionConfig?.cooldownDays ?? 0;
      }
    }
  }

  // 兼容旧存档：若晋升流程进行中但缺少 targetPositionId，默认取目标等级第一个职位
  if (
    draft.promotionState &&
    draft.promotionStage !== PromotionStage.Idle &&
    draft.promotionStage !== PromotionStage.Completed &&
    draft.promotionStage !== PromotionStage.Failed &&
    (!draft.promotionState.targetPositionId || draft.promotionState.targetPositionId === '')
  ) {
    const lineCfgMigrate = getConfigLoader().getCareerLine(draft.currentCareerLine);
    const targetLevelCfg = lineCfgMigrate?.levels.find(
      (l) => l.level === draft.promotionState!.targetLevel,
    );
    if (targetLevelCfg && targetLevelCfg.positions.length > 0) {
      draft.promotionState.targetPositionId = targetLevelCfg.positions[0]!.id;
    }
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
    styleScores: draft.philosophy.scores,
    relations: { colleagues: draft.relations.colleagues },
    assessmentHistory: draft.annualAssessments.map((a) => ({ score: a.score, tier: a.tier })),
    hasDisciplinaryRecord: false, // TODO: 待处分系统实现后动态计算
    hasGrassrootsExperience:
      draft.currentLevel <= 2 || draft.careerHistory.some((r) => r.level <= 2),
    hasMultiRegionExperience: draft.careerHistory.filter((r) => r.archived).length >= 2,
    charisma: draft.charisma,
    superiorFavor: 0, // Phase A: superiorFavor 已删除，暂用 0，Phase B/C 重写
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

        // Phase C: 月度风格衰减
        const styleCfgM = getConfigLoader().getLeadershipStyleConfig();
        draft.philosophy.scores = decayStyleScores(draft.philosophy.scores, styleCfgM);
        break;
      }
      case 'annual_assessment': {
        if (!position) break;
        // Phase B: KPI 计算 → 五维分项 → 综合评分 → 等次
        const kpiResult = calculateKPI(position.kpiIndicators, draft.departmentStates, cfg);
        const dimensions = computeFiveDimensions(
          {
            integrity: draft.integrity,
            stability: draft.stability,
            ambition: draft.ambition,
            competence: draft.competence,
            charisma: draft.charisma,
            network: draft.network,
            diligence: draft.diligence,
            vigor: draft.vigor,
          },
          kpiResult.totalScore,
          cfg,
        );
        const comprehensiveScore = computeComprehensiveScore(dimensions, cfg);
        const tier = scoreToKPITier(comprehensiveScore, cfg.kpiTierThresholds);
        const assessment = runAnnualAssessment(
          comprehensiveScore,
          tier,
          draft.yearsInCurrentPosition,
          cfg,
        );
        draft.comprehensiveScore = assessment.score;
        // 冻结期每年递减 1，再累加不称职处罚
        if (draft.frozenPeriods > 0) draft.frozenPeriods -= 1;
        draft.frozenPeriods += assessment.frozenPeriods;
        draft.frozenPeriods = clamp(draft.frozenPeriods, 0, cfg.maxFrozenPeriods);
        draft.annualAssessments.push({
          year: trigger.year ?? draft.time.year,
          score: assessment.score,
          tier: assessment.tier,
          dimensions,
        });
        draft.yearsInCurrentPosition += 1;

        // Phase C: 年度风格派生
        const styleCfgA = getConfigLoader().getLeadershipStyleConfig();
        if (position) {
          const completedActionsForDerivation = completeActions(draft.slots, draft.totalDaysPlayed);
          const annualActions: AnnualActionRecord[] = [];
          for (const c of completedActionsForDerivation) {
            const deptCfg = position.departments.find((d) => d.id === c.occupant.deptId);
            const actCfg = deptCfg?.actions.find((a) => a.id === c.occupant.actionId);
            if (actCfg) {
              annualActions.push({
                actionName: actCfg.name,
                styleAlignment: actCfg.styleAlignment,
              });
            }
          }

          const allIds = collectAllStyleIds(styleCfgA);
          const deltas = deriveStyleDeltas(annualActions, allIds);
          for (const [styleId, delta] of Object.entries(deltas)) {
            if (delta !== 0) applyStyleDelta(draft, styleId, delta);
          }
        }
        break;
      }
      case 'style_conflict': {
        draft.vigor = clampAttr('vigor', (draft.vigor ?? 100) - 5, cfg.attributeBounds);
        draft.ambition = clampAttr('ambition', (draft.ambition ?? 100) - 5, cfg.attributeBounds);
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

      const deptState = draft.departmentStates[action.deptId];
      const result = startAction({
        action: actionConfig,
        slotState: draft.slots,
        remainingBudget: draft.remainingBudget,
        currentDay: draft.totalDaysPlayed,
        deptId: action.deptId,
        tierKey: action.tierKey,
        cooldownUntilDay: deptState?.actionCooldownUntilDays?.[action.actionId] ?? 0,
      });

      if (!result.success) break;

      // Phase C: 行动偏离校验
      if (actionConfig.styleAlignment) {
        const devResult = calculateDeviationPenalty(
          draft.philosophy.scores,
          actionConfig.styleAlignment,
          getConfigLoader().getLeadershipStyleConfig().styleSpectrums,
          getConfigLoader().getLeadershipStyleConfig().deviationPenalty,
        );
        // 标记冲突状态供 ADVANCE_TIME 处理
        if (devResult.styleConflictTriggered) {
          (draft as unknown as Record<string, unknown>).pendingStyleConflict = true;
        }
      }

      const occupant: SlotOccupant = {
        actionId: actionConfig.id,
        deptId: action.deptId,
        actionName: actionConfig.name,
        category: actionConfig.category,
        startedAtDay: draft.totalDaysPlayed,
        durationDays: actionConfig.durationDays,
        cooldownDays: actionConfig.cooldownDays,
      };

      const tierKey = result.tierKey;
      const slotIdx = result.slotIndex;
      draft.slots[tierKey].occupants[slotIdx] = occupant;

      draft.remainingBudget -= actionConfig.budgetDelta;
      draft.totalActions += 1;

      if (tierKey === 'reserve') {
        const penalty = cfg.reservePenalty;
        draft.vigor = clampAttr('vigor', (draft.vigor ?? 100) + penalty.vigor, cfg.attributeBounds);
        draft.ambition = clampAttr(
          'ambition',
          (draft.ambition ?? 100) + penalty.ambition,
          cfg.attributeBounds,
        );
      }

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
            if (slotOccupant.category !== 'routine') {
              deptState.actionCooldownUntilDays[slotOccupant.actionId] =
                slotOccupant.startedAtDay + slotOccupant.durationDays + slotOccupant.cooldownDays;
            }
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

          // Phase C: 应用风格增量
          if (effects.styleDeltas) {
            for (const [styleId, delta] of Object.entries(effects.styleDeltas)) {
              applyStyleDelta(draft, styleId, delta);
            }
          }

          // Phase C: 处理风格冲突
          if ((draft as unknown as Record<string, unknown>).pendingStyleConflict) {
            delete (draft as unknown as Record<string, unknown>).pendingStyleConflict;
            draft.vigor = clampAttr('vigor', (draft.vigor ?? 100) - 5, cfgAdv.attributeBounds);
            draft.ambition = clampAttr(
              'ambition',
              (draft.ambition ?? 100) - 5,
              cfgAdv.attributeBounds,
            );
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
            completedAtDay: slotOccupant.startedAtDay + slotOccupant.durationDays,
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
      migrateSaveToPhaseA(draft);
      migrateSaveToPhaseC(draft);
      migrateActionState(draft);
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
            case 'innovation':
            case 'pragmatic':
            case 'principled':
              draft.philosophy.scores[key] = clamp(
                (draft.philosophy.scores[key] ?? 0) + delta,
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
        draft.promotionStage !== PromotionStage.Failed &&
        draft.promotionStage !== PromotionStage.TargetSelection
      ) {
        break;
      }
      draft.promotionStage = PromotionStage.Idle;
      draft.promotionState = null;
      break;
    }
    case 'START_PROMOTION': {
      if (draft.promotionStage !== PromotionStage.Idle) break;
      // 终局状态下不能晋升
      if (draft.endgameReached) break;
      // 冻结期中不能晋升
      if (draft.frozenPeriods > 0) break;
      // 旧岗位行动依赖当前部门配置，必须先完成后再进入晋升流程。
      if (hasActiveActions(draft.slots)) break;

      const nextLevel = draft.currentLevel + 1;
      const lineCfg = getConfigLoader().getCareerLine(draft.currentCareerLine);
      if (!lineCfg) break;
      const nextLevelCfg = lineCfg.levels.find((l) => l.level === nextLevel);
      if (!nextLevelCfg || nextLevelCfg.positions.length === 0) break;

      draft.promotionAttempts += 1;

      // 进入目标选择阶段，等待玩家选择目标职位
      draft.promotionStage = PromotionStage.TargetSelection;
      draft.promotionState = {
        targetPositionId: '',
        targetLevel: nextLevel,
        currentStage: PromotionStage.TargetSelection,
        stageResults: {},
      };
      break;
    }
    case 'SELECT_PROMOTION_TARGET': {
      // 仅在目标选择阶段有效
      if (draft.promotionStage !== PromotionStage.TargetSelection) break;
      const psTarget = draft.promotionState;
      if (!psTarget) break;

      const lineCfgTarget = getConfigLoader().getCareerLine(draft.currentCareerLine);
      if (!lineCfgTarget) break;

      const ctxTarget = buildPromotionContext(draft);
      const validation = validatePromotionTarget(
        action.positionId,
        draft.currentLevel,
        lineCfgTarget,
        ctxTarget,
      );

      if (!validation.valid) {
        draft.promotionStage = PromotionStage.Failed;
        psTarget.currentStage = PromotionStage.Failed;
        psTarget.targetPositionId = action.positionId;
        break;
      }

      // 校验通过，设置目标并进入民主推荐阶段
      psTarget.targetPositionId = action.positionId;
      psTarget.currentStage = PromotionStage.DemocraticVote;
      draft.promotionStage = PromotionStage.DemocraticVote;
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
            draft.ambition = clamp(
              (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
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
            draft.ambition = clamp(
              (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnRejected,
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
            draft.ambition = clamp(
              (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
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
            draft.ambition = clamp(
              (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
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
            draft.ambition = clamp(
              (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
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
            // L11 达成后设置终局状态
            if (ps.targetLevel >= 11) {
              draft.endgameReached = true;
            }
          } else {
            draft.promotionStage = PromotionStage.Failed;
            ps.currentStage = PromotionStage.Failed;
            draft.ambition = clamp(
              (draft.ambition ?? 100) - cfgPromoStore.promotion.progression.ambitionOnFail,
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
