/**
 * 基层组织政治周期 Engine。
 *
 * 周期事实、届期评估和周期调整均为纯转换；事务层负责把结果写回
 * PlayerSave，并使用 producer key 保证时间轴重放不会重复产生 Vacancy。
 */

import type {
  PoliticalCyclePhaseDurations,
  PoliticalCycleState,
  WorldState,
} from '../../domain/world-state';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { OrganizationState, VacancyLifecycleResult } from '../../types/organization';
import { openVacancy } from './vacancy-lifecycle';

const PHASES: PoliticalCycleState['phase'][] = [
  'preparation',
  'session',
  'implementation',
  'evaluation',
];

/** 届期评估的纯结果。 */
export interface PoliticalCycleEvaluation {
  cycle: PoliticalCycleState;
  completed: boolean;
  evaluatedAtDay: number | null;
}

/** 周期阶段推进结果。 */
export interface PoliticalCycleAdvanceResult {
  world: WorldState;
  transitions: Array<{ type: PoliticalCycleState['type']; from: string; to: string }>;
  evaluations: PoliticalCycleEvaluation[];
}

function phaseAtDay(
  cycle: PoliticalCycleState,
  currentDay: number,
  durations: PoliticalCyclePhaseDurations,
): PoliticalCycleState['phase'] {
  const elapsed = Math.max(0, currentDay - cycle.startedAtDay);
  const preparationEnd = durations.preparation;
  const sessionEnd = preparationEnd + durations.session;
  const implementationEnd = sessionEnd + durations.implementation;
  if (elapsed < preparationEnd) return 'preparation';
  if (elapsed < sessionEnd) return 'session';
  if (elapsed < implementationEnd) return 'implementation';
  return 'evaluation';
}

/**
 * 创建一个可重放的政治周期状态。
 *
 * @param type 周期类型
 * @param termNumber 届次
 * @param startedAtDay 周期起始绝对日
 * @param endsAtDay 周期结束绝对日
 * @returns 初始处于 preparation 阶段的周期
 */
export function createPoliticalCycle(
  type: PoliticalCycleState['type'],
  termNumber: number,
  startedAtDay: number,
  endsAtDay: number,
): PoliticalCycleState {
  if (endsAtDay <= startedAtDay) throw new Error('Political cycle must have a positive duration');
  return { type, termNumber, startedAtDay, endsAtDay, phase: 'preparation' };
}

/**
 * 按绝对日推进所有活跃周期，并在届期结束时产生一次评估。
 *
 * @param world 当前世界状态
 * @param currentDay 当前绝对日
 * @param durations 四个阶段的持续天数
 * @returns 新世界状态、阶段变更审计及评估结果
 */
export function advancePoliticalCycles(
  world: Readonly<WorldState>,
  currentDay: number,
  durations: PoliticalCyclePhaseDurations,
): PoliticalCycleAdvanceResult {
  const next = structuredClone(world);
  const transitions: PoliticalCycleAdvanceResult['transitions'] = [];
  const evaluations: PoliticalCycleEvaluation[] = [];
  for (const cycle of next.activeCycles) {
    const previous = cycle.phase;
    const phase = phaseAtDay(cycle, currentDay, durations);
    if (PHASES.indexOf(phase) > PHASES.indexOf(previous)) {
      cycle.phase = phase;
      transitions.push({ type: cycle.type, from: previous, to: phase });
    }
    const completed = currentDay >= cycle.endsAtDay;
    evaluations.push({
      cycle: structuredClone(cycle),
      completed,
      evaluatedAtDay: completed ? cycle.endsAtDay : null,
    });
  }
  return { world: next, transitions, evaluations };
}

/**
 * 生成周期调整释放的 Vacancy；每个 cycle/seat 组合只可生产一次。
 *
 * @param input 组织、周期、待释放席位和稳定 ID 工厂
 * @returns 原子 Vacancy producer 结果
 */
export function producePoliticalCycleVacancies(input: {
  organization: Readonly<OrganizationState>;
  cycle: PoliticalCycleState;
  seatIds: readonly string[];
  idFactory: () => string;
}): VacancyLifecycleResult {
  let organization = structuredClone(input.organization);
  let vacancy: OrganizationState['vacancies'][number] | null = null;
  const emittedSignals: DomainSignalSnapshot[] = [];
  for (const seatId of [...input.seatIds].sort()) {
    const key = `vacancy:political_cycle:${input.cycle.type}:${input.cycle.termNumber}:${seatId}`;
    const vacancyId = `vacancy:political_cycle:${input.cycle.type}:${input.cycle.termNumber}:${seatId}`;
    const existing = organization.vacancies.find((item) => item.vacancyId === vacancyId);
    if (organization.processedProducerKeys.includes(key)) {
      if (!existing) return { success: false, error: 'producer_conflict', detail: key };
      continue;
    }
    const result = openVacancy({
      organization,
      currentDay: input.cycle.endsAtDay,
      idFactory: input.idFactory,
      seatId,
      reason: 'political_cycle',
      sourceType: 'political_cycle',
      sourceId: `${input.cycle.type}:${input.cycle.termNumber}`,
      closesAtDay: null,
      vacancyId,
    });
    if (!result.success) return result;
    organization = result.organization;
    vacancy = result.vacancy;
    emittedSignals.push(...result.emittedSignals);
    organization.processedProducerKeys.push(key);
  }
  return { success: true, organization, vacancy, emittedSignals };
}
