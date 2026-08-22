/**
 * 职务与职级页面。
 *
 * 展示当前任职、公务员职级、岗位机会与职业履历，并仅通过既有 Store
 * Action 处理职级晋升和岗位选拔，职业资格与结算仍由领域内核裁定。
 */

import { createMemo, For, Show } from 'solid-js';
import { getConfigLoader } from '../../config/loader';
import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import {
  CIVIL_SERVICE_RANK_LABELS,
  INSTITUTION_LEVEL_LABELS,
  LEADERSHIP_RANK_LABELS,
} from '../../domain/career/types';
import {
  calculateCareerServiceDays,
  evaluateCivilServiceRankEligibility,
  getActiveCareerRestrictions,
} from '../../engine/career/civil-service-rank-eligibility';
import { inspectProbationProgress } from '../../engine/career/probation-progress';
import {
  evaluateCareerOpportunityAcceptanceEligibility,
  type CareerOpportunityEligibilityFailure,
} from '../../engine/career/career-opportunity-eligibility';
import { useGameStore } from '../../store/game-store';
import { PageHeader } from '../../components/page-header';
import {
  formatCareerProcessStage,
  formatCareerRegion,
  formatCareerRestriction,
  formatOpportunityEligibilityFailure,
  formatOpportunitySource,
  formatOpportunityStatus,
  formatRankFailure,
} from './career-display';

const SELECTION_STAGES = [
  'eligibility_review',
  'democratic_recommendation',
  'organization_inspection',
  'collective_decision',
  'public_notice',
  'appointment',
  'probation',
  'finalization',
] as const;

/**
 * @param failure 共享职业机会资格判定失败原因
 * @returns 用于界面展示的资格状态文本
 */
function formatOpportunityEligibility(failure: CareerOpportunityEligibilityFailure | null): string {
  return failure === null ? '符合资格' : formatOpportunityEligibilityFailure(failure);
}

/**
 * @param rule 当前职级的晋升规则
 * @returns 用于页面显示的考核要求说明。
 */
function formatAssessmentRequirement(rule: CivilServiceRankProgressionRule | null): string {
  if (!rule) return '已无下一职级';
  return `累计 ${rule.minAssessmentCount} 次考核，其中称职及以上 ${rule.minQualifiedAssessmentCount} 次，优秀 ${rule.minExcellentAssessmentCount} 次`;
}

/**
 * @param startDay 任职开始日
 * @param endDay 任职结束日，空值表示至今
 * @param currentDay 当前绝对日
 * @returns 任期天数显示。
 */
function formatTenureDays(startDay: number, endDay: number | null, currentDay: number): string {
  return `${Math.max((endDay ?? currentDay) - startDay, 0)} 天`;
}

/**
 * 职务与职级页面组件。
 *
 * @returns 职业信息与操作页面 JSX。
 */
export function CareerPage() {
  const { state, dispatch } = useGameStore();
  const currentDay = () => state.time.totalDaysPlayed;

  const currentPosition = createMemo(() =>
    getConfigLoader().getPositionById(state.career.appointment.positionId),
  );
  const currentInstitution = createMemo(() =>
    getConfigLoader().getInstitutionById(state.career.appointment.institutionId),
  );
  const rankRule = createMemo(() =>
    getConfigLoader().getCivilServiceRankProgressionRule(state.career.civilServiceRank),
  );
  const rankEligibility = createMemo(() => {
    const config = getConfigLoader().getGameConfig();
    return evaluateCivilServiceRankEligibility(
      state,
      currentDay(),
      config.daysPerMonth * config.monthsPerYear,
      rankRule(),
    );
  });
  const nextRankName = createMemo(() => {
    const next = rankEligibility().toRank;
    return next ? CIVIL_SERVICE_RANK_LABELS[next] : '无';
  });
  const activeRestrictions = createMemo(() =>
    getActiveCareerRestrictions(state.career.restrictions, currentDay()),
  );
  const serviceDays = createMemo(() =>
    calculateCareerServiceDays(state.career.appointment, state.career.experiences, currentDay()),
  );
  const quotaState = createMemo(() => {
    const quota = rankRule()?.quotaRequirement;
    if (!quota) return { inventory: '不适用', source: '当前职级无需职数' };
    return {
      inventory: `${state.world.metrics[quota.metricId] ?? 0}/${quota.maxValue}`,
      source: `${quota.grantAssessmentTiers.join('或')}年度考核补充 ${quota.annualGrant}，晋升消耗 ${quota.consumeValue}`,
    };
  });
  const latestRankChange = createMemo(
    () => state.career.civilServiceRankHistory[state.career.civilServiceRankHistory.length - 1],
  );
  const sortedExperiences = createMemo(() =>
    [...state.career.experiences].sort((left, right) => right.startedAtDay - left.startedAtDay),
  );
  const probationProgress = createMemo(() => {
    const probation = state.career.appointment.probation;
    if (!probation) return null;
    return inspectProbationProgress({
      currentDay: currentDay(),
      probation,
      attributes: {
        competence: state.character.competence,
        diligence: state.character.diligence,
        integrity: state.character.integrity,
        stability: state.character.stability,
      },
      restrictions: state.career.restrictions,
      config: getConfigLoader().getGameConfig().probation,
    });
  });

  return (
    <>
      <PageHeader
        eyebrow="职业 · CAREER"
        title="职务与职级"
        desc="职务任职与公务员职级为两条独立发展通道"
      />

      <div class="flex-col gap-lg">
        {/* 任职事实 */}
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            {state.career.appointment.status === 'active' ? '当前任职' : '已结束任职'}
          </div>
          <div class="card-pad">
            <div class="stat-grid">
              <CareerFact label="具体职位" value={currentPosition()?.name ?? '未分配职位'} />
              <CareerFact label="所属机构" value={currentInstitution()?.name ?? '未知机构'} />
              <CareerFact
                label="所在地区"
                value={formatCareerRegion(state.career.appointment.regionId)}
              />
              <CareerFact
                label="机构层级"
                value={INSTITUTION_LEVEL_LABELS[state.career.appointment.institutionLevel]}
              />
              <CareerFact
                label="领导职务层次"
                value={LEADERSHIP_RANK_LABELS[state.career.appointment.leadershipRank]}
              />
              <CareerFact
                label="任职时长"
                value={formatTenureDays(
                  state.career.appointment.startedAtDay,
                  state.career.appointment.endedAtDay,
                  currentDay(),
                )}
              />
            </div>
          </div>
        </section>

        <Show when={state.career.appointment.probation}>
          {(probation) => (
            <section class="card" data-testid="probation-status-card">
              <div class="card-title">
                <span class="card-title-mark" aria-hidden="true" />
                录用试用期
                <span class="flex-1" />
                <span
                  class={
                    probation().status === 'passed'
                      ? 'tag tag-green'
                      : probation().status === 'failed'
                        ? 'tag tag-red'
                        : 'tag tag-blue'
                  }
                  data-testid="probation-status"
                >
                  {probation().status === 'passed'
                    ? '已转正'
                    : probation().status === 'failed'
                      ? '不予转正'
                      : probation().extensionCount > 0
                        ? '延期考察中'
                        : '试用中'}
                </span>
              </div>
              <div class="card-pad flex-col gap-md">
                <div class="stat-grid">
                  <CareerFact
                    label="距评估"
                    value={
                      probation().status === 'active'
                        ? `${probationProgress()?.remainingDays ?? 0} 天`
                        : `第 ${probation().resolvedAtDay ?? probation().endsAtDay} 天已结算`
                    }
                  />
                  <CareerFact
                    label="完成行动"
                    value={`${probation().completedActionCount}/${probationProgress()?.minimumCompletedActions ?? 0}`}
                  />
                  <CareerFact label="当前评价分" value={`${probationProgress()?.score ?? 0}`} />
                  <CareerFact
                    label="延期次数"
                    value={`${probation().extensionCount}/${probationProgress()?.maxExtensions ?? 0}`}
                  />
                </div>
                <Show when={probation().status === 'active'}>
                  <div class="flex-col gap-sm">
                    <h3 class="text-sm">转正条件</h3>
                    <For each={probationProgress()?.requirements ?? []}>
                      {(requirement) => (
                        <p class="text-sm secondary-text">
                          {requirement.satisfied ? '✓' : '○'} {requirement.detail}
                        </p>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={probation().outcomeReason}>
                  <p
                    class={
                      probation().status === 'failed'
                        ? 'banner banner-danger'
                        : probation().status === 'passed'
                          ? 'banner banner-success'
                          : 'banner banner-warning'
                    }
                    data-testid="probation-feedback"
                  >
                    {probation().outcomeReason}
                  </p>
                </Show>
                <Show when={probation().evaluations.length > 0}>
                  <p class="text-xs secondary-text">
                    已保存 {probation().evaluations.length} 次评估记录，刷新或读档后仍可审计。
                  </p>
                </Show>
              </div>
            </section>
          )}
        </Show>

        {/* 公务员职级 */}
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            公务员职级
            <span class="flex-1" />
            <Show when={rankEligibility().eligible}>
              <button
                data-testid="advance-civil-service-rank"
                class="btn btn-primary btn-sm"
                onClick={() => dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK' })}
              >
                办理职级晋升至 {nextRankName()}
              </button>
            </Show>
          </div>
          <div class="card-pad flex-col gap-md">
            <p class="doc-meta">职级晋升由服务年限、考核和职数共同决定。</p>
            <div class="stat-grid">
              <CareerFact
                label="当前职级"
                value={CIVIL_SERVICE_RANK_LABELS[state.career.civilServiceRank]}
              />
              <CareerFact label="下一职级" value={nextRankName()} />
              <CareerFact
                label="任职级天数"
                value={`${currentDay() - state.career.civilServiceRankStartedAtDay} 天`}
              />
              <CareerFact label="总服务天数" value={`${serviceDays()} 天`} />
              <CareerFact label="考核要求" value={formatAssessmentRequirement(rankRule())} />
              <CareerFact label="职数库存" value={quotaState().inventory} />
              <CareerFact label="职数来源" value={quotaState().source} />
            </div>

            <Show when={latestRankChange()}>
              {(change) => (
                <p class="banner banner-success" data-testid="rank-change-feedback">
                  最近一次职级晋升：{CIVIL_SERVICE_RANK_LABELS[change().previousRank]} →{' '}
                  {CIVIL_SERVICE_RANK_LABELS[change().currentRank]}
                  。仅职级发生变化，具体职位、所属机构和领导职务均未变化。
                </p>
              )}
            </Show>

            <div class="flex-col gap-sm">
              <h3 class="text-sm">晋升资格</h3>
              <Show
                when={!rankEligibility().eligible}
                fallback={<p class="banner banner-success">已满足全部条件，可提交正式晋升。</p>}
              >
                <ul class="flex-col gap-sm text-sm secondary-text" style={{ 'list-style': 'none' }}>
                  <For each={rankEligibility().failures}>
                    {(failure) => (
                      <li>
                        {'· '}
                        {formatRankFailure(failure.reason)}：{failure.detail}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>

            <div class="flex-col gap-sm">
              <h3 class="text-sm">冻结或处分</h3>
              <Show
                when={activeRestrictions().length > 0}
                fallback={<p class="text-sm muted">当前无生效中的职业限制。</p>}
              >
                <ul class="flex-col gap-sm text-sm" style={{ 'list-style': 'none' }}>
                  <For each={activeRestrictions()}>
                    {(restriction) => (
                      <li class="banner banner-danger">
                        {formatCareerRestriction(restriction.type)}：{restriction.reason}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </div>
        </section>

        {/* 岗位机会 */}
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            岗位机会
          </div>
          <div class="card-pad flex-col gap-md">
            <p class="doc-meta">岗位变动需接受机会并按流程完成选拔；职级不会由此自动变化。</p>
            <Show
              when={state.career.opportunities.length > 0}
              fallback={
                <p class="text-sm muted">暂无岗位机会。年度考核与后续内容会带来新的机会。</p>
              }
            >
              <div class="flex-col gap-md">
                <For each={state.career.opportunities}>
                  {(opportunity) => {
                    const eligibility = createMemo(() =>
                      evaluateCareerOpportunityAcceptanceEligibility({
                        opportunity,
                        state,
                        currentDay: currentDay(),
                        daysPerYear:
                          getConfigLoader().getGameConfig().daysPerMonth *
                          getConfigLoader().getGameConfig().monthsPerYear,
                        targetPosition:
                          opportunity.type === 'training'
                            ? null
                            : getConfigLoader().getPositionById(opportunity.target.positionId),
                        careerExperienceQualificationRules:
                          getConfigLoader().getCareerExperienceQualificationRules(),
                      }),
                    );
                    const target = () =>
                      opportunity.type === 'training' ? null : opportunity.target;
                    const targetSnapshot = target();
                    return (
                      <article class="card">
                        <div class="card-pad flex-col gap-sm">
                          <div class="flex between gap-md">
                            <div>
                              <h3 class="serif" style={{ 'font-size': '1.05rem' }}>
                                {targetSnapshot?.positionName ?? '培训机会'}
                              </h3>
                              <p class="text-xs secondary-text">{opportunity.reason}</p>
                            </div>
                            <span class="tag tag-blue">
                              {formatOpportunityStatus(opportunity.status)}
                            </span>
                          </div>
                          <div
                            class="flex gap-sm text-xs secondary-text"
                            style={{ 'flex-wrap': 'wrap' }}
                          >
                            <OpportunityFact
                              label="来源"
                              value={formatOpportunitySource(opportunity.source.sourceType)}
                            />
                            <OpportunityFact
                              label="目标机构"
                              value={targetSnapshot?.institutionName ?? '不适用'}
                            />
                            <OpportunityFact
                              label="目标地区"
                              value={
                                targetSnapshot
                                  ? formatCareerRegion(targetSnapshot.regionId)
                                  : '不适用'
                              }
                            />
                            <OpportunityFact
                              label="领导职务层次"
                              value={
                                targetSnapshot
                                  ? LEADERSHIP_RANK_LABELS[targetSnapshot.leadershipRank]
                                  : '不适用'
                              }
                            />
                            <OpportunityFact
                              label="截止日"
                              value={
                                opportunity.expiresAtDay === null
                                  ? '无截止日'
                                  : `第 ${opportunity.expiresAtDay} 天`
                              }
                            />
                            <OpportunityFact
                              label="资格状态"
                              value={formatOpportunityEligibility(eligibility().failure)}
                            />
                          </div>
                          <Show when={opportunity.status === 'available'}>
                            <div class="flex gap-sm">
                              <button
                                data-testid={`accept-opportunity-${opportunity.id}`}
                                class="btn btn-primary btn-sm"
                                disabled={!eligibility().eligible}
                                onClick={() =>
                                  dispatch({
                                    type: 'ACCEPT_CAREER_OPPORTUNITY',
                                    opportunityId: opportunity.id,
                                  })
                                }
                              >
                                接受
                              </button>
                              <button
                                class="btn btn-sm"
                                onClick={() =>
                                  dispatch({
                                    type: 'REJECT_CAREER_OPPORTUNITY',
                                    opportunityId: opportunity.id,
                                  })
                                }
                              >
                                拒绝
                              </button>
                              <button
                                class="btn btn-sm"
                                onClick={() =>
                                  dispatch({
                                    type: 'CANCEL_CAREER_OPPORTUNITY',
                                    opportunityId: opportunity.id,
                                  })
                                }
                              >
                                取消
                              </button>
                            </div>
                          </Show>
                        </div>
                      </article>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* 当前选拔流程 */}
            <Show when={state.career.activeProcess}>
              {(process) => (
                <article class="card" style={{ 'border-color': 'var(--color-secondary)' }}>
                  <div class="card-pad flex-col gap-md">
                    <div class="flex between center">
                      <div>
                        <h3 class="serif" style={{ 'font-size': '1.05rem' }}>
                          当前选拔流程
                        </h3>
                        <p class="text-xs secondary-text">
                          当前阶段：{formatCareerProcessStage(process().currentStage)}
                        </p>
                      </div>
                      <button
                        data-testid={`advance-career-process-${process().opportunityId}`}
                        class="btn btn-primary btn-sm"
                        onClick={() =>
                          dispatch({
                            type: 'ADVANCE_CAREER_PROCESS',
                            opportunityId: process().opportunityId,
                          })
                        }
                      >
                        推进当前阶段
                      </button>
                    </div>
                    <div class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
                      <For each={SELECTION_STAGES}>
                        {(stage) => {
                          const isDone = () =>
                            process().stageResults.some((item) => item.stage === stage);
                          const isCurrent = () => process().currentStage === stage;
                          return (
                            <span
                              class={
                                isDone()
                                  ? 'tag tag-green'
                                  : isCurrent()
                                    ? 'tag tag-red'
                                    : 'tag tag-gray'
                              }
                            >
                              {formatCareerProcessStage(stage)}
                            </span>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </article>
              )}
            </Show>
          </div>
        </section>

        {/* 职业履历 */}
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            职业履历
          </div>
          <div class="card-pad">
            <div class="timeline">
              <For each={sortedExperiences()}>
                {(experience) => (
                  <div class="timeline-item">
                    <div class="timeline-dot major" aria-hidden="true" />
                    <div class="flex-1">
                      <b class="text-sm">{experience.positionNameSnapshot}</b>
                      <div class="text-xs secondary-text">
                        {experience.institutionNameSnapshot} ·{' '}
                        {formatCareerRegion(experience.regionId)} ·{' '}
                        {LEADERSHIP_RANK_LABELS[experience.leadershipRank]}
                      </div>
                    </div>
                    <div class="text-xs secondary-text" style={{ 'text-align': 'right' }}>
                      第 {experience.startedAtDay} 天起 ·{' '}
                      {formatTenureDays(
                        experience.startedAtDay,
                        experience.endedAtDay,
                        currentDay(),
                      )}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/** 职业事实信息块。 */
function CareerFact(props: { label: string; value: string }) {
  return (
    <div class="stat">
      <div class="stat-value">{props.value}</div>
      <div class="stat-label">{props.label}</div>
    </div>
  );
}

/** 岗位机会信息块。 */
function OpportunityFact(props: { label: string; value: string }) {
  return (
    <span>
      <span class="muted">{props.label}：</span>
      {props.value}
    </span>
  );
}
