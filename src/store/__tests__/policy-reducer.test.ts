/**
 * 政策 Reducer 集成测试
 *
 * 通过 createTestStore 覆盖政策 dispatch、快照效果、归属校验与 blocker continuation。
 */

import { describe, expect, it } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';
import { getConfigLoader } from '../../config/loader';

const policyId = 'industrial_park_support';

function idFactory(prefix: string) {
  let index = 0;
  return () => `${prefix}_${index++}`;
}

function propose(store: ReturnType<typeof createTestStore>) {
  store.dispatch({ type: 'PROPOSE_POLICY', policyId, _idFactory: idFactory('policy') });
  return store.getRawState().governance.policies[0]!;
}

describe('policy-reducer dispatch', () => {
  it('PROPOSE → APPROVE 应用冻结的 signal 引用效果', () => {
    const store = createTestStore();
    const proposed = propose(store);

    // 调用方对配置查询结果的篡改不能影响已经冻结的实例快照。
    getConfigLoader().getPolicyDefinition(policyId)!.approvalEffects.length = 0;
    store.dispatch({
      type: 'APPROVE_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: idFactory('signal'),
      _rng: () => 0,
    });

    const state = store.getRawState();
    const origin = state.governance.policies[0]!.originContext;
    expect(state.governance.policies[0]!.status).toBe('approved');
    expect(state.governance.institutionMetrics[origin.institutionId]?.policy_count).toBe(1);
    expect(state.governance.regionMetrics[origin.regionId]?.active_policies).toBe(1);
  });

  it('对未知地区、未知机构或不匹配归属的提议均不创建政策', () => {
    const base = createInitialState();
    const validInstitution = base.career.appointment.institutionId;
    const validRegion = base.career.appointment.regionId;
    const cases = [
      { regionId: 'missing_region' },
      { institutionId: 'missing_institution' },
      { institutionId: validInstitution, regionId: 'region_capital' },
      { regionId: validRegion, institutionId: 'ministry_01' },
    ];

    for (const payload of cases) {
      const store = createTestStore();
      store.dispatch({
        type: 'PROPOSE_POLICY',
        policyId,
        ...payload,
        _idFactory: idFactory('policy'),
      });
      expect(store.getRawState().governance.policies).toHaveLength(0);
    }
  });

  it('仅提供有效 institutionId 会自动使用其所属地区', () => {
    const store = createTestStore();
    store.dispatch({
      type: 'PROPOSE_POLICY',
      policyId,
      institutionId: 'county_govt_01',
      _idFactory: idFactory('policy'),
    });
    const origin = store.getRawState().governance.policies[0]!.originContext;
    expect(origin.institutionId).toBe('county_govt_01');
    expect(origin.regionId).toBe('region_yongning_county');
  });

  it('县级实例的阶段效果只写入其实例地区', () => {
    const store = createTestStore();
    store.dispatch({
      type: 'PROPOSE_POLICY',
      policyId,
      institutionId: 'county_govt_01',
      _idFactory: idFactory('policy'),
    });
    const proposed = store.getRawState().governance.policies[0]!;
    store.dispatch({
      type: 'APPROVE_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: idFactory('signal'),
    });
    store.dispatch({
      type: 'ACTIVATE_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: idFactory('signal'),
    });

    const metrics = store.getRawState().governance.regionMetrics;
    expect(metrics.region_yongning_county?.investment_progress).toBe(5);
    expect(metrics.region_jiangyuan_province?.investment_progress).toBeUndefined();
  });

  it('blocker 存在时将政策信号作为 continuation 延后处理', () => {
    const base = createInitialState();
    base.events.activeBlockingEventId = 'blocking_event';
    const store = createTestStore(base);

    const proposed = propose(store);
    store.dispatch({
      type: 'APPROVE_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: idFactory('signal'),
    });

    const state = store.getRawState();
    expect(state.events.deferredContinuations.length).toBeGreaterThan(0);
    expect(state.events.deferredContinuations[0]?.kind).toBe('signal');
  });

  it('七个 dispatch 分支的合法及非法状态转换都保持状态机约束', () => {
    const store = createTestStore();
    store.dispatch({ type: 'APPROVE_POLICY', policyInstanceId: 'missing' });
    expect(store.getRawState().governance.policies).toHaveLength(0);

    const proposed = propose(store);
    const ids = idFactory('signal');
    store.dispatch({
      type: 'APPROVE_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: ids,
    });
    store.dispatch({
      type: 'ACTIVATE_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: ids,
    });
    store.dispatch({
      type: 'SUSPEND_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: ids,
    });
    store.dispatch({
      type: 'RESUME_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: ids,
    });
    store.dispatch({ type: 'FAIL_POLICY', policyInstanceId: proposed.instanceId, _idFactory: ids });
    store.dispatch({
      type: 'REPEAL_POLICY',
      policyInstanceId: proposed.instanceId,
      _idFactory: ids,
    });

    expect(store.getRawState().governance.policies[0]!.status).toBe('failed');
  });
});
