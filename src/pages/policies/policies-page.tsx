/**
 * 政策治理页面。
 *
 * 展示配置驱动的可提议政策与已持久化的政策实例，
 * 生命周期数据完全由治理状态持有，页面只读取与派发。
 */

import { createMemo, For, Show } from 'solid-js';
import { PageHeader } from '../../components/page-header';
import { getConfigLoader } from '../../config/loader';
import type { PolicyInstance } from '../../domain/governance/state';
import { POLICY_STATUS_LABELS, type PolicyStatus } from '../../domain/governance/types';
import { useGameStore } from '../../store/game-store';

/** 政策状态 → 标签类名 */
const statusTagClass: Record<PolicyStatus, string> = {
  proposed: 'tag tag-warning',
  approved: 'tag tag-blue',
  implementing: 'tag tag-green',
  suspended: 'tag tag-warning',
  completed: 'tag tag-green',
  failed: 'tag tag-danger',
  repealed: 'tag tag-gray',
};

/**
 * @param day 目标绝对日，null 表示未安排
 * @param currentDay 当前绝对日
 * @returns 带相对偏移的日期标签
 */
function gameDayLabel(day: number | null, currentDay: number): string {
  if (day === null) return '未安排';
  const offset = day - currentDay;
  return `第 ${day} 日${offset === 0 ? '（今日）' : offset > 0 ? `（${offset} 天后）` : '（已到期）'}`;
}

/**
 * @param policy 政策实例
 * @param currentDay 当前绝对日
 * @returns 当前状态允许的生命周期操作列表
 */
function policyActions(policy: PolicyInstance, currentDay: number) {
  switch (policy.status) {
    case 'proposed':
      return [
        { label: '批准', type: 'APPROVE_POLICY' as const, disabled: false },
        { label: '废止', type: 'REPEAL_POLICY' as const, disabled: false },
      ];
    case 'approved':
      return [
        {
          label:
            policy.effectiveAtDay !== null && policy.effectiveAtDay <= currentDay
              ? '生效'
              : '等待生效日',
          type: 'ACTIVATE_POLICY' as const,
          disabled: policy.effectiveAtDay === null || policy.effectiveAtDay > currentDay,
        },
        { label: '废止', type: 'REPEAL_POLICY' as const, disabled: false },
      ];
    case 'implementing':
      return [
        { label: '暂停', type: 'SUSPEND_POLICY' as const, disabled: false },
        { label: '废止', type: 'REPEAL_POLICY' as const, disabled: false },
      ];
    case 'suspended':
      return [
        { label: '恢复', type: 'RESUME_POLICY' as const, disabled: false },
        { label: '废止', type: 'REPEAL_POLICY' as const, disabled: false },
      ];
    default:
      return [];
  }
}

/**
 * 政策治理页面组件。
 *
 * @returns 可提议政策与政策实例列表
 */
export function PoliciesPage() {
  const { state, dispatch } = useGameStore();
  const loader = getConfigLoader();
  const definitions = createMemo(() => loader.getAllPolicyDefinitions());
  const institutionName = (institutionId: string) =>
    loader.getInstitutionById(institutionId)?.name ?? institutionId;

  return (
    <>
      <PageHeader
        eyebrow="政策 · POLICY"
        title="政策治理"
        desc="提议、批准并跟踪每项政策的持久化生命周期"
      />

      <div class="flex-col gap-lg">
        {/* 可提议政策 */}
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            可提议政策
          </div>
          <div class="card-pad flex-col gap-md">
            <p class="doc-meta">
              提议会以当前任职机构和地区作为来源上下文；具体可用性仍由政策规则校验。
            </p>
            <Show
              when={definitions().length > 0}
              fallback={<p class="text-sm muted">暂无政策定义。</p>}
            >
              <div class="flex-col gap-sm">
                <For each={definitions()}>
                  {(definition) => {
                    const alreadyTracked = () =>
                      state.governance.policies.some((item) => item.policyId === definition.id);
                    return (
                      <div
                        class="card flex between center gap-md"
                        style={{ padding: '0.9rem 1rem' }}
                      >
                        <div class="flex-1">
                          <b>{definition.name}</b>
                          <p class="text-xs secondary-text">{definition.description}</p>
                        </div>
                        <button
                          data-testid={`propose-policy-${definition.id}`}
                          class="btn btn-primary btn-sm"
                          disabled={alreadyTracked()}
                          onClick={() =>
                            dispatch({ type: 'PROPOSE_POLICY', policyId: definition.id })
                          }
                        >
                          {alreadyTracked() ? '已跟踪' : '提议'}
                        </button>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </section>

        {/* 政策实例 */}
        <section class="card">
          <div class="card-title">
            <span class="card-title-mark" aria-hidden="true" />
            政策实例
            <span class="flex-1" />
            <span class="tag tag-gray">{state.governance.policies.length} 项</span>
          </div>
          <div class="card-pad">
            <Show
              when={state.governance.policies.length > 0}
              fallback={<p class="text-sm muted">尚无政策实例。</p>}
            >
              <div class="flex-col gap-md">
                <For each={state.governance.policies}>
                  {(policy) => {
                    const phase = () =>
                      policy.snapshot.phases.find((item) => item.id === policy.currentPhaseId);
                    const originInstitution = () =>
                      institutionName(policy.originContext.institutionId);
                    const actions = () => policyActions(policy, state.time.totalDaysPlayed);
                    return (
                      <article class="card">
                        <div class="card-pad flex-col gap-sm">
                          <div class="flex between gap-md">
                            <div>
                              <h3 class="serif" style={{ 'font-size': '1.05rem' }}>
                                {policy.snapshot.name}
                              </h3>
                              <p class="text-xs secondary-text">{policy.snapshot.description}</p>
                            </div>
                            <span class={statusTagClass[policy.status]}>
                              {POLICY_STATUS_LABELS[policy.status]}
                            </span>
                          </div>
                          <div class="stat-grid">
                            <div class="stat">
                              <div class="stat-value">{phase()?.name ?? '尚未实施'}</div>
                              <div class="stat-label">当前阶段</div>
                            </div>
                            <div class="stat">
                              <div class="stat-value">
                                {gameDayLabel(
                                  policy.nextMilestoneAtDay,
                                  state.time.totalDaysPlayed,
                                )}
                              </div>
                              <div class="stat-label">下一里程碑</div>
                            </div>
                            <div class="stat">
                              <div class="stat-value">{originInstitution()}</div>
                              <div class="stat-label">来源机构</div>
                            </div>
                            <div class="stat">
                              <div class="stat-value">{policy.originContext.regionId}</div>
                              <div class="stat-label">来源地区</div>
                            </div>
                          </div>
                          <Show when={Object.keys(policy.metrics).length > 0}>
                            <div class="flex gap-sm" style={{ 'flex-wrap': 'wrap' }}>
                              <For each={Object.entries(policy.metrics)}>
                                {([metricId, value]) => (
                                  <span class="tag tag-gray">
                                    {metricId}: {value}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                          <div class="flex gap-sm">
                            <For each={actions()}>
                              {(action) => (
                                <button
                                  data-testid={`${action.type.toLowerCase()}-policy-${policy.instanceId}`}
                                  class={
                                    action.label === '废止' ? 'btn btn-danger btn-sm' : 'btn btn-sm'
                                  }
                                  disabled={action.disabled}
                                  onClick={() =>
                                    dispatch({
                                      type: action.type,
                                      policyInstanceId: policy.instanceId,
                                    })
                                  }
                                >
                                  {action.label}
                                </button>
                              )}
                            </For>
                          </div>
                          <p class="text-xs muted">
                            提议日：{gameDayLabel(policy.proposedAtDay, state.time.totalDaysPlayed)}{' '}
                            · 批准日：
                            {gameDayLabel(policy.approvedAtDay, state.time.totalDaysPlayed)} ·
                            生效日：
                            {gameDayLabel(policy.effectiveAtDay, state.time.totalDaysPlayed)}
                          </p>
                        </div>
                      </article>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </section>
      </div>
    </>
  );
}
