/**
 * 事件来源键派生函数测试
 *
 * 覆盖 deriveEventSourceKey 对所有 8 种信号类型的处理。
 */
import { describe, it, expect } from 'vitest';
import { deriveEventSourceKey } from '../source-key';
import type { DomainSignalSnapshot } from '../../../domain/governance/types';

/** 创建含 signalId 的 action.completed 信号快照 */
function makeActionCompletedSig(
  signalId: string,
  actionInstanceId = 'action_001',
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'action.completed',
    occurredAtDay: 10,
    data: {
      actionInstanceId,
      actionId: 'build_road',
      deptId: 'transport_dept',
      regionId: 'east',
      institutionId: 'transport_bureau',
    },
  };
}

/** 创建 policy.approved 信号快照 */
function makePolicyApprovedSig(
  signalId: string,
  policyInstanceId = 'policy_001',
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'policy.approved',
    occurredAtDay: 10,
    data: { policyInstanceId, policyId: 'tax_reform', regionId: 'central' },
  };
}

/** 创建 policy.phase_changed 信号快照 */
function makePolicyPhaseChangedSig(
  signalId: string,
  policyInstanceId = 'policy_002',
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'policy.phase_changed',
    occurredAtDay: 20,
    data: { policyInstanceId, policyId: 'edu_reform', phaseId: 'phase_2' },
  };
}

/** 创建 policy.metric_changed 信号快照 */
function makePolicyMetricChangedSig(
  signalId: string,
  policyInstanceId = 'policy_003',
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'policy.metric_changed',
    occurredAtDay: 30,
    data: { policyInstanceId, policyId: 'health_reform', metricId: 'coverage', value: 85 },
  };
}

/** 创建 appointment.changed 信号快照 */
function makeAppointmentChangedSig(
  signalId: string,
  experienceId = 'exp_001',
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'appointment.changed',
    occurredAtDay: 40,
    data: {
      experienceId,
      positionId: 'pos_mayor',
      institutionId: 'city_gov',
      regionId: 'south',
      previousPositionId: null,
    },
  };
}

/** 创建 assessment.completed 信号快照 */
function makeAssessmentCompletedSig(
  signalId: string,
  year = 2025,
  tier = '优秀',
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'assessment.completed',
    occurredAtDay: 50,
    data: { year, score: 92, tier },
  };
}

/** 创建 world.metric_changed 信号快照 */
function makeWorldMetricChangedSig(signalId: string): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'world.metric_changed',
    occurredAtDay: 60,
    data: { metricId: 'gdp_growth', value: 5.5 },
  };
}

/** 创建 event.resolved 信号快照 */
function makeEventResolvedSig(
  signalId: string,
  eventInstanceId = 'evt_inst_001',
): DomainSignalSnapshot {
  return {
    signalId,
    signalType: 'event.resolved',
    occurredAtDay: 70,
    data: { eventInstanceId, eventId: 'evt_crisis', optionId: 'opt_a', occurredAtDay: 70 },
  };
}

describe('deriveEventSourceKey', () => {
  it('action.completed → data.actionInstanceId', () => {
    const sig = makeActionCompletedSig('sig_001', 'action_xyz');
    expect(deriveEventSourceKey(sig)).toBe('action_xyz');
  });

  it('policy.approved → data.policyInstanceId', () => {
    const sig = makePolicyApprovedSig('sig_002', 'policy_abc');
    expect(deriveEventSourceKey(sig)).toBe('policy_abc');
  });

  it('policy.phase_changed → data.policyInstanceId', () => {
    const sig = makePolicyPhaseChangedSig('sig_003', 'policy_def');
    expect(deriveEventSourceKey(sig)).toBe('policy_def');
  });

  it('policy.metric_changed → data.policyInstanceId', () => {
    const sig = makePolicyMetricChangedSig('sig_004', 'policy_ghi');
    expect(deriveEventSourceKey(sig)).toBe('policy_ghi');
  });

  it('appointment.changed → data.experienceId', () => {
    const sig = makeAppointmentChangedSig('sig_005', 'exp_promotion');
    expect(deriveEventSourceKey(sig)).toBe('exp_promotion');
  });

  it('assessment.completed → "assessment_{year}_{tier}"', () => {
    const sig = makeAssessmentCompletedSig('sig_006', 2026, '称职');
    expect(deriveEventSourceKey(sig)).toBe('assessment_2026_称职');
  });

  it('assessment.completed with different tier', () => {
    const sig = makeAssessmentCompletedSig('sig_007', 2025, '基本称职');
    expect(deriveEventSourceKey(sig)).toBe('assessment_2025_基本称职');
  });

  it('world.metric_changed → signal.signalId', () => {
    const sig = makeWorldMetricChangedSig('sig_world_008');
    expect(deriveEventSourceKey(sig)).toBe('sig_world_008');
  });

  it('event.resolved → data.eventInstanceId', () => {
    const sig = makeEventResolvedSig('sig_009', 'evt_inst_resolved');
    expect(deriveEventSourceKey(sig)).toBe('evt_inst_resolved');
  });
});
