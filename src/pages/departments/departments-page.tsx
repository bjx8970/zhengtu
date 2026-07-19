/**
 * 部门治理页
 *
 * 展示当前职位的所有部门卡片，每张卡片包含部门名称、状态描述、
 * Meter 进度条和关键指标标签。
 * 仅展示概览，行动安排在"行动排程"页面处理。
 */

import { createMemo, For, Show } from 'solid-js';
import { useGameStore } from '../../store/game-store';
import { AppShell } from '../../components/app-shell';
import { getConfigLoader } from '../../config/loader';
import { parsePositionIndex } from '../../utils/position';
import { colors, font, meterContainer, darkCardStyle } from '../../utils/theme';

/**
 * 部门治理页组件。
 *
 * @returns 部门页 JSX
 */
export function DepartmentsPage() {
  const { state } = useGameStore();

  const positionConfig = createMemo(() => {
    const posId = state.currentPositionId;
    if (!posId) return null;
    const idx = parsePositionIndex(posId);
    if (idx === null) return null;
    return getConfigLoader().getPosition(state.currentCareerLine, state.currentLevel, idx);
  });

  const allDepts = createMemo(() => positionConfig()?.departments ?? []);

  return (
    <AppShell>
      <div style={{ ...darkCardStyle('18px'), 'margin-bottom': '16px' }}>
        <h2 style={{ 'font-size': '25px', 'font-family': font.title }}>部门治理</h2>
        <p
          style={{
            'margin-top': '6px',
            color: colors.textMuted,
            'font-size': '14px',
            'line-height': '1.6',
          }}
        >
          部门页承载全部治理对象、部门状态和可执行行动，主页只保留风险摘要与入口。
        </p>
      </div>

      <Show
        when={allDepts().length > 0}
        fallback={
          <div style={{ color: colors.textMuted, 'text-align': 'center', 'margin-top': '3rem' }}>
            暂无部门数据
          </div>
        }
      >
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
            gap: '14px',
          }}
        >
          <For each={allDepts()}>
            {(dept) => {
              const deptState = state.departmentStates[dept.id];
              const kpiValues = deptState?.kpiValues ?? {};
              const firstKpi = Object.entries(kpiValues).slice(0, 2);
              const firstValue = firstKpi.length > 0 ? Number(firstKpi[0]?.[1] ?? 0) : 0;
              return (
                <article style={{ ...darkCardStyle('16px'), 'min-height': '156px' }}>
                  <h3 style={{ 'font-size': '16px' }}>{dept.name}</h3>
                  <p
                    style={{
                      'margin-top': '8px',
                      color: colors.textMuted,
                      'font-size': '13px',
                      'line-height': '1.6',
                    }}
                  >
                    {dept.actions.length > 0
                      ? `可执行 ${dept.actions.length} 个行动`
                      : '暂无可用行动'}
                  </p>
                  <div style={{ ...meterContainer(), 'margin-top': '12px' }}>
                    <div
                      style={{
                        height: '100%',
                        'border-radius': 'inherit',
                        background: colors.success,
                        width: `${Math.min(Math.abs(firstValue) * 10, 100)}%`,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      'flex-wrap': 'wrap',
                      gap: '7px',
                      'margin-top': '12px',
                    }}
                  >
                    <For each={firstKpi}>
                      {([kpiId, value]) => (
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
                          {dept.kpiIndicators.find((k) => k.id === kpiId)?.name ?? kpiId}{' '}
                          {String(value)}
                        </span>
                      )}
                    </For>
                  </div>
                </article>
              );
            }}
          </For>
        </div>
      </Show>

      <div style={{ height: '24px' }} />
    </AppShell>
  );
}
