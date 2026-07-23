/**
 * 条件解释器测试
 *
 * 覆盖 evaluateCondition 的全部条件类型：
 * 逻辑组合、信号字段、职业状态、世界指标、事件历史、政策状态、履历、世界事实。
 */
import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../condition-interpreter';
import type { ConditionEvaluationContext } from '../condition-interpreter';
import { createInitialState } from '../../../store/game-store';
import type { ConditionExpression } from '../../../domain/conditions';
import type { DomainSignalSnapshot } from '../../../domain/governance/types';

/** 构造一个 world.metric_changed 信号快照 */
function makeSignal(overrides?: Partial<DomainSignalSnapshot>): DomainSignalSnapshot {
  return {
    signalType: 'world.metric_changed',
    occurredAtDay: 100,
    data: { metricId: 'flood_risk', value: 90 },
    ...overrides,
  } as DomainSignalSnapshot;
}

/** 构造评估上下文 */
function makeContext(
  mutate?: (ctx: ConditionEvaluationContext) => void,
): ConditionEvaluationContext {
  const state = createInitialState();
  const ctx: ConditionEvaluationContext = {
    signal: makeSignal(),
    state,
    currentDay: 1000,
    daysPerYear: 360,
  };
  if (mutate) mutate(ctx);
  return ctx;
}

/** 评估辅助 */
function evalCond(cond: ConditionExpression, ctx: ConditionEvaluationContext): boolean {
  return evaluateCondition(cond, ctx);
}

describe('条件解释器 - 逻辑组合', () => {
  it('all 全部满足', () => {
    const ctx = makeContext();
    const cond: ConditionExpression = {
      all: [
        { worldMetric: 'flood_risk', op: 'gte', value: 80 },
        { worldMetric: 'flood_risk', op: 'lte', value: 100 },
      ],
    };
    // world.metrics 默认无 flood_risk → 0，故 gte 80 为 false
    expect(evalCond(cond, ctx)).toBe(false);
  });

  it('any 任一满足', () => {
    const ctx = makeContext();
    const cond: ConditionExpression = {
      any: [
        { worldMetric: 'flood_risk', op: 'gte', value: 80 },
        { worldMetric: 'flood_risk', op: 'eq', value: 0 },
      ],
    };
    expect(evalCond(cond, ctx)).toBe(true);
  });

  it('not 取反', () => {
    const ctx = makeContext();
    const cond: ConditionExpression = { not: { worldMetric: 'flood_risk', op: 'gte', value: 80 } };
    expect(evalCond(cond, ctx)).toBe(true);
  });
});

describe('条件解释器 - 信号字段', () => {
  it('数值信号字段比较', () => {
    const ctx = makeContext();
    expect(evalCond({ signalField: 'value', op: 'gte', value: 90 }, ctx)).toBe(true);
    expect(evalCond({ signalField: 'value', op: 'lt', value: 90 }, ctx)).toBe(false);
  });

  it('字符串信号字段 eq/neq', () => {
    const ctx = makeContext();
    expect(evalCond({ signalField: 'metricId', op: 'eq', value: 'flood_risk' }, ctx)).toBe(true);
    expect(evalCond({ signalField: 'metricId', op: 'neq', value: 'other' }, ctx)).toBe(true);
  });

  it('nullable 信号字段 null 语义', () => {
    const ctx = makeContext((c) => {
      c.signal = {
        signalType: 'event.resolved',
        occurredAtDay: 100,
        data: { eventInstanceId: 'ei1', eventId: 'ev1', optionId: null },
      } as DomainSignalSnapshot;
    });
    expect(evalCond({ signalField: 'optionId', op: 'eq', value: null }, ctx)).toBe(true);
  });

  it('信号字段不存在返回 false', () => {
    const ctx = makeContext();
    // world.metric_changed 信号无 institutionId 字段
    expect(evalCond({ signalField: 'institutionId', op: 'eq', value: 'x' }, ctx)).toBe(false);
  });
});

describe('条件解释器 - 职业状态', () => {
  it('机构层级 eq/neq', () => {
    const ctx = makeContext((c) => {
      c.state.career.appointment.institutionLevel = 'county';
    });
    expect(evalCond({ careerCheck: 'institution_level', value: 'county', op: 'eq' }, ctx)).toBe(
      true,
    );
    expect(
      evalCond({ careerCheck: 'institution_level', value: 'prefecture', op: 'neq' }, ctx),
    ).toBe(true);
  });

  it('领导职务层次比较（使用领域排序，非字典序）', () => {
    const ctx = makeContext((c) => {
      c.state.career.appointment.leadershipRank = 'county_chief';
    });
    // county_chief 索引 > township_deputy 索引
    expect(
      evalCond({ careerCheck: 'leadership_rank', value: 'township_deputy', op: 'gt' }, ctx),
    ).toBe(true);
    expect(evalCond({ careerCheck: 'leadership_rank', value: 'county_chief', op: 'eq' }, ctx)).toBe(
      true,
    );
  });

  it('公务员职级比较', () => {
    const ctx = makeContext((c) => {
      c.state.career.civilServiceRank = 'section_member_2';
    });
    expect(evalCond({ careerCheck: 'civil_service_rank', value: 'clerk_1', op: 'gt' }, ctx)).toBe(
      true,
    );
  });

  it('岗位领域 eq/neq', () => {
    const ctx = makeContext((c) => {
      c.state.career.appointment.positionDomain = 'local_governance';
    });
    expect(evalCond({ careerCheck: 'position_domain', value: 'local_governance' }, ctx)).toBe(true);
    expect(
      evalCond({ careerCheck: 'position_domain', value: 'party_organs', op: 'neq' }, ctx),
    ).toBe(true);
  });

  it('当前职位任职年限', () => {
    const ctx = makeContext((c) => {
      c.state.career.appointment.startedAtDay = 0;
      c.currentDay = 730; // 2 年
    });
    expect(evalCond({ careerCheck: 'years_in_position', value: 2, op: 'gte' }, ctx)).toBe(true);
    expect(evalCond({ careerCheck: 'years_in_position', value: 3, op: 'gte' }, ctx)).toBe(false);
  });

  it('履历条件 has_experience', () => {
    const ctx = makeContext((c) => {
      c.state.career.experiences = [
        {
          id: 'exp1',
          positionId: 'admin_l1_0',
          positionNameSnapshot: '科员',
          institutionId: 'inst_001',
          institutionNameSnapshot: '某局',
          institutionLevel: 'township',
          regionId: 'region_001',
          positionDomain: 'local_governance',
          leadershipRank: 'none',
          startedAtDay: 0,
          endedAtDay: 100,
          appointmentReason: 'initial_assignment',
          assessmentResults: [],
        },
      ];
    });
    expect(evalCond({ careerCheck: 'has_experience', value: 'inst_001' }, ctx)).toBe(true);
    expect(evalCond({ careerCheck: 'has_experience', value: 'inst_999' }, ctx)).toBe(false);
  });
});

describe('条件解释器 - 世界指标与事实', () => {
  it('世界指标缺失默认为 0', () => {
    const ctx = makeContext();
    expect(evalCond({ worldMetric: 'nonexistent', op: 'eq', value: 0 }, ctx)).toBe(true);
  });

  it('世界指标比较', () => {
    const ctx = makeContext((c) => {
      c.state.world.metrics['gdp'] = 100;
    });
    expect(evalCond({ worldMetric: 'gdp', op: 'gte', value: 100 }, ctx)).toBe(true);
  });

  it('世界事实 is_true/is_false', () => {
    const ctx = makeContext((c) => {
      c.state.world.facts['is_corrupt'] = true;
    });
    expect(evalCond({ fact: 'is_corrupt', op: 'is_true' }, ctx)).toBe(true);
    expect(evalCond({ fact: 'unknown_fact', op: 'is_false' }, ctx)).toBe(true);
  });

  it('世界事实 eq/neq', () => {
    const ctx = makeContext((c) => {
      c.state.world.facts['leader'] = '张三';
    });
    expect(evalCond({ fact: 'leader', op: 'eq', value: '张三' }, ctx)).toBe(true);
    expect(evalCond({ fact: 'leader', op: 'neq', value: '李四' }, ctx)).toBe(true);
  });
});

describe('条件解释器 - 事件历史', () => {
  it('occurred/not_occurred', () => {
    const ctx = makeContext((c) => {
      c.state.events.history = [
        {
          eventId: 'flood_emergency',
          instanceId: 'i1',
          resolvedAtDay: 50,
          chosenOptionId: 'a',
          outcome: '',
        },
      ];
    });
    expect(evalCond({ eventHistory: 'flood_emergency', check: 'occurred' }, ctx)).toBe(true);
    expect(evalCond({ eventHistory: 'other_event', check: 'not_occurred' }, ctx)).toBe(true);
  });

  it('count_gte/count_lte', () => {
    const ctx = makeContext((c) => {
      c.state.events.history = [
        { eventId: 'ev', instanceId: 'i1', resolvedAtDay: 1, chosenOptionId: null, outcome: '' },
        { eventId: 'ev', instanceId: 'i2', resolvedAtDay: 2, chosenOptionId: null, outcome: '' },
      ];
    });
    expect(evalCond({ eventHistory: 'ev', check: 'count_gte', value: 2 }, ctx)).toBe(true);
    expect(evalCond({ eventHistory: 'ev', check: 'count_lte', value: 1 }, ctx)).toBe(false);
  });
});

describe('条件解释器 - 政策状态', () => {
  it('status_is/phase_is', () => {
    const ctx = makeContext((c) => {
      c.state.governance.policies = [
        {
          instanceId: 'pol_inst_1',
          policyId: 'pol_1',
          status: 'implementing',
          proposedAtDay: 0,
          approvedAtDay: 10,
          effectiveAtDay: 20,
          regionId: 'r1',
          responsibleInstitutionId: 'i1',
          currentPhaseId: 'phase_2',
          metrics: { coverage: 60 },
        },
      ];
    });
    expect(
      evalCond(
        {
          policyRef: { source: 'fixed', policyInstanceId: 'pol_inst_1' },
          check: 'status_is',
          value: 'implementing',
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evalCond(
        {
          policyRef: { source: 'fixed', policyInstanceId: 'pol_inst_1' },
          check: 'phase_is',
          value: 'phase_2',
        },
        ctx,
      ),
    ).toBe(true);
  });

  it('metric_gte/metric_lte', () => {
    const ctx = makeContext((c) => {
      c.state.governance.policies = [
        {
          instanceId: 'pol_inst_1',
          policyId: 'pol_1',
          status: 'implementing',
          proposedAtDay: 0,
          approvedAtDay: 10,
          effectiveAtDay: 20,
          regionId: 'r1',
          responsibleInstitutionId: 'i1',
          currentPhaseId: 'phase_2',
          metrics: { coverage: 60 },
        },
      ];
    });
    expect(
      evalCond(
        {
          policyRef: { source: 'fixed', policyInstanceId: 'pol_inst_1' },
          check: 'metric_gte',
          metricId: 'coverage',
          value: 50,
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      evalCond(
        {
          policyRef: { source: 'fixed', policyInstanceId: 'pol_inst_1' },
          check: 'metric_lte',
          metricId: 'coverage',
          value: 50,
        },
        ctx,
      ),
    ).toBe(false);
  });

  it('policyRef signal 引用隔离触发实例', () => {
    const ctx = makeContext((c) => {
      // 两个同 policyId 的实例，信号指向第二个
      c.state.governance.policies = [
        {
          instanceId: 'inst_A',
          policyId: 'pol_1',
          status: 'proposed',
          proposedAtDay: 0,
          approvedAtDay: null,
          effectiveAtDay: null,
          regionId: 'r1',
          responsibleInstitutionId: 'i1',
          currentPhaseId: 'p1',
          metrics: {},
        },
        {
          instanceId: 'inst_B',
          policyId: 'pol_1',
          status: 'implementing',
          proposedAtDay: 0,
          approvedAtDay: 5,
          effectiveAtDay: 10,
          regionId: 'r2',
          responsibleInstitutionId: 'i2',
          currentPhaseId: 'p2',
          metrics: {},
        },
      ];
      c.signal = {
        signalType: 'policy.approved',
        occurredAtDay: 100,
        data: { policyInstanceId: 'inst_B', policyId: 'pol_1', regionId: 'r2' },
      } as DomainSignalSnapshot;
    });
    // signal 引用应隔离出 inst_B（implementing），而非首个 inst_A（proposed）
    expect(
      evalCond({ policyRef: { source: 'signal' }, check: 'status_is', value: 'implementing' }, ctx),
    ).toBe(true);
    expect(
      evalCond({ policyRef: { source: 'signal' }, check: 'status_is', value: 'proposed' }, ctx),
    ).toBe(false);
  });

  it('政策实例未找到返回 false', () => {
    const ctx = makeContext();
    expect(
      evalCond(
        {
          policyRef: { source: 'fixed', policyInstanceId: 'nonexistent' },
          check: 'status_is',
          value: 'implementing',
        },
        ctx,
      ),
    ).toBe(false);
  });
});

describe('条件解释器 - 履历条件', () => {
  it('region_count/domain_count/level_count', () => {
    const ctx = makeContext((c) => {
      c.state.career.experiences = [
        {
          id: 'e1',
          positionId: 'p1',
          positionNameSnapshot: '',
          institutionId: 'i1',
          institutionNameSnapshot: '',
          institutionLevel: 'township',
          regionId: 'r1',
          positionDomain: 'local_governance',
          leadershipRank: 'none',
          startedAtDay: 0,
          endedAtDay: 10,
          appointmentReason: 'initial_assignment',
          assessmentResults: [],
        },
        {
          id: 'e2',
          positionId: 'p2',
          positionNameSnapshot: '',
          institutionId: 'i2',
          institutionNameSnapshot: '',
          institutionLevel: 'county',
          regionId: 'r2',
          positionDomain: 'party_organs',
          leadershipRank: 'none',
          startedAtDay: 10,
          endedAtDay: 20,
          appointmentReason: 'rotation',
          assessmentResults: [],
        },
      ];
    });
    expect(evalCond({ experience: 'region_count', op: 'gte', value: 2 }, ctx)).toBe(true);
    expect(evalCond({ experience: 'domain_count', op: 'eq', value: 2 }, ctx)).toBe(true);
    expect(evalCond({ experience: 'level_count', op: 'gte', value: 2 }, ctx)).toBe(true);
  });

  it('has_institution', () => {
    const ctx = makeContext((c) => {
      c.state.career.experiences = [
        {
          id: 'e1',
          positionId: 'p1',
          positionNameSnapshot: '',
          institutionId: 'i1',
          institutionNameSnapshot: '',
          institutionLevel: 'township',
          regionId: 'r1',
          positionDomain: 'local_governance',
          leadershipRank: 'none',
          startedAtDay: 0,
          endedAtDay: 10,
          appointmentReason: 'initial_assignment',
          assessmentResults: [],
        },
      ];
    });
    expect(evalCond({ experience: 'has_institution', op: 'eq', value: 'i1' }, ctx)).toBe(true);
    expect(evalCond({ experience: 'has_institution', op: 'eq', value: 'i999' }, ctx)).toBe(false);
  });
});
