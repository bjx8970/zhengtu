/**
 * 指标信号桥接器测试。
 */

import { describe, expect, it } from 'vitest';
import type { PolicyInstance } from '../../../domain/governance/state';
import type { AppliedEffectRecord } from '../effect-executor';
import { deriveMetricSignalsFromEffects } from '../metric-signal-bridge';

const policy: PolicyInstance = {
  instanceId: 'policy-instance',
  policyId: 'policy-definition',
  status: 'implementing',
  proposedAtDay: 0,
  approvedAtDay: 0,
  effectiveAtDay: 0,
  currentPhaseId: 'phase',
  phaseEnteredAtDay: 0,
  nextMilestoneAtDay: 30,
  suspendedAtDay: null,
  accumulatedSuspendedDays: 0,
  completedAtDay: null,
  failedAtDay: null,
  repealedAtDay: null,
  originContext: {
    positionId: 'origin-position',
    institutionId: 'origin-institution',
    regionId: 'origin-region',
    institutionLevel: 'township',
    positionDomain: 'local_governance',
    leadershipRank: 'none',
    experienceId: null,
  },
  snapshot: {
    policyId: 'policy-definition',
    name: 'Policy',
    description: '',
    category: 'economic',
    tags: [],
    effectiveDelayDays: 0,
    approvalEffects: [],
    phases: [],
    contentVersion: 'test',
  },
  metrics: { progress: 20 },
};

describe('deriveMetricSignalsFromEffects', () => {
  it('折叠同指标变更、忽略无变化并保留首次出现顺序', () => {
    const effects: AppliedEffectRecord[] = [
      {
        effect: { target: 'world_metric', metricId: 'growth', operation: 'add', value: 1 },
        targetDescription: 'world_metric.growth',
        previousValue: 0,
        newValue: 1,
      },
      {
        effect: {
          target: 'policy_metric',
          policyRef: { source: 'fixed', policyInstanceId: policy.instanceId },
          metricId: 'progress',
          operation: 'set',
          value: 20,
        },
        targetDescription: 'policy_metric.policy-instance.progress',
        previousValue: 20,
        newValue: 20,
      },
      {
        effect: { target: 'world_metric', metricId: 'growth', operation: 'add', value: 2 },
        targetDescription: 'world_metric.growth',
        previousValue: 1,
        newValue: 3,
      },
      {
        effect: {
          target: 'policy_metric',
          policyRef: { source: 'fixed', policyInstanceId: policy.instanceId },
          metricId: 'progress',
          operation: 'add',
          value: 5,
        },
        targetDescription: 'policy_metric.policy-instance.progress',
        previousValue: 20,
        newValue: 25,
      },
    ];
    let sequence = 0;
    const signals = deriveMetricSignalsFromEffects(
      effects,
      { currentDay: 12, policies: [policy] },
      () => `signal-${sequence++}`,
    );

    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      signalId: 'signal-0',
      signalType: 'world.metric_changed',
      occurredAtDay: 12,
      data: { metricId: 'growth', value: 3 },
    });
    expect(signals[1]).toMatchObject({
      signalId: 'signal-1',
      signalType: 'policy.metric_changed',
      data: {
        policyInstanceId: 'policy-instance',
        policyId: 'policy-definition',
        metricId: 'progress',
        value: 25,
        regionId: 'origin-region',
        institutionId: 'origin-institution',
        originPositionId: 'origin-position',
      },
    });
  });
});
