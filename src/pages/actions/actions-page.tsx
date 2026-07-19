/**
 * 行动排程页
 *
 * 管理主要、次要、备用三级槽位的占用状态和进度，
 * 并提供推荐行动列表供玩家排程。
 *
 * 双列布局：
 * - 左侧：槽位状态（排程队列）
 * - 右侧：推荐行动列表
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { AppShell } from '../../components/app-shell';
import { getConfigLoader } from '../../config/loader';
import { parsePositionIndex } from '../../utils/position';
import type { SlotTierKey, SlotOccupant } from '../../types/player';
import { colors, font, darkCardStyle } from '../../utils/theme';
import { formatEffectLabel } from '../../utils/effect-labels';

const TIER_COLOR: Record<SlotTierKey, string> = {
  primary: '#4A6FA5',
  secondary: '#6B8E6B',
  reserve: '#C44D4D',
};

/**
 * 行动排程页组件。
 *
 * @returns 行动排程页 JSX
 */
export function ActionsPage() {
  const { state, dispatch } = useGameStore();

  const findEmptySlot = createMemo(() => {
    for (const key of ['primary', 'secondary', 'reserve'] as SlotTierKey[]) {
      if (state.slots[key].occupants.some((o) => o === null)) return key;
    }
    return null;
  });

  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    const idx = parsePositionIndex(posId);
    if (idx === null) return null;
    return getConfigLoader().getPosition(state.currentCareerLine, state.currentLevel, idx);
  });

  const allDepts = createMemo(() => positionConfig()?.departments ?? []);

  const slotEntries = createMemo(
    () => Object.entries(state.slots) as [SlotTierKey, typeof state.slots.primary][],
  );

  return (
    <AppShell>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': 'minmax(0, 1fr) minmax(300px, 0.72fr)',
          gap: '16px',
        }}
      >
        {/* 左侧：槽位状态 */}
        <article style={{ ...darkCardStyle('16px') }}>
          <div style={{ 'margin-bottom': '14px' }}>
            <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>槽位状态</h3>
            <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
              以排程优先，展示任务占用、剩余时间与风险。
            </p>
          </div>
          <div style={{ display: 'grid', gap: '11px' }}>
            <For each={slotEntries()}>
              {([tierKey, tier]) => (
                <For each={tier.occupants}>
                  {(occupant: SlotOccupant | null) => {
                    if (occupant) {
                      const elapsed = state.totalDaysPlayed - occupant.startedAtDay;
                      const total = occupant.durationDays;
                      const pct = Math.min((elapsed / total) * 100, 100);
                      return (
                        <div
                          style={{
                            display: 'grid',
                            'grid-template-columns': '84px minmax(0, 1fr) 72px',
                            gap: '12px',
                            'align-items': 'center',
                            padding: '13px',
                            border: `1px solid ${colors.border}`,
                            'border-radius': '8px',
                            background: '#fff',
                          }}
                        >
                          <b
                            style={{
                              color: TIER_COLOR[tierKey] ?? colors.secondary,
                              'font-size': '13px',
                            }}
                          >
                            {tier.label}槽位
                          </b>
                          <div>
                            <strong style={{ display: 'block', 'font-size': '14px' }}>
                              {occupant.actionName}
                            </strong>
                            <span
                              style={{
                                display: 'block',
                                'margin-top': '4px',
                                color: colors.textMuted,
                                'font-size': '12px',
                              }}
                            >
                              剩余 {total - elapsed} 天
                            </span>
                          </div>
                          <span
                            style={{
                              'font-size': '12px',
                              color: colors.textMuted,
                              'text-align': 'right',
                            }}
                          >
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div
                        style={{
                          display: 'grid',
                          'grid-template-columns': '84px minmax(0, 1fr) 72px',
                          gap: '12px',
                          'align-items': 'center',
                          padding: '13px',
                          border: `1px dashed ${colors.border}`,
                          'border-radius': '8px',
                          background: colors.bgSoft,
                        }}
                      >
                        <b style={{ color: colors.textMuted, 'font-size': '13px' }}>
                          {tier.label}槽位
                        </b>
                        <div>
                          <strong
                            style={{
                              display: 'block',
                              'font-size': '14px',
                              color: colors.textMuted,
                            }}
                          >
                            空闲
                          </strong>
                          <span
                            style={{
                              display: 'block',
                              'margin-top': '4px',
                              color: colors.textMuted,
                              'font-size': '12px',
                            }}
                          >
                            {tierKey === 'reserve'
                              ? '加班会影响健康和消沉，建议谨慎使用'
                              : '可安排行动'}
                          </span>
                        </div>
                        <span
                          style={{
                            'font-size': '12px',
                            color: colors.textMuted,
                            'text-align': 'right',
                          }}
                        >
                          0%
                        </span>
                      </div>
                    );
                  }}
                </For>
              )}
            </For>
          </div>
        </article>

        {/* 右侧：推荐行动 */}
        <article style={{ ...darkCardStyle('16px') }}>
          <div style={{ 'margin-bottom': '14px' }}>
            <h3 style={{ 'font-size': '18px', 'font-family': font.title }}>推荐行动</h3>
            <p style={{ 'margin-top': '4px', color: colors.textMuted, 'font-size': '13px' }}>
              从部门页选择行动后进入这里排程。
            </p>
          </div>
          <Show
            when={allDepts().length > 0}
            fallback={
              <div style={{ color: colors.textMuted, 'font-size': '13px' }}>暂无可用行动</div>
            }
          >
            <For each={allDepts()}>
              {(dept) => (
                <For each={dept.actions.slice(0, 2)}>
                  {(action) => {
                    const deptState = state.departmentStates[dept.id];
                    const cooldownUntil = deptState?.actionCooldownUntilDays?.[action.id] ?? 0;
                    const onCooldown =
                      action.category !== 'routine' && state.totalDaysPlayed < cooldownUntil;

                    const emptySlot = onCooldown ? null : findEmptySlot();
                    const canStart =
                      !onCooldown &&
                      emptySlot !== null &&
                      (action.category !== 'major' || emptySlot === 'primary');
                    return (
                      <div
                        style={{
                          padding: '15px',
                          border: `1px solid ${colors.border}`,
                          'border-radius': '8px',
                          background: '#fff',
                          'margin-bottom': '12px',
                        }}
                      >
                        <h3 style={{ 'font-size': '16px' }}>{action.name}</h3>
                        <p
                          style={{
                            'margin-top': '8px',
                            color: colors.textMuted,
                            'font-size': '13px',
                            'line-height': '1.6',
                          }}
                        >
                          {dept.name} ·{' '}
                          {action.category === 'major'
                            ? '重大'
                            : action.category === 'minor'
                              ? '次要'
                              : '日常'}
                          行动 · {action.durationDays}天
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            'flex-wrap': 'wrap',
                            gap: '7px',
                            'margin-top': '12px',
                          }}
                        >
                          <span
                            style={{
                              padding: '4px 7px',
                              'border-radius': '999px',
                              background: colors.bgSoft,
                              color: colors.textMuted,
                              'font-size': '12px',
                              'font-weight': 800,
                            }}
                          >
                            {action.budgetDelta >= 0
                              ? `预算+${action.budgetDelta}万`
                              : `预算${action.budgetDelta}万`}
                          </span>
                          <For each={action.effects.slice(0, 2)}>
                            {(eff) => (
                              <span
                                style={{
                                  padding: '4px 7px',
                                  'border-radius': '999px',
                                  background: colors.bgSoft,
                                  color: colors.textMuted,
                                  'font-size': '12px',
                                  'font-weight': 800,
                                }}
                              >
                                {formatEffectLabel(eff)}
                              </span>
                            )}
                          </For>
                        </div>
                        <Show when={onCooldown}>
                          <div
                            style={{
                              'margin-top': '8px',
                              'font-size': '12px',
                              color: colors.warning,
                            }}
                          >
                            冷却中（{cooldownUntil - state.totalDaysPlayed}天）
                          </div>
                        </Show>
                        <div style={{ 'margin-top': '12px' }}>
                          <button
                            onClick={() => {
                              const tier = emptySlot;
                              if (tier)
                                dispatch({
                                  type: 'START_ACTION',
                                  deptId: dept.id,
                                  actionId: action.id,
                                  tierKey: tier,
                                });
                            }}
                            disabled={!canStart}
                            style={{
                              width: '100%',
                              padding: '7px',
                              border: canStart ? 'none' : `1px solid ${colors.border}`,
                              'border-radius': '6px',
                              background: canStart ? colors.primary : colors.bgSoft,
                              color: canStart ? '#fff' : colors.textMuted,
                              cursor: canStart ? 'pointer' : 'not-allowed',
                              'font-size': '13px',
                              'font-weight': 700,
                            }}
                          >
                            {onCooldown ? '冷却中' : emptySlot ? '开始执行' : '无空闲槽位'}
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
              )}
            </For>
          </Show>
        </article>
      </div>

      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
