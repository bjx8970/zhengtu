/**
 * 指标效果到领域信号的桥接器。
 *
 * 只为实际变化的世界/政策指标生成信号；同一事务内同一指标的多次变化
 * 折叠为最终值，同时保持指标首次出现的稳定顺序。
 */

import type { PolicyInstance } from '../../domain/governance/state';
import type { DomainSignalSnapshot } from '../../domain/governance/types';
import type { AppliedEffectRecord } from './effect-executor';

/** 指标信号派生上下文。 */
export interface MetricSignalContext {
  /** 效果发生的绝对日 */
  currentDay: number;
  /** 事务提交后的政策实例集合 */
  policies: readonly PolicyInstance[];
}

interface PendingMetricSignal {
  build: (signalId: string) => DomainSignalSnapshot;
}

/**
 * 从统一效果执行记录派生指标变化信号。
 *
 * @param appliedEffects 已应用效果记录
 * @param context 当前日与政策上下文
 * @param idFactory 稳定 ID 工厂
 * @returns 按首次出现顺序折叠后的指标信号
 */
export function deriveMetricSignalsFromEffects(
  appliedEffects: readonly AppliedEffectRecord[],
  context: MetricSignalContext,
  idFactory: () => string,
): DomainSignalSnapshot[] {
  const order: string[] = [];
  const pending = new Map<string, PendingMetricSignal>();

  for (const record of appliedEffects) {
    if (record.previousValue === record.newValue) continue;

    if (record.effect.target === 'world_metric') {
      const metricId = record.effect.metricId;
      const key = `world:${metricId}`;
      if (!pending.has(key)) order.push(key);
      pending.set(key, {
        build: (signalId) => ({
          signalId,
          signalType: 'world.metric_changed',
          occurredAtDay: context.currentDay,
          data: { metricId, value: Number(record.newValue) },
        }),
      });
      continue;
    }

    if (record.effect.target !== 'policy_metric') continue;
    const policyInstanceId =
      record.effect.policyRef.source === 'fixed' ? record.effect.policyRef.policyInstanceId : null;
    if (!policyInstanceId) {
      throw new Error(
        'Applied policy metric record must contain a resolved fixed policy reference',
      );
    }
    const policy = context.policies.find((item) => item.instanceId === policyInstanceId);
    if (!policy) {
      throw new Error(`Policy instance "${policyInstanceId}" not found for metric signal`);
    }
    const metricId = record.effect.metricId;
    const key = `policy:${policyInstanceId}:${metricId}`;
    if (!pending.has(key)) order.push(key);
    pending.set(key, {
      build: (signalId) => ({
        signalId,
        signalType: 'policy.metric_changed',
        occurredAtDay: context.currentDay,
        data: {
          policyInstanceId,
          policyId: policy.policyId,
          metricId,
          value: Number(record.newValue),
          regionId: policy.originContext.regionId,
          institutionId: policy.originContext.institutionId,
          originPositionId: policy.originContext.positionId,
        },
      }),
    });
  }

  return order.map((key) => {
    const item = pending.get(key);
    if (!item) throw new Error(`Missing pending metric signal "${key}"`);
    return item.build(idFactory());
  });
}
