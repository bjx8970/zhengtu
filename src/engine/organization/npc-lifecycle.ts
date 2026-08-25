/**
 * NPC 干部年度生命周期 Engine。
 *
 * 这是一个只读输入、纯输出的年度结算器：按稳定干部 ID 计算考核、职级资格和离任，
 * 同时返回可供统一信号管道消费的审计信号。它不读取 Store、配置单例或页面状态。
 */

import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import type { NpcLifecycleConfig } from '../../types/config';
import type { CadreProfile, OrganizationState } from '../../types/organization';
import { closeNpcAppointment } from './npc-lifecycle-departure';

/** NPC 年度结算的全部显式依赖。 */
export interface NpcLifecycleSettlementInput {
  organization: Readonly<OrganizationState>;
  currentDay: number;
  currentYear: number;
  daysPerYear: number;
  config: NpcLifecycleConfig;
  rankProgressionRules: readonly CivilServiceRankProgressionRule[];
  rng: () => number;
  idFactory: () => string;
}

/** NPC 年度结算结果，不包含任何 Store 副作用。 */
export interface NpcLifecycleSettlementResult {
  organization: OrganizationState;
  signals: DomainSignalSnapshot[];
  settledCadreIds: string[];
  departureIds: string[];
}

function tierForScore(score: number, config: NpcLifecycleConfig['annualAssessment']): string {
  if (score >= config.excellentThreshold) return '优秀';
  if (score >= config.competentThreshold) return '称职';
  if (score >= config.basicThreshold) return '基本称职';
  return '不称职';
}

function serviceDays(cadre: CadreProfile, currentDay: number): number {
  return cadre.experiences.reduce(
    (total, experience) => total + (experience.endedAtDay ?? currentDay) - experience.startedAtDay,
    0,
  );
}

function specialtyScore(cadre: CadreProfile): number {
  const values = Object.values(cadre.specialties);
  return values.length === 0
    ? 50
    : values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * 结算一个年度的 NPC 生命周期；同一年度调用必须由调用方以 producer key 去重。
 *
 * @param input 显式组织快照、结算日、配置、规则和 RNG
 * @returns 新组织快照、年度信号及离任事实
 */
export function settleNpcLifecycle(
  input: NpcLifecycleSettlementInput,
): NpcLifecycleSettlementResult {
  const organization = structuredClone(input.organization);
  const signals: DomainSignalSnapshot[] = [];
  const settledCadreIds: string[] = [];
  const departureIds: string[] = [];
  const assessmentConfig = input.config.annualAssessment;
  const rules = new Map(input.rankProgressionRules.map((rule) => [rule.fromRank, rule]));

  for (const cadre of organization.cadres.sort((left, right) =>
    left.cadreId.localeCompare(right.cadreId),
  )) {
    if (cadre.status !== 'active') continue;
    const randomOffset = (input.rng() - 0.5) * 2 * assessmentConfig.randomSpread;
    const tenureYears = serviceDays(cadre, input.currentDay) / input.daysPerYear;
    const historyAverage =
      cadre.assessments.length === 0
        ? 0
        : cadre.assessments.reduce((total, assessment) => total + assessment.score, 0) /
          cadre.assessments.length;
    const score = Math.max(
      0,
      Math.min(
        100,
        assessmentConfig.baseScore +
          specialtyScore(cadre) * assessmentConfig.specialtyWeight +
          tenureYears * assessmentConfig.tenureBonusPerYear +
          historyAverage * assessmentConfig.historyWeight +
          randomOffset,
      ),
    );
    const tier = tierForScore(score, assessmentConfig);
    const assessment = { year: input.currentYear, score, tier };
    cadre.assessments.push(assessment);
    const openExperience = cadre.experiences.find((experience) => experience.endedAtDay === null);
    if (openExperience) openExperience.assessmentResults.push({ ...assessment });
    settledCadreIds.push(cadre.cadreId);
    signals.push({
      signalId: input.idFactory(),
      signalType: 'assessment.completed',
      occurredAtDay: input.currentDay,
      data: { year: input.currentYear, score, tier },
    });

    const rankRule = rules.get(cadre.civilServiceRank);
    const qualifiedCount = cadre.assessments.filter(
      (item) => item.tier === '优秀' || item.tier === '称职',
    ).length;
    const excellentCount = cadre.assessments.filter((item) => item.tier === '优秀').length;
    if (
      rankRule &&
      cadre.assessments.length >=
        Math.max(rankRule.minAssessmentCount, input.config.rankProgression.minAssessmentCount) &&
      qualifiedCount >=
        Math.max(
          rankRule.minQualifiedAssessmentCount,
          input.config.rankProgression.minQualifiedAssessmentCount,
        ) &&
      excellentCount >=
        Math.max(
          rankRule.minExcellentAssessmentCount,
          input.config.rankProgression.minExcellentAssessmentCount,
        ) &&
      input.currentDay - cadre.civilServiceRankStartedAtDay >= rankRule.minDaysInRank &&
      serviceDays(cadre, input.currentDay) >= rankRule.minServiceDays
    ) {
      const previousRank = cadre.civilServiceRank;
      cadre.civilServiceRank = rankRule.toRank;
      cadre.civilServiceRankStartedAtDay = input.currentDay;
      signals.push({
        signalId: input.idFactory(),
        signalType: 'civil_service_rank.changed',
        occurredAtDay: input.currentDay,
        data: {
          rankChangeId: `npc-rank:${cadre.cadreId}:${input.currentYear}`,
          previousRank,
          currentRank: rankRule.toRank,
          reason: 'regular_advancement',
          sourceType: 'system',
          sourceId: `npc-annual:${input.currentYear}:${cadre.cadreId}`,
        },
      });
    }

    const age = input.currentYear - cadre.birthYear;
    const failures = [...cadre.assessments].reverse().findIndex((item) => item.tier !== '不称职');
    const consecutiveFailures = failures < 0 ? cadre.assessments.length : failures;
    const departureReason =
      age >= input.config.retirement.minimumAge
        ? 'retirement'
        : consecutiveFailures >= input.config.exit.consecutiveFailureThreshold
          ? 'disciplinary_exit'
          : null;
    if (departureReason && cadre.currentAppointment) {
      const departure = closeNpcAppointment(organization, cadre, input.currentDay, departureReason);
      organization.departures.push(departure);
      departureIds.push(departure.departureId);
      signals.push({
        signalId: input.idFactory(),
        signalType: 'appointment.changed',
        occurredAtDay: input.currentDay,
        data: {
          experienceId: departure.experienceId,
          positionId: departure.positionId,
          institutionId: departure.institutionId,
          regionId: departure.regionId,
          previousPositionId: departure.positionId,
        },
      });
    }
  }
  return { organization, signals, settledCadreIds, departureIds };
}
