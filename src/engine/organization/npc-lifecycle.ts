/**
 * NPC 干部年度生命周期 Engine。
 *
 * 这是一个只读输入、纯输出的年度结算器：按稳定干部 ID 计算考核、职级资格和离任，
 * 同时返回可供统一信号管道消费的审计信号。它不读取 Store、配置单例或页面状态。
 */

import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import type { NpcLifecycleConfig } from '../../types/config';
import type { CadreProfile, OrganizationState } from '../../types/organization';
import { closeNpcAppointment, recordUnassignedNpcDeparture } from './npc-lifecycle-departure';

/** NPC 年度结算的全部显式依赖。 */
export interface NpcLifecycleSettlementInput {
  organization: Readonly<OrganizationState>;
  currentDay: number;
  currentYear: number;
  daysPerYear: number;
  config: NpcLifecycleConfig;
  rankProgressionRules: readonly CivilServiceRankProgressionRule[];
  rng: () => number;
  /** NPC 世界指标快照；用于消费 progression rule 的 quotaRequirement。 */
  rankQuotaValues?: Readonly<Record<string, number>>;
}

/** NPC 年度结算结果，不包含任何 Store 副作用。 */
export interface NpcLifecycleSettlementResult {
  organization: OrganizationState;
  settledCadreIds: string[];
  assessments: Array<{ cadreId: string; year: number; score: number; tier: string }>;
  rankChanges: Array<{ cadreId: string; previousRank: string; currentRank: string }>;
  quotaChanges: Array<{ metricId: string; consumedValue: number }>;
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
 * @returns 新组织快照、年度审计结果及离任事实
 */
export function settleNpcLifecycle(
  input: NpcLifecycleSettlementInput,
): NpcLifecycleSettlementResult {
  const organization = structuredClone(input.organization);
  const settledCadreIds: string[] = [];
  const assessments: NpcLifecycleSettlementResult['assessments'] = [];
  const rankChanges: NpcLifecycleSettlementResult['rankChanges'] = [];
  const quotaChanges: NpcLifecycleSettlementResult['quotaChanges'] = [];
  const departureIds: string[] = [];
  // 晋升按稳定 cadreId 串行结算；内部账本让同一年度后续干部看到前序消费。
  // 浅拷贝保证 Engine 不会修改调用方传入的世界指标快照。
  const remainingRankQuotaValues = { ...(input.rankQuotaValues ?? {}) };
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
    assessments.push({ cadreId: cadre.cadreId, ...assessment });

    // 离任判定紧跟年度考核事实写入；退休或退出干部不得先晋升并抢占同年职数。
    const age = input.currentYear - cadre.birthYear;
    const failures = [...cadre.assessments].reverse().findIndex((item) => item.tier !== '不称职');
    const consecutiveFailures = failures < 0 ? cadre.assessments.length : failures;
    const departureReason =
      age >= input.config.retirement.minimumAge
        ? 'retirement'
        : consecutiveFailures >= input.config.exit.consecutiveFailureThreshold
          ? 'disciplinary_exit'
          : null;
    if (departureReason) {
      const departure = cadre.currentAppointment
        ? closeNpcAppointment(organization, cadre, input.currentDay, departureReason)
        : recordUnassignedNpcDeparture(cadre, input.currentDay, departureReason);
      organization.departures.push(departure);
      departureIds.push(departure.departureId);
      continue;
    }

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
      input.currentDay - cadre.civilServiceRankStartedAtDay >=
        Math.max(rankRule.minDaysInRank, input.config.rankProgression.minDaysInRank) &&
      serviceDays(cadre, input.currentDay) >=
        Math.max(rankRule.minServiceDays, input.config.rankProgression.minServiceDays) &&
      (rankRule.quotaRequirement === null ||
        ((remainingRankQuotaValues[rankRule.quotaRequirement.metricId] ?? 0) >=
          rankRule.quotaRequirement.requiredValue &&
          (remainingRankQuotaValues[rankRule.quotaRequirement.metricId] ?? 0) >=
            rankRule.quotaRequirement.consumeValue)) &&
      rankRule.additionalConditions.length === 0 &&
      !cadre.restrictions.some(
        (restriction) =>
          input.config.rankProgression.blockedRestrictionTypes.includes(restriction.type) &&
          restriction.startedAtDay <= input.currentDay &&
          (restriction.endsAtDay === null || input.currentDay < restriction.endsAtDay),
      )
    ) {
      const previousRank = cadre.civilServiceRank;
      cadre.civilServiceRank = rankRule.toRank;
      cadre.civilServiceRankStartedAtDay = input.currentDay;
      rankChanges.push({
        cadreId: cadre.cadreId,
        previousRank,
        currentRank: rankRule.toRank,
      });
      if (rankRule.quotaRequirement)
        remainingRankQuotaValues[rankRule.quotaRequirement.metricId] =
          (remainingRankQuotaValues[rankRule.quotaRequirement.metricId] ?? 0) -
          rankRule.quotaRequirement.consumeValue;
      if (rankRule.quotaRequirement)
        quotaChanges.push({
          metricId: rankRule.quotaRequirement.metricId,
          consumedValue: rankRule.quotaRequirement.consumeValue,
        });
    }
  }
  return {
    organization,
    settledCadreIds,
    assessments,
    rankChanges,
    quotaChanges,
    departureIds,
  };
}
