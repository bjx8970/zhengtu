/**
 * 仪表盘（主界面）
 *
 * 玩家的核心操作面板，展示：
 * 1. 角色基本信息 + 当前游戏时间
 * 2. 行动槽位状态（当前/最大）
 * 3. 推进粒度切换（按天/按周/按月）
 * 4. 推进时间按钮（触发阶段结算和存档）
 * 5. 各子系统入口列表（根据条件动态显示/隐藏）
 */

import { useGameStore } from '../../store/game-store';
import { navigate } from '../../router';
import { formatDate, formatGranularity } from '../../utils/format';
import type { TimeGranularity } from '../../types/enums';
import { For, createMemo } from 'solid-js';

interface DashboardEntry {
  label: string;
  path: string;
  desc: string;
  show: () => boolean;
}

export function Dashboard() {
  const { state, dispatch } = useGameStore();

  const granularities: TimeGranularity[] = ['day', 'week', 'month'];

  /** 子系统入口（根据条件动态显示） */
  const entries: DashboardEntry[] = [
    {
      label: '考核指标',
      path: '/kpi',
      desc: 'KPI 完成率与等次',
      show: () => !!state.currentPositionId,
    },
    {
      label: '管辖部门',
      path: '/dept/0',
      desc: '部门行动与资源',
      show: () => !!state.currentPositionId,
    },
    {
      label: '上级关系',
      path: '/superior',
      desc: state.superiorFavor + ' 好感',
      show: () => true,
    },
    {
      label: '人脉网络',
      path: '/relations',
      desc: '管理社交关系',
      show: () => true,
    },
    {
      label: '个人生活',
      path: '/personal',
      desc: '住房 / 子女 / 健康',
      show: () => true,
    },
    {
      label: '档案与成就',
      path: '/archives',
      desc: state.achievements.length + ' 项',
      show: () => true,
    },
  ];

  /** 可见入口（过滤后） */
  const visibleEntries = createMemo(() => entries.filter((e) => e.show()));

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        height: '100%',
        'background-color': '#1a1a2e',
        color: '#e0e0e0',
        padding: '1rem',
      }}
    >
      {/* 顶部：角色信息 + 日期 */}
      <header
        style={{
          display: 'flex',
          'justify-content': 'space-between',
          'align-items': 'center',
          'padding-bottom': '1rem',
          'border-bottom': '1px solid #333',
        }}
      >
        <div>
          <div style={{ 'font-size': '0.8rem', color: '#888' }}>角色</div>
          <div style={{ 'font-size': '1.2rem', 'font-weight': 'bold' }}>
            {state.characterName || '未创建'}
          </div>
        </div>
        <div style={{ 'text-align': 'right' }}>
          <div style={{ 'font-size': '0.8rem', color: '#888' }}>
            {formatDate(state.time.year, state.time.month, state.time.day)}
          </div>
          <div style={{ 'font-size': '0.9rem' }}>
            {formatGranularity(state.time.granularity)}推进
          </div>
        </div>
      </header>

      {/* 槽位状态卡片 */}
      <div
        style={{
          margin: '1.5rem 0',
          padding: '1rem',
          'background-color': '#16213e',
          'border-radius': '10px',
        }}
      >
        <div style={{ 'font-size': '0.8rem', color: '#888', 'margin-bottom': '0.5rem' }}>
          行动槽位
        </div>
        <div style={{ 'font-size': '2rem', 'font-weight': 'bold', color: '#4A6FA5' }}>
          {state.slots.available} / {state.slots.max}
        </div>
      </div>

      {/* 粒度切换：按天 / 按周 / 按月 */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          'margin-bottom': '1.5rem',
        }}
      >
        {granularities.map((g) => (
          <button
            onClick={() => {
              dispatch({ type: 'SET_GRANULARITY', granularity: g });
            }}
            style={{
              flex: 1,
              padding: '0.6rem',
              'font-size': '0.9rem',
              'background-color': state.time.granularity === g ? '#4A6FA5' : '#2a2a4a',
              color: '#fff',
              border: 'none',
              'border-radius': '6px',
              cursor: 'pointer',
            }}
          >
            {formatGranularity(g)}
          </button>
        ))}
      </div>

      {/* 推进时间按钮 */}
      <button
        onClick={() => dispatch({ type: 'ADVANCE_TIME', granularity: state.time.granularity })}
        style={{
          padding: '1rem',
          'font-size': '1.1rem',
          'background-color': '#C44D4D',
          color: '#fff',
          border: 'none',
          'border-radius': '8px',
          cursor: 'pointer',
          'margin-bottom': '1.5rem',
        }}
      >
        推进时间
      </button>

      {/* 子系统入口列表 */}
      <div
        style={{
          flex: 1,
          'overflow-y': 'auto',
          display: 'flex',
          'flex-direction': 'column',
          gap: '0.5rem',
        }}
      >
        <For each={visibleEntries()}>
          {(entry) => (
            <div
              onClick={() => navigate(entry.path)}
              style={{
                padding: '0.8rem 1rem',
                'background-color': '#16213e',
                'border-radius': '8px',
                display: 'flex',
                'justify-content': 'space-between',
                'align-items': 'center',
                cursor: 'pointer',
              }}
            >
              <span>{entry.label}</span>
              <span style={{ color: '#888', 'font-size': '0.85rem' }}>{entry.desc}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
