/**
 * 政策转换 Store 事务的不变量测试。
 *
 * 覆盖非法索引、越界索引和实例 ID 不一致时的拒绝与无写入保证。
 */

import { describe, expect, it } from 'vitest';
import type { PolicyInstance } from '../../../domain/governance/state';
import type { PolicyTransitionResult } from '../../../engine/governance/policy-lifecycle';
import { createInitialState } from '../../game-store';
import { commitPolicyTransitionInTransaction } from '../policy-transition-transaction';

function policyInstance(instanceId: string): PolicyInstance {
  return {
    instanceId,
    policyId: 'test-policy',
    status: 'approved',
    proposedAtDay: 0,
    approvedAtDay: 0,
    effectiveAtDay: 1,
    currentPhaseId: null,
    phaseEnteredAtDay: null,
    nextMilestoneAtDay: null,
    suspendedAtDay: null,
    accumulatedSuspendedDays: 0,
    completedAtDay: null,
    failedAtDay: null,
    repealedAtDay: null,
    originContext: {
      positionId: 'position-a',
      institutionId: 'institution-a',
      regionId: 'region-a',
      institutionLevel: 'county',
      positionDomain: 'government_general',
      leadershipRank: 'none',
      experienceId: null,
    },
    snapshot: {
      policyId: 'test-policy',
      name: '测试政策',
      description: '',
      category: 'economic',
      tags: [],
      effectiveDelayDays: 1,
      approvalEffects: [],
      phases: [],
      contentVersion: 'test',
    },
    metrics: {},
  };
}

function successfulTransition(instance: PolicyInstance): PolicyTransitionResult {
  return {
    success: true,
    instance,
    effects: [],
    emittedSignals: [],
  };
}

describe('commitPolicyTransitionInTransaction', () => {
  it.each([
    ['负数索引', -1, 'existing-policy'],
    ['越界索引', 1, 'existing-policy'],
    ['实例 ID 不一致', 0, 'different-policy'],
  ])('%s 会抛错且不改变政策数组', (_label, policyIndex, resultInstanceId) => {
    const state = createInitialState();
    state.governance.policies = [policyInstance('existing-policy')];
    const before = structuredClone(state.governance.policies);
    const result = successfulTransition(policyInstance(resultInstanceId));

    expect(() =>
      commitPolicyTransitionInTransaction(state, result, policyIndex, 1, () => 'signal-id'),
    ).toThrow();
    expect(state.governance.policies).toEqual(before);
  });
});
