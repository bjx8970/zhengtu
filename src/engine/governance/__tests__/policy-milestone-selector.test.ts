/**
 * 到期政策选择器测试。
 */

import { describe, expect, it } from 'vitest';
import type { PolicyInstance } from '../../../domain/governance/state';
import {
  selectDuePolicyActivations,
  selectDuePolicyMilestones,
} from '../policy-milestone-selector';

function policy(instanceId: string, overrides: Partial<PolicyInstance> = {}): PolicyInstance {
  return {
    instanceId,
    policyId: `policy-${instanceId}`,
    status: 'approved',
    proposedAtDay: 0,
    approvedAtDay: 0,
    effectiveAtDay: 5,
    currentPhaseId: null,
    phaseEnteredAtDay: null,
    nextMilestoneAtDay: null,
    suspendedAtDay: null,
    accumulatedSuspendedDays: 0,
    completedAtDay: null,
    failedAtDay: null,
    repealedAtDay: null,
    originContext: {
      positionId: 'position',
      institutionId: 'institution',
      regionId: 'region',
      institutionLevel: 'township',
      positionDomain: 'local_governance',
      leadershipRank: 'none',
      experienceId: null,
    },
    snapshot: {
      policyId: `policy-${instanceId}`,
      name: instanceId,
      description: '',
      category: 'economic',
      tags: [],
      effectiveDelayDays: 0,
      approvalEffects: [],
      phases: [],
      contentVersion: 'test',
    },
    metrics: {},
    ...overrides,
  };
}

describe('policy milestone selector', () => {
  it('只选择已到期的 approved 政策并稳定排序', () => {
    const selected = selectDuePolicyActivations(
      [
        policy('b', { effectiveAtDay: 5 }),
        policy('future', { effectiveAtDay: 6 }),
        policy('a', { effectiveAtDay: 5 }),
        policy('earlier', { effectiveAtDay: 3 }),
        policy('active', { status: 'implementing', effectiveAtDay: 1 }),
      ],
      5,
    );
    expect(selected.map((item) => item.instanceId)).toEqual(['earlier', 'a', 'b']);
  });

  it('只选择实施中到期里程碑，暂停与终态均不推进', () => {
    const selected = selectDuePolicyMilestones(
      [
        policy('b', {
          status: 'implementing',
          currentPhaseId: 'phase',
          nextMilestoneAtDay: 5,
        }),
        policy('a', {
          status: 'implementing',
          currentPhaseId: 'phase',
          nextMilestoneAtDay: 5,
        }),
        policy('future', {
          status: 'implementing',
          currentPhaseId: 'phase',
          nextMilestoneAtDay: 6,
        }),
        policy('paused', { status: 'suspended', nextMilestoneAtDay: 1 }),
        policy('done', { status: 'completed', nextMilestoneAtDay: 1 }),
      ],
      5,
    );
    expect(selected.map((item) => item.instanceId)).toEqual(['a', 'b']);
  });
});
