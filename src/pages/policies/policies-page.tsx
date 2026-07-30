/**
 * Policy interaction page.
 *
 * Presents configuration-backed proposals and persisted policy instances without
 * rebuilding lifecycle data that is already owned by the governance state.
 */

import { createMemo, For, Show } from 'solid-js';
import { AppShell } from '../../components/app-shell';
import { PageHeader } from '../../components/page-header';
import { getConfigLoader } from '../../config/loader';
import type { PolicyInstance } from '../../domain/governance/state';
import { POLICY_STATUS_LABELS, type PolicyStatus } from '../../domain/governance/types';
import { useGameStore } from '../../store/game-store';
import { colors, darkCardStyle, font, pillStyle } from '../../utils/theme';

const statusColors: Record<PolicyStatus, { bg: string; fg: string }> = {
  proposed: { bg: colors.warningLight, fg: '#8a5a00' },
  approved: { bg: colors.secondaryLight, fg: colors.secondary },
  implementing: { bg: colors.successLight, fg: '#27752a' },
  suspended: { bg: colors.warningLight, fg: '#8a5a00' },
  completed: { bg: colors.successLight, fg: '#27752a' },
  failed: { bg: 'rgba(196, 77, 77, 0.14)', fg: colors.danger },
  repealed: { bg: colors.bgSoft, fg: colors.textMuted },
};

function gameDayLabel(day: number | null, state: ReturnType<typeof useGameStore>['state']): string {
  if (day === null) return '未安排';
  const offset = day - state.time.totalDaysPlayed;
  return `第 ${day} 日${offset === 0 ? '（今日）' : offset > 0 ? `（${offset} 天后）` : '（已到期）'}`;
}

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
 * Renders proposal choices and policy lifecycle instances.
 *
 * @returns The policies route content.
 */
export function PoliciesPage() {
  const { state, dispatch } = useGameStore();
  const loader = getConfigLoader();
  const definitions = createMemo(() => loader.getAllPolicyDefinitions());
  const institutionName = (institutionId: string) =>
    loader.getInstitutionById(institutionId)?.name ?? institutionId;

  return (
    <AppShell>
      <PageHeader title="政策治理" desc="提议、批准并跟踪每项政策的持久化生命周期" />
      <section style={{ ...darkCardStyle('18px'), 'margin-top': '16px' }}>
        <h2 style={{ 'font-family': font.title, 'font-size': '19px' }}>可提议政策</h2>
        <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
          提议会以当前任职机构和地区作为来源上下文；具体可用性仍由政策规则校验。
        </p>
        <div style={{ display: 'grid', gap: '10px', 'margin-top': '14px' }}>
          <For each={definitions()}>
            {(definition) => {
              const alreadyTracked = () =>
                state.governance.policies.some((item) => item.policyId === definition.id);
              return (
                <article
                  style={{
                    display: 'grid',
                    'grid-template-columns': '1fr auto',
                    gap: '12px',
                    'align-items': 'center',
                    padding: '13px',
                    border: `1px solid ${colors.borderLight}`,
                    'border-radius': '7px',
                    background: '#fff',
                  }}
                >
                  <div>
                    <b>{definition.name}</b>
                    <p
                      style={{ 'margin-top': '3px', color: colors.textMuted, 'font-size': '12px' }}
                    >
                      {definition.description}
                    </p>
                  </div>
                  <button
                    disabled={alreadyTracked()}
                    onClick={() => dispatch({ type: 'PROPOSE_POLICY', policyId: definition.id })}
                    style={{
                      padding: '8px 12px',
                      border: 'none',
                      'border-radius': '5px',
                      background: alreadyTracked() ? colors.border : colors.primary,
                      color: '#fff',
                      cursor: alreadyTracked() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {alreadyTracked() ? '已跟踪' : '提议'}
                  </button>
                </article>
              );
            }}
          </For>
        </div>
      </section>

      <section style={{ ...darkCardStyle('18px'), 'margin-top': '16px' }}>
        <h2 style={{ 'font-family': font.title, 'font-size': '19px' }}>政策实例</h2>
        <Show
          when={state.governance.policies.length > 0}
          fallback={<p style={{ 'margin-top': '12px', color: colors.textMuted }}>尚无政策实例。</p>}
        >
          <div style={{ display: 'grid', gap: '14px', 'margin-top': '14px' }}>
            <For each={state.governance.policies}>
              {(policy) => {
                const phase = () =>
                  policy.snapshot.phases.find((item) => item.id === policy.currentPhaseId);
                const originInstitution = () => institutionName(policy.originContext.institutionId);
                const actions = () => policyActions(policy, state.time.totalDaysPlayed);
                return (
                  <article
                    style={{
                      padding: '16px',
                      border: `1px solid ${colors.border}`,
                      'border-radius': '8px',
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{ display: 'flex', 'justify-content': 'space-between', gap: '10px' }}
                    >
                      <div>
                        <h3 style={{ 'font-size': '17px' }}>{policy.snapshot.name}</h3>
                        <p
                          style={{
                            'margin-top': '3px',
                            color: colors.textMuted,
                            'font-size': '12px',
                          }}
                        >
                          {policy.snapshot.description}
                        </p>
                      </div>
                      <span
                        style={pillStyle(
                          statusColors[policy.status].bg,
                          statusColors[policy.status].fg,
                        )}
                      >
                        {POLICY_STATUS_LABELS[policy.status]}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        'grid-template-columns': 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: '10px',
                        'margin-top': '14px',
                        color: colors.textSecondary,
                        'font-size': '12px',
                      }}
                    >
                      <div>
                        <b>当前阶段</b>
                        <br />
                        {phase()?.name ?? '尚未实施'}
                      </div>
                      <div>
                        <b>下一里程碑</b>
                        <br />
                        {gameDayLabel(policy.nextMilestoneAtDay, state)}
                      </div>
                      <div>
                        <b>来源机构</b>
                        <br />
                        {originInstitution()}
                      </div>
                      <div>
                        <b>来源地区</b>
                        <br />
                        {policy.originContext.regionId}
                      </div>
                    </div>
                    <Show when={Object.keys(policy.metrics).length > 0}>
                      <div style={{ 'margin-top': '14px', 'font-size': '12px' }}>
                        <b>政策指标</b>
                        <div
                          style={{
                            display: 'flex',
                            'flex-wrap': 'wrap',
                            gap: '6px',
                            'margin-top': '6px',
                          }}
                        >
                          <For each={Object.entries(policy.metrics)}>
                            {([metricId, value]) => (
                              <span style={pillStyle(colors.bgSoft, colors.textSecondary)}>
                                {metricId}: {value}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                    <div
                      style={{
                        display: 'flex',
                        'flex-wrap': 'wrap',
                        gap: '8px',
                        'margin-top': '16px',
                      }}
                    >
                      <For each={actions()}>
                        {(action) => (
                          <button
                            disabled={action.disabled}
                            onClick={() =>
                              dispatch({ type: action.type, policyInstanceId: policy.instanceId })
                            }
                            style={{
                              padding: '8px 12px',
                              border: `1px solid ${action.label === '废止' ? colors.danger : colors.secondary}`,
                              'border-radius': '5px',
                              background: action.disabled ? colors.bgSoft : '#fff',
                              color: action.disabled
                                ? colors.textMuted
                                : action.label === '废止'
                                  ? colors.danger
                                  : colors.secondary,
                              cursor: action.disabled ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {action.label}
                          </button>
                        )}
                      </For>
                    </div>
                    <p
                      style={{ 'margin-top': '10px', color: colors.textMuted, 'font-size': '11px' }}
                    >
                      提议日：{gameDayLabel(policy.proposedAtDay, state)} · 批准日：
                      {gameDayLabel(policy.approvedAtDay, state)} · 生效日：
                      {gameDayLabel(policy.effectiveAtDay, state)}
                    </p>
                  </article>
                );
              }}
            </For>
          </div>
        </Show>
      </section>
      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
