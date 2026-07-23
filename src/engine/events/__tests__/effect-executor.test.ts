/**
 * 效果执行器测试
 *
 * 覆盖 applyEffects 的全部效果类型、地址解析、数值语义、钳位和原子性。
 */
import { describe, it, expect } from 'vitest';
import { applyEffects } from '../effect-executor';
import type { EffectExecutionContext } from '../effect-executor';
import { createInitialState } from '../../../store/game-store';
import { getConfigLoader } from '../../../config/loader';
import type { EffectDefinition } from '../../../domain/conditions';
import type { DomainSignalSnapshot } from '../../../domain/governance/types';
import type { PlayerSave } from '../../../types/player';

/** 构造执行上下文 */
function makeContext(signal?: DomainSignalSnapshot): EffectExecutionContext {
  return {
    signal:
      signal ??
      ({
        signalType: 'appointment.changed',
        occurredAtDay: 100,
        data: {
          experienceId: 'e1',
          positionId: 'admin_l1_0',
          institutionId: 'inst_signal',
          regionId: 'region_signal',
          previousPositionId: null,
        },
      } as DomainSignalSnapshot),
    currentDay: 1000,
    attributeBounds: getConfigLoader().getGameConfig().attributeBounds,
  };
}

/** 应用效果并返回新状态（通过 createInitialState 克隆） */
function apply(effects: EffectDefinition[], ctx?: EffectExecutionContext): PlayerSave {
  const state = createInitialState();
  applyEffects(state, effects, ctx ?? makeContext());
  return state;
}

describe('效果执行器 - 角色属性', () => {
  it('add 应用', () => {
    const state = apply([
      { target: 'character', field: 'competence', operation: 'add', value: 10 },
    ]);
    const initial = createInitialState();
    expect(state.character.competence).toBe(initial.character.competence + 10);
  });

  it('multiply 应用', () => {
    const state = createInitialState();
    state.character.competence = 50;
    applyEffects(
      state,
      [{ target: 'character', field: 'competence', operation: 'multiply', value: 2 }],
      makeContext(),
    );
    expect(state.character.competence).toBe(100);
  });

  it('set 应用', () => {
    const state = apply([
      { target: 'character', field: 'competence', operation: 'set', value: 88 },
    ]);
    expect(state.character.competence).toBe(88);
  });

  it('属性钳位（不超过上限）', () => {
    const state = apply([
      { target: 'character', field: 'competence', operation: 'add', value: 99999 },
    ]);
    const bounds = getConfigLoader().getGameConfig().attributeBounds['competence'];
    expect(state.character.competence).toBeLessThanOrEqual(bounds?.[1] ?? Infinity);
  });
});

describe('效果执行器 - 职业专长', () => {
  it('add 与 set', () => {
    const state = createInitialState();
    applyEffects(
      state,
      [
        { target: 'career_specialty', specialtyId: 'economics', operation: 'add', value: 5 },
        { target: 'career_specialty', specialtyId: 'economics', operation: 'add', value: 3 },
      ],
      makeContext(),
    );
    expect(state.career.specialties['economics']).toBe(8);
    applyEffects(
      state,
      [{ target: 'career_specialty', specialtyId: 'economics', operation: 'set', value: 20 }],
      makeContext(),
    );
    expect(state.career.specialties['economics']).toBe(20);
  });
});

describe('效果执行器 - 机构/地区/政策指标', () => {
  it('机构指标 current_appointment 引用', () => {
    const state = createInitialState();
    const instId = state.career.appointment.institutionId;
    applyEffects(
      state,
      [
        {
          target: 'institution_metric',
          institutionRef: { source: 'current_appointment' },
          metricId: 'efficiency',
          operation: 'add',
          value: 10,
        },
      ],
      makeContext(),
    );
    expect(state.governance.institutionMetrics[instId]?.['efficiency']).toBe(10);
  });

  it('地区指标 signal 引用', () => {
    const state = createInitialState();
    applyEffects(
      state,
      [
        {
          target: 'region_metric',
          regionRef: { source: 'signal', field: 'regionId' },
          metricId: 'stability',
          operation: 'set',
          value: 75,
        },
      ],
      makeContext(),
    );
    expect(state.governance.regionMetrics['region_signal']?.['stability']).toBe(75);
  });

  it('机构指标 fixed 引用', () => {
    const state = createInitialState();
    applyEffects(
      state,
      [
        {
          target: 'institution_metric',
          institutionRef: { source: 'fixed', institutionId: 'inst_fixed' },
          metricId: 'm1',
          operation: 'add',
          value: 5,
        },
      ],
      makeContext(),
    );
    expect(state.governance.institutionMetrics['inst_fixed']?.['m1']).toBe(5);
  });

  it('政策指标 fixed 引用（实例存在）', () => {
    const state = createInitialState();
    state.governance.policies = [
      {
        instanceId: 'pol_inst_1',
        policyId: 'pol_1',
        status: 'implementing',
        proposedAtDay: 0,
        approvedAtDay: 10,
        effectiveAtDay: 20,
        regionId: 'r1',
        responsibleInstitutionId: 'i1',
        currentPhaseId: 'phase_1',
        metrics: { coverage: 50 },
      },
    ];
    applyEffects(
      state,
      [
        {
          target: 'policy_metric',
          policyRef: { source: 'fixed', policyInstanceId: 'pol_inst_1' },
          metricId: 'coverage',
          operation: 'add',
          value: 20,
        },
      ],
      makeContext(),
    );
    expect(state.governance.policies[0]!.metrics['coverage']).toBe(70);
  });
});

describe('效果执行器 - 世界指标/事实/考核', () => {
  it('世界指标 add', () => {
    const state = createInitialState();
    state.world.metrics['gdp'] = 100;
    applyEffects(
      state,
      [{ target: 'world_metric', metricId: 'gdp', operation: 'add', value: 50 }],
      makeContext(),
    );
    expect(state.world.metrics['gdp']).toBe(150);
  });

  it('世界事实 set', () => {
    const state = apply([
      { target: 'world_fact', factId: 'is_corrupt', operation: 'set', value: true },
    ]);
    expect(state.world.facts['is_corrupt']).toBe(true);
  });

  it('考核分数 add', () => {
    const state = createInitialState();
    const before = state.assessments.comprehensiveScore;
    applyEffects(
      state,
      [{ target: 'assessment_score', operation: 'add', value: 5 }],
      makeContext(),
    );
    expect(state.assessments.comprehensiveScore).toBe(before + 5);
  });
});

describe('效果执行器 - 原子性', () => {
  it('政策实例缺失时抛错且不产生部分修改', () => {
    const state = createInitialState();
    const competenceBefore = state.character.competence;
    const effects: EffectDefinition[] = [
      { target: 'character', field: 'competence', operation: 'add', value: 10 },
      // 政策实例不存在 → 解析失败
      {
        target: 'policy_metric',
        policyRef: { source: 'fixed', policyInstanceId: 'nonexistent' },
        metricId: 'm',
        operation: 'add',
        value: 5,
      },
    ];
    expect(() => applyEffects(state, effects, makeContext())).toThrow();
    // 第一个效果不应被应用（原子性）
    expect(state.character.competence).toBe(competenceBefore);
  });

  it('signal 引用字段缺失时抛错', () => {
    const state = createInitialState();
    // world.metric_changed 信号无 institutionId 字段
    const ctx = makeContext({
      signalType: 'world.metric_changed',
      occurredAtDay: 100,
      data: { metricId: 'm', value: 1 },
    } as DomainSignalSnapshot);
    expect(() =>
      applyEffects(
        state,
        [
          {
            target: 'institution_metric',
            institutionRef: { source: 'signal', field: 'institutionId' },
            metricId: 'm',
            operation: 'add',
            value: 5,
          },
        ],
        ctx,
      ),
    ).toThrow();
  });

  it('全部合法效果均被应用', () => {
    const state = createInitialState();
    const result = applyEffects(
      state,
      [
        { target: 'character', field: 'vigor', operation: 'add', value: 1 },
        { target: 'world_metric', metricId: 'm', operation: 'set', value: 42 },
      ],
      makeContext(),
    );
    expect(result.applied).toHaveLength(2);
    expect(state.world.metrics['m']).toBe(42);
  });
});
