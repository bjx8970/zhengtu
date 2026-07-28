/**
 * 政策生命周期引擎单元测试
 *
 * 测试纯函数的合法/非法状态转换、信号生成、效果收集。
 */
import { describe, it, expect } from 'vitest';
import {
  proposePolicy,
  approvePolicy,
  activatePolicy,
  suspendPolicy,
  resumePolicy,
  advancePolicyPhase,
  failPolicy,
  completePolicy,
  repealPolicy,
  createPolicySnapshot,
} from '../policy-lifecycle';
import type { PolicyInstance, PolicyOriginContextSnapshot } from '../../../domain/governance/state';
import type { PolicyDefinitionConfig } from '../../../types/config';

let idSeq = 0;
function makeId(prefix: string) {
  return () => `${prefix}_${++idSeq}`;
}

function makeOriginContext(
  overrides: Partial<PolicyOriginContextSnapshot> = {},
): PolicyOriginContextSnapshot {
  return {
    positionId: 'pos_mayor',
    institutionId: 'inst_city_a',
    regionId: 'region_001',
    institutionLevel: 'county',
    positionDomain: 'local_governance',
    leadershipRank: 'county_chief',
    experienceId: 'exp_001',
    ...overrides,
  };
}

function makeDefinition(
  overrides: Partial<PolicyDefinitionConfig> & { id: string },
): PolicyDefinitionConfig {
  return {
    id: overrides.id,
    name: `政策-${overrides.id}`,
    description: '测试政策',
    category: overrides.category ?? 'economic',
    tags: overrides.tags ?? ['测试'],
    effectiveDelayDays: overrides.effectiveDelayDays ?? 0,
    phases: overrides.phases ?? [
      {
        id: 'phase_1',
        name: '第一阶段',
        description: '初始实施',
        durationDays: 30,
        entryEffects: [],
        completionEffects: [],
      },
    ],
    availabilityCondition: overrides.availabilityCondition ?? undefined,
    approvalEffects: overrides.approvalEffects ?? [],
  };
}

// ===== proposePolicy =====

describe('proposePolicy', () => {
  it('成功提议政策', () => {
    const result = proposePolicy({
      definition: makeDefinition({ id: 'policy_test_1' }),
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.instance.status).toBe('proposed');
    expect(result.instance.proposedAtDay).toBe(0);
    expect(result.instance.policyId).toBe('policy_test_1');
    expect(result.emittedSignals.length).toBe(0);
  });

  it('重复政策返回 duplicate_active_policy', () => {
    const ctx = makeOriginContext();
    const def = makeDefinition({ id: 'policy_dup' });
    const firstResult = proposePolicy({
      definition: def,
      originContext: ctx,
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    }) as { success: true; instance: PolicyInstance };

    const result = proposePolicy({
      definition: def,
      originContext: ctx,
      currentDay: 1,
      idFactory: makeId('inst'),
      existingPolicies: [firstResult.instance],
      evaluateCondition: () => true,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('duplicate_active_policy');
  });

  it('不同区域可同时提议同一政策', () => {
    const def = makeDefinition({ id: 'policy_multi_region' });
    const ctx1 = makeOriginContext({ regionId: 'region_001', institutionId: 'inst_001' });
    const ctx2 = makeOriginContext({ regionId: 'region_002', institutionId: 'inst_002' });

    const r1 = proposePolicy({
      definition: def,
      originContext: ctx1,
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });

    expect(r1.success).toBe(true);
    if (!r1.success) return;

    const r2 = proposePolicy({
      definition: def,
      originContext: ctx2,
      currentDay: 1,
      idFactory: makeId('inst'),
      existingPolicies: [r1.instance],
      evaluateCondition: () => true,
    });

    expect(r2.success).toBe(true);
  });

  it('可用性条件失败返回 condition_failed', () => {
    const result = proposePolicy({
      definition: makeDefinition({ id: 'policy_cond_fail', availabilityCondition: { all: [] } }),
      originContext: makeOriginContext(),
      currentDay: 10,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => false,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('condition_failed');
  });
});

// ===== approvePolicy =====

describe('approvePolicy', () => {
  function makeProposed(overrides: Partial<PolicyInstance> = {}): PolicyInstance {
    const def = makeDefinition({ id: 'policy_app' });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const inst = (result as { success: true; instance: PolicyInstance }).instance;
    return { ...inst, ...overrides };
  }

  it('从 proposed 批准', () => {
    const instance = makeProposed();
    const result = approvePolicy({ instance, currentDay: 5, idFactory: makeId('sig') });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.instance.status).toBe('approved');
    expect(result.instance.approvedAtDay).toBe(5);
    expect(result.emittedSignals.length).toBe(2);
    expect(result.emittedSignals[0]!.signalType).toBe('policy.approved');
    expect(result.emittedSignals[1]!.signalType).toBe('policy.status_changed');
  });

  it('非法状态转换失败', () => {
    const instance = { ...makeProposed(), status: 'implementing' as const };
    const result = approvePolicy({ instance, currentDay: 5, idFactory: makeId('sig') });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('invalid_transition');
  });
});

// ===== activatePolicy =====

describe('activatePolicy', () => {
  function makeApproved(overrides: Partial<PolicyInstance> = {}): PolicyInstance {
    const def = makeDefinition({ id: 'policy_act', effectiveDelayDays: 3 });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    return { ...approved, ...overrides };
  }

  it('从 approved 激活', () => {
    const instance = makeApproved();
    const result = activatePolicy({ instance, currentDay: 10, idFactory: makeId('sig') });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.instance.status).toBe('implementing');
    expect(result.instance.currentPhaseId).toBe('phase_1');
    expect(result.emittedSignals.length).toBe(2);
    expect(result.emittedSignals.some((s) => s.signalType === 'policy.phase_changed')).toBe(true);
  });

  it('生效日期未到返回 not_effective_yet', () => {
    const instance = makeApproved();
    const result = activatePolicy({ instance, currentDay: 6, idFactory: makeId('sig') });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('not_effective_yet');
  });

  it('无阶段政策返回 no_phases', () => {
    const def = makeDefinition({ id: 'policy_no_phase', phases: [] });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;

    const actResult = activatePolicy({
      instance: approved,
      currentDay: 10,
      idFactory: makeId('sig'),
    });
    expect(actResult.success).toBe(false);
    if (actResult.success) return;
    expect(actResult.reason).toBe('no_phases');
  });
});

// ===== suspendPolicy / resumePolicy =====

describe('suspendPolicy & resumePolicy', () => {
  function makeImplementing(overrides: Partial<PolicyInstance> = {}): PolicyInstance {
    const def = makeDefinition({ id: 'policy_sus', effectiveDelayDays: 0 });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    const actResult = activatePolicy({
      instance: approved,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const implementing = (actResult as { success: true; instance: PolicyInstance }).instance;
    return { ...implementing, ...overrides };
  }

  it('暂停 implementing 政策', () => {
    const instance = makeImplementing();
    const result = suspendPolicy({ instance, currentDay: 20, idFactory: makeId('sig') });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.instance.status).toBe('suspended');
    expect(result.instance.suspendedAtDay).toBe(20);
    expect(result.emittedSignals[0]!.signalType).toBe('policy.status_changed');
  });

  it('恢复暂停的政策，里程碑顺延', () => {
    const instance = makeImplementing();
    const suspended = suspendPolicy({ instance, currentDay: 20, idFactory: makeId('sig') });
    const suspendedInst = (suspended as { success: true; instance: PolicyInstance }).instance;
    const originalMilestone = instance.nextMilestoneAtDay!;

    const result = resumePolicy({
      instance: suspendedInst,
      currentDay: 42,
      idFactory: makeId('sig'),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.instance.status).toBe('implementing');
    expect(result.instance.suspendedAtDay).toBeNull();
    expect(result.instance.accumulatedSuspendedDays).toBe(22); // 42 - 20 = 22
    expect(result.instance.nextMilestoneAtDay).toBe(originalMilestone + 22);
  });

  it('暂停非 implementing 状态失败', () => {
    const instance = { ...makeImplementing(), status: 'approved' as const };
    const result = suspendPolicy({ instance, currentDay: 10, idFactory: makeId('sig') });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('invalid_transition');
  });
});

// ===== advancePolicyPhase =====

describe('advancePolicyPhase', () => {
  function makeMultiPhase(): PolicyInstance {
    const def = makeDefinition({
      id: 'policy_multi',
      effectiveDelayDays: 0,
      phases: [
        {
          id: 'phase_1',
          name: '一',
          description: '',
          durationDays: 10,
          entryEffects: [],
          completionEffects: [],
        },
        {
          id: 'phase_2',
          name: '二',
          description: '',
          durationDays: 10,
          entryEffects: [],
          completionEffects: [],
        },
        {
          id: 'phase_3',
          name: '三',
          description: '',
          durationDays: 10,
          entryEffects: [],
          completionEffects: [],
        },
      ],
    });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    const actResult = activatePolicy({
      instance: approved,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    return (actResult as { success: true; instance: PolicyInstance }).instance;
  }

  it('推进到下一阶段', () => {
    const instance = makeMultiPhase();
    const result = advancePolicyPhase({ instance, currentDay: 15, idFactory: makeId('sig') });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.instance.currentPhaseId).toBe('phase_2');
    expect(result.emittedSignals.some((s) => s.signalType === 'policy.phase_changed')).toBe(true);
  });

  it('里程碑未到返回 not_effective_yet', () => {
    const instance = makeMultiPhase();
    const result = advancePolicyPhase({ instance, currentDay: 6, idFactory: makeId('sig') });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('not_effective_yet');
  });

  it('最后阶段完成后自动标记 completed', () => {
    const instance = makeMultiPhase();
    // 推进到 phase 2
    const r1 = advancePolicyPhase({ instance, currentDay: 15, idFactory: makeId('sig') });
    const inst2 = (r1 as { success: true; instance: PolicyInstance }).instance;
    // 推进到 phase 3
    const r2 = advancePolicyPhase({ instance: inst2, currentDay: 25, idFactory: makeId('sig') });
    const inst3 = (r2 as { success: true; instance: PolicyInstance }).instance;
    // 推进到最后完成
    const result = advancePolicyPhase({
      instance: inst3,
      currentDay: 35,
      idFactory: makeId('sig'),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.instance.status).toBe('completed');
    expect(result.instance.completedAtDay).toBe(35);
    expect(result.emittedSignals.some((s) => s.signalType === 'policy.status_changed')).toBe(true);
  });

  it('非 implementing 状态失败', () => {
    const instance = { ...makeMultiPhase(), status: 'approved' as const };
    const result = advancePolicyPhase({ instance, currentDay: 15, idFactory: makeId('sig') });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('invalid_transition');
  });
});

// ===== failPolicy / completePolicy / repealPolicy =====

describe('failPolicy', () => {
  it('从 implementing 失败', () => {
    const def = makeDefinition({ id: 'policy_fail_1', effectiveDelayDays: 0 });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    const actResult = activatePolicy({
      instance: approved,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const implementing = (actResult as { success: true; instance: PolicyInstance }).instance;

    const failResult = failPolicy({
      instance: implementing,
      currentDay: 15,
      idFactory: makeId('sig'),
    });

    expect(failResult.success).toBe(true);
    if (!failResult.success) return;
    expect(failResult.instance.status).toBe('failed');
    expect(failResult.instance.failedAtDay).toBe(15);
    expect(failResult.emittedSignals[0]!.signalType).toBe('policy.status_changed');
  });

  it('终态再次失败返回 already_terminal', () => {
    const def = makeDefinition({ id: 'policy_fail_2', effectiveDelayDays: 0 });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    const actResult = activatePolicy({
      instance: approved,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const implementing = (actResult as { success: true; instance: PolicyInstance }).instance;
    const failed = failPolicy({ instance: implementing, currentDay: 15, idFactory: makeId('sig') });
    const failedInst = (failed as { success: true; instance: PolicyInstance }).instance;

    const result2 = failPolicy({ instance: failedInst, currentDay: 20, idFactory: makeId('sig') });
    expect(result2.success).toBe(false);
    if (result2.success) return;
    expect(result2.reason).toBe('already_terminal');
  });
});

describe('completePolicy', () => {
  it('从 implementing 手动完成', () => {
    const def = makeDefinition({ id: 'policy_comp', effectiveDelayDays: 0 });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    const actResult = activatePolicy({
      instance: approved,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const implementing = (actResult as { success: true; instance: PolicyInstance }).instance;

    const compResult = completePolicy({
      instance: implementing,
      currentDay: 20,
      idFactory: makeId('sig'),
    });

    expect(compResult.success).toBe(true);
    if (!compResult.success) return;
    expect(compResult.instance.status).toBe('completed');
    expect(compResult.instance.completedAtDay).toBe(20);
  });
});

describe('repealPolicy', () => {
  it('从 proposed 废止', () => {
    const def = makeDefinition({ id: 'policy_repeal_1' });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;

    const repealResult = repealPolicy({
      instance: proposed,
      currentDay: 10,
      idFactory: makeId('sig'),
    });

    expect(repealResult.success).toBe(true);
    if (!repealResult.success) return;
    expect(repealResult.instance.status).toBe('repealed');
    expect(repealResult.instance.repealedAtDay).toBe(10);
  });

  it('从 implementing 废止', () => {
    const def = makeDefinition({ id: 'policy_repeal_2', effectiveDelayDays: 0 });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    const actResult = activatePolicy({
      instance: approved,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const implementing = (actResult as { success: true; instance: PolicyInstance }).instance;

    const repealResult = repealPolicy({
      instance: implementing,
      currentDay: 15,
      idFactory: makeId('sig'),
    });

    expect(repealResult.success).toBe(true);
    if (!repealResult.success) return;
    expect(repealResult.instance.status).toBe('repealed');
  });

  it('终态废止返回 already_terminal', () => {
    const def = makeDefinition({ id: 'policy_repeal_3', effectiveDelayDays: 0 });
    const result = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    const proposed = (result as { success: true; instance: PolicyInstance }).instance;
    const approvedResult = approvePolicy({
      instance: proposed,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const approved = (approvedResult as { success: true; instance: PolicyInstance }).instance;
    const actResult = activatePolicy({
      instance: approved,
      currentDay: 5,
      idFactory: makeId('sig'),
    });
    const implementing = (actResult as { success: true; instance: PolicyInstance }).instance;
    const repealed = repealPolicy({
      instance: implementing,
      currentDay: 15,
      idFactory: makeId('sig'),
    });
    const repealedInst = (repealed as { success: true; instance: PolicyInstance }).instance;

    const result2 = repealPolicy({
      instance: repealedInst,
      currentDay: 20,
      idFactory: makeId('sig'),
    });
    expect(result2.success).toBe(false);
    if (result2.success) return;
    expect(result2.reason).toBe('already_terminal');
  });
});

// ===== createPolicySnapshot =====

describe('createPolicySnapshot', () => {
  it('从定义创建快照', () => {
    const def = makeDefinition({
      id: 'policy_snap',
      phases: [
        {
          id: 'p1',
          name: 'P1',
          description: '第一阶段',
          durationDays: 14,
          entryEffects: [],
          completionEffects: [],
        },
      ],
    });

    const snapshot = createPolicySnapshot(def);

    expect(snapshot.policyId).toBe('policy_snap');
    expect(snapshot.name).toBe('政策-policy_snap');
    expect(snapshot.phases.length).toBe(1);
    expect(snapshot.phases[0]!.durationDays).toBe(14);
    expect(snapshot.category).toBe('economic');
  });
});

// ===== 完整生命周期序列 =====

describe('full lifecycle sequence', () => {
  it('proposed → approved → implementing → completed', () => {
    const def = makeDefinition({
      id: 'policy_full',
      effectiveDelayDays: 5,
      phases: [
        {
          id: 'p1',
          name: 'P1',
          description: '',
          durationDays: 15,
          entryEffects: [],
          completionEffects: [],
        },
        {
          id: 'p2',
          name: 'P2',
          description: '',
          durationDays: 15,
          entryEffects: [],
          completionEffects: [],
        },
      ],
    });

    // 提议
    const r1 = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    expect(r1.instance.status).toBe('proposed');

    // 批准
    const r2 = approvePolicy({ instance: r1.instance, currentDay: 5, idFactory: makeId('sig') });
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    expect(r2.instance.status).toBe('approved');
    expect(r2.instance.effectiveAtDay).toBe(10);

    // 激活
    const r3 = activatePolicy({ instance: r2.instance, currentDay: 12, idFactory: makeId('sig') });
    expect(r3.success).toBe(true);
    if (!r3.success) return;
    expect(r3.instance.status).toBe('implementing');
    expect(r3.instance.currentPhaseId).toBe('p1');

    // 推进 phase 1 → phase 2
    const r4 = advancePolicyPhase({
      instance: r3.instance,
      currentDay: 27,
      idFactory: makeId('sig'),
    });
    expect(r4.success).toBe(true);
    if (!r4.success) return;
    expect(r4.instance.currentPhaseId).toBe('p2');

    // 推进 phase 2 → completed
    const r5 = advancePolicyPhase({
      instance: r4.instance,
      currentDay: 42,
      idFactory: makeId('sig'),
    });
    expect(r5.success).toBe(true);
    if (!r5.success) return;
    expect(r5.instance.status).toBe('completed');
    expect(r5.instance.completedAtDay).toBe(42);
  });

  it('proposed → approved → implementing → suspended → resumed → completed', () => {
    const def = makeDefinition({
      id: 'policy_suspend_full',
      effectiveDelayDays: 0,
      phases: [
        {
          id: 'p1',
          name: 'P1',
          description: '',
          durationDays: 20,
          entryEffects: [],
          completionEffects: [],
        },
      ],
    });

    const r1 = proposePolicy({
      definition: def,
      originContext: makeOriginContext(),
      currentDay: 0,
      idFactory: makeId('inst'),
      existingPolicies: [],
      evaluateCondition: () => true,
    });
    if (!r1.success) throw new Error('proposePolicy failed');
    const r2 = approvePolicy({
      instance: r1.instance,
      currentDay: 3,
      idFactory: makeId('sig'),
    });
    if (!r2.success) throw new Error('approvePolicy failed');
    const r3 = activatePolicy({
      instance: r2.instance,
      currentDay: 3,
      idFactory: makeId('sig'),
    });
    if (!r3.success) throw new Error('activatePolicy failed');
    const inst = r3.instance;

    // 暂停
    const r4 = suspendPolicy({ instance: inst, currentDay: 10, idFactory: makeId('sig') });
    expect(r4.success).toBe(true);
    if (!r4.success) return;
    expect(r4.instance.status).toBe('suspended');

    // 恢复
    const r5 = resumePolicy({ instance: r4.instance, currentDay: 25, idFactory: makeId('sig') });
    expect(r5.success).toBe(true);
    if (!r5.success) return;
    expect(r5.instance.status).toBe('implementing');
    // 里程碑应该顺延了 15 天
    expect(r5.instance.nextMilestoneAtDay).toBe(23 + 15); // 原 milestone 23 (3+20) + 暂停 15

    // 完成
    const r6 = advancePolicyPhase({
      instance: r5.instance,
      currentDay: 40,
      idFactory: makeId('sig'),
    });
    expect(r6.success).toBe(true);
    if (!r6.success) return;
    expect(r6.instance.status).toBe('completed');
  });
});
