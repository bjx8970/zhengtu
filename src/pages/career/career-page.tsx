/**
 * 职务与职级页面。
 *
 * 展示当前任职、公务员职级、岗位机会与职业履历，并仅通过既有 Store
 * Action 处理职级晋升和岗位选拔，职业资格与结算仍由领域内核裁定。
 */

import { createMemo, For, Show } from 'solid-js';
import { getConfigLoader } from '../../config/loader';
import type { CivilServiceRankProgressionRule } from '../../config/schemas';
import type { ConditionExpression } from '../../domain/conditions';
import type { CareerOpportunity } from '../../domain/career/state';
import {
  CIVIL_SERVICE_RANK_LABELS,
  INSTITUTION_LEVEL_LABELS,
  LEADERSHIP_RANK_LABELS,
} from '../../domain/career/types';
import {
  evaluateCivilServiceRankEligibility,
  getActiveCareerRestrictions,
} from '../../engine/career/civil-service-rank-eligibility';
import { evaluateCondition } from '../../engine/events/condition-interpreter';
import { useGameStore } from '../../store/game-store';
import type { PlayerSave } from '../../types/player';
import { AppShell } from '../../components/app-shell';
import { PageHeader } from '../../components/page-header';
import {
  formatCareerProcessStage,
  formatCareerRegion,
  formatCareerRestriction,
  formatOpportunitySource,
  formatOpportunityStatus,
  formatRankFailure,
} from './career-display';
import { colors, darkCardStyle, font, pillStyle } from '../../utils/theme';

const SELECTION_STAGES = [
  'eligibility_review',
  'democratic_recommendation',
  'organization_inspection',
  'collective_decision',
  'public_notice',
  'appointment',
  'finalization',
] as const;

type OpportunityEligibility = { eligible: boolean; detail: string };

const neutralButtonStyle = {
  padding: '7px 11px',
  border: `1px solid ${colors.border}`,
  'border-radius': '4px',
  background: '#fff',
  color: colors.textSecondary,
  'font-size': '12px',
  'font-weight': 700,
  cursor: 'pointer',
};

const primaryButtonStyle = {
  ...neutralButtonStyle,
  border: `1px solid ${colors.primary}`,
  background: colors.primary,
  color: '#fff',
};

/**
 * @param condition 配置条件表达式
 * @returns 条件是否依赖一次性信号载荷。
 */
function containsSignalFieldCondition(condition: ConditionExpression): boolean {
  if ('signalField' in condition) return true;
  if ('all' in condition) return condition.all.some(containsSignalFieldCondition);
  if ('any' in condition) return condition.any.some(containsSignalFieldCondition);
  return 'not' in condition && containsSignalFieldCondition(condition.not);
}

/**
 * @param conditions 待检查的条件集合
 * @param state 当前存档
 * @param currentDay 当前绝对日
 * @param opportunity 冻结机会快照
 * @returns 条件集合是否满足。
 */
function satisfiesOpportunityConditions(
  conditions: readonly ConditionExpression[],
  state: Readonly<PlayerSave>,
  currentDay: number,
  opportunity: CareerOpportunity,
): boolean {
  if (opportunity.sourceSignal === null && conditions.some(containsSignalFieldCondition))
    return false;
  const config = getConfigLoader().getGameConfig();
  const fallbackSignal = {
    signalId: 'career-page-eligibility',
    signalType: 'assessment.completed' as const,
    occurredAtDay: currentDay,
    data: { year: 0, score: 0, tier: '' },
  };
  return conditions.every((condition) =>
    evaluateCondition(condition, {
      state,
      signal: opportunity.sourceSignal ?? fallbackSignal,
      currentDay,
      daysPerYear: config.daysPerMonth * config.monthsPerYear,
    }),
  );
}

/**
 * 与 Store 接受操作保持同一组持久化资格判断，用于展示而非修改状态。
 *
 * @param opportunity 待展示的职业机会
 * @param state 当前存档
 * @param currentDay 当前绝对日
 * @returns 当前是否可接受及不可接受原因。
 */
function evaluateOpportunityEligibility(
  opportunity: CareerOpportunity,
  state: Readonly<PlayerSave>,
  currentDay: number,
): OpportunityEligibility {
  if (opportunity.status !== 'available')
    return { eligible: false, detail: formatOpportunityStatus(opportunity.status) };
  if (opportunity.expiresAtDay !== null && opportunity.expiresAtDay <= currentDay)
    return { eligible: false, detail: '机会已到期' };
  if (
    !satisfiesOpportunityConditions(
      opportunity.eligibilityConditions,
      state,
      currentDay,
      opportunity,
    )
  )
    return { eligible: false, detail: '未满足机会资格条件' };
  if (opportunity.type === 'training') return { eligible: true, detail: '符合资格' };
  const target = getConfigLoader().getPositionById(opportunity.target.positionId);
  const restriction = getActiveCareerRestrictions(state.career.restrictions, currentDay).find(
    (item) => item.type === 'appointment_selection_freeze' || item.type === 'disciplinary_action',
  );
  if (!target) return { eligible: false, detail: '目标岗位配置不存在' };
  if (target.vacancyCount <= 0) return { eligible: false, detail: '目标岗位暂无空缺' };
  if (state.career.appointment.positionId === target.id)
    return { eligible: false, detail: '当前已在目标岗位' };
  if (restriction) return { eligible: false, detail: formatCareerRestriction(restriction.type) };
  if (!satisfiesOpportunityConditions(target.requirements, state, currentDay, opportunity))
    return { eligible: false, detail: '未满足目标岗位任职条件' };
  return { eligible: true, detail: '符合资格' };
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
  const quotaState = createMemo(() => {
    const quota = rankRule()?.quotaRequirement;
    if (!quota) return '不适用';
    return `${state.world.metrics[quota.metricId] ?? 0}/${quota.requiredValue} 可用`;
  });
  const sortedExperiences = createMemo(() =>
    [...state.career.experiences].sort((left, right) => right.startedAtDay - left.startedAtDay),
  );

  return (
    <AppShell>
      <PageHeader title="职务与职级" desc="职务任职与公务员职级为两条独立发展通道" />

      <div style={{ display: 'grid', gap: '16px', 'margin-top': '16px' }}>
        <section style={darkCardStyle('16px')}>
          <h2 style={{ 'font-size': '18px', 'font-family': font.title }}>当前任职</h2>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '12px',
              'margin-top': '14px',
            }}
          >
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
              label="当前任职时长"
              value={formatTenureDays(state.career.appointment.startedAtDay, null, currentDay())}
            />
          </div>
        </section>

        <section style={darkCardStyle('16px')}>
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'flex-start',
              gap: '16px',
              'flex-wrap': 'wrap',
            }}
          >
            <div>
              <h2 style={{ 'font-size': '18px', 'font-family': font.title }}>公务员职级</h2>
              <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
                职级晋升由服务年限、考核和职数共同决定。
              </p>
            </div>
            <Show when={rankEligibility().eligible}>
              <button
                onClick={() => dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK' })}
                style={primaryButtonStyle}
              >
                正式晋升至 {nextRankName()}
              </button>
            </Show>
          </div>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '12px',
              'margin-top': '14px',
            }}
          >
            <CareerFact
              label="当前职级"
              value={CIVIL_SERVICE_RANK_LABELS[state.career.civilServiceRank]}
            />
            <CareerFact label="下一职级" value={nextRankName()} />
            <CareerFact
              label="任职级天数"
              value={`${currentDay() - state.career.civilServiceRankStartedAtDay} 天`}
            />
            <CareerFact
              label="总服务天数"
              value={`${currentDay() - state.career.appointment.startedAtDay} 天`}
            />
            <CareerFact label="考核要求" value={formatAssessmentRequirement(rankRule())} />
            <CareerFact label="职数状态" value={quotaState()} />
          </div>
          <div style={{ 'margin-top': '14px' }}>
            <h3 style={{ 'font-size': '14px' }}>冻结或处分</h3>
            <Show
              when={activeRestrictions().length > 0}
              fallback={
                <p style={{ 'margin-top': '6px', color: colors.textMuted, 'font-size': '13px' }}>
                  当前无生效中的职业限制。
                </p>
              }
            >
              <ul
                style={{
                  'margin-top': '8px',
                  padding: '0 0 0 20px',
                  color: colors.danger,
                  'font-size': '13px',
                }}
              >
                <For each={activeRestrictions()}>
                  {(restriction) => (
                    <li>
                      {formatCareerRestriction(restriction.type)}：{restriction.reason}
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <div style={{ 'margin-top': '14px' }}>
            <h3 style={{ 'font-size': '14px' }}>晋升资格</h3>
            <Show
              when={!rankEligibility().eligible}
              fallback={
                <p style={{ 'margin-top': '6px', color: colors.success, 'font-size': '13px' }}>
                  已满足全部条件，可提交正式晋升。
                </p>
              }
            >
              <ul
                style={{
                  'margin-top': '8px',
                  padding: '0 0 0 20px',
                  color: colors.textMuted,
                  'font-size': '13px',
                  'line-height': '1.7',
                }}
              >
                <For each={rankEligibility().failures}>
                  {(failure) => <li>{formatRankFailure(failure.reason)}</li>}
                </For>
              </ul>
            </Show>
          </div>
        </section>

        <section style={darkCardStyle('16px')}>
          <h2 style={{ 'font-size': '18px', 'font-family': font.title }}>岗位机会</h2>
          <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
            岗位变动需接受机会并按流程完成选拔；职级不会由此自动变化。
          </p>
          <Show
            when={state.career.opportunities.length > 0}
            fallback={
              <p style={{ 'margin-top': '14px', color: colors.textMuted, 'font-size': '13px' }}>
                暂无岗位机会。年度考核与后续内容会带来新的机会。
              </p>
            }
          >
            <div style={{ display: 'grid', gap: '12px', 'margin-top': '14px' }}>
              <For each={state.career.opportunities}>
                {(opportunity) => {
                  const eligibility = createMemo(() =>
                    evaluateOpportunityEligibility(opportunity, state, currentDay()),
                  );
                  const target = () =>
                    opportunity.type === 'training' ? null : opportunity.target;
                  const targetSnapshot = target();
                  return (
                    <article
                      style={{
                        padding: '14px',
                        border: `1px solid ${colors.borderLight}`,
                        'border-radius': '8px',
                        background: '#fff',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          'justify-content': 'space-between',
                          gap: '12px',
                          'align-items': 'flex-start',
                          'flex-wrap': 'wrap',
                        }}
                      >
                        <div>
                          <h3 style={{ 'font-size': '15px' }}>
                            {targetSnapshot?.positionName ?? '培训机会'}
                          </h3>
                          <p
                            style={{
                              'margin-top': '4px',
                              color: colors.textMuted,
                              'font-size': '12px',
                            }}
                          >
                            {opportunity.reason}
                          </p>
                        </div>
                        <span style={pillStyle(colors.secondaryLight, colors.secondary)}>
                          {formatOpportunityStatus(opportunity.status)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))',
                          gap: '8px',
                          'margin-top': '12px',
                          'font-size': '12px',
                          color: colors.textSecondary,
                        }}
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
                            targetSnapshot ? formatCareerRegion(targetSnapshot.regionId) : '不适用'
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
                        <OpportunityFact label="资格状态" value={eligibility().detail} />
                      </div>
                      <Show when={opportunity.status === 'available'}>
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            'flex-wrap': 'wrap',
                            'margin-top': '14px',
                          }}
                        >
                          <button
                            disabled={!eligibility().eligible}
                            onClick={() =>
                              dispatch({
                                type: 'ACCEPT_CAREER_OPPORTUNITY',
                                opportunityId: opportunity.id,
                              })
                            }
                            style={{
                              ...primaryButtonStyle,
                              opacity: eligibility().eligible ? 1 : 0.5,
                              cursor: eligibility().eligible ? 'pointer' : 'not-allowed',
                            }}
                          >
                            接受
                          </button>
                          <button
                            onClick={() =>
                              dispatch({
                                type: 'REJECT_CAREER_OPPORTUNITY',
                                opportunityId: opportunity.id,
                              })
                            }
                            style={neutralButtonStyle}
                          >
                            拒绝
                          </button>
                          <button
                            onClick={() =>
                              dispatch({
                                type: 'CANCEL_CAREER_OPPORTUNITY',
                                opportunityId: opportunity.id,
                              })
                            }
                            style={neutralButtonStyle}
                          >
                            取消
                          </button>
                        </div>
                      </Show>
                    </article>
                  );
                }}
              </For>
            </div>
          </Show>

          <Show when={state.career.activeProcess}>
            {(process) => (
              <article
                style={{
                  'margin-top': '16px',
                  padding: '14px',
                  border: `1px solid ${colors.secondary}`,
                  'border-radius': '8px',
                  background: colors.secondaryLight,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    'justify-content': 'space-between',
                    gap: '12px',
                    'flex-wrap': 'wrap',
                  }}
                >
                  <div>
                    <h3 style={{ 'font-size': '15px' }}>当前选拔流程</h3>
                    <p
                      style={{
                        'margin-top': '4px',
                        color: colors.textSecondary,
                        'font-size': '12px',
                      }}
                    >
                      当前阶段：{formatCareerProcessStage(process().currentStage)}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      dispatch({
                        type: 'ADVANCE_CAREER_PROCESS',
                        opportunityId: process().opportunityId,
                      })
                    }
                    style={primaryButtonStyle}
                  >
                    推进当前阶段
                  </button>
                </div>
                <div
                  style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '7px', 'margin-top': '13px' }}
                >
                  <For each={SELECTION_STAGES}>
                    {(stage) => {
                      const isDone = () =>
                        process().stageResults.some((item) => item.stage === stage);
                      const isCurrent = () => process().currentStage === stage;
                      return (
                        <span
                          style={pillStyle(
                            isDone()
                              ? colors.successLight
                              : isCurrent()
                                ? colors.primaryLight
                                : colors.bgSoft,
                            isDone()
                              ? colors.success
                              : isCurrent()
                                ? colors.primary
                                : colors.textMuted,
                          )}
                        >
                          {formatCareerProcessStage(stage)}
                        </span>
                      );
                    }}
                  </For>
                </div>
              </article>
            )}
          </Show>
        </section>

        <section style={darkCardStyle('16px')}>
          <h2 style={{ 'font-size': '18px', 'font-family': font.title }}>职业履历</h2>
          <div style={{ display: 'grid', gap: '10px', 'margin-top': '14px' }}>
            <For each={sortedExperiences()}>
              {(experience) => (
                <div
                  style={{
                    display: 'grid',
                    'grid-template-columns': 'minmax(0, 1fr) auto',
                    gap: '8px 16px',
                    padding: '12px 0',
                    'border-bottom': `1px solid ${colors.borderLight}`,
                  }}
                >
                  <div>
                    <b style={{ 'font-size': '14px' }}>{experience.positionNameSnapshot}</b>
                    <div
                      style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '12px' }}
                    >
                      {experience.institutionNameSnapshot} ·{' '}
                      {formatCareerRegion(experience.regionId)} ·{' '}
                      {LEADERSHIP_RANK_LABELS[experience.leadershipRank]}
                    </div>
                  </div>
                  <div
                    style={{
                      'font-size': '12px',
                      color: colors.textSecondary,
                      'text-align': 'right',
                    }}
                  >
                    第 {experience.startedAtDay} 天起 ·{' '}
                    {formatTenureDays(experience.startedAtDay, experience.endedAtDay, currentDay())}
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </div>
      <div style={{ height: '24px' }} />
    </AppShell>
  );
}

/** 职业事实信息块。 */
function CareerFact(props: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 12px', 'border-radius': '6px', background: colors.bgSoft }}>
      <div style={{ color: colors.textMuted, 'font-size': '11px' }}>{props.label}</div>
      <div
        style={{
          'margin-top': '4px',
          'font-size': '13px',
          'font-weight': 700,
          'line-height': '1.45',
        }}
      >
        {props.value}
      </div>
    </div>
  );
}

/** 岗位机会信息块。 */
function OpportunityFact(props: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: colors.textMuted }}>{props.label}：</span>
      <span>{props.value}</span>
    </div>
  );
}
