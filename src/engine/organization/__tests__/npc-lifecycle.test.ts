/** NPC 年度生命周期 Engine 与时间轴接入测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import { createInitialState, createTestStore } from '../../../store/game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../../../store/save-codec';
import { settleNpcLifecycle } from '../npc-lifecycle';

function settle(state = createInitialState(), currentDay = 360, currentYear = 2012) {
  const loader = getConfigLoader();
  return settleNpcLifecycle({
    organization: state.organization,
    currentDay,
    currentYear,
    daysPerYear: 360,
    config: loader.getGameConfig().npcLifecycle,
    rankProgressionRules: loader.getAllCivilServiceRankProgressionRules(),
    rng: () => 0.5,
  });
}

describe('settleNpcLifecycle', () => {
  it('纯函数不修改输入，并将年度考核写入干部与当前履历两条通道', () => {
    const state = createInitialState();
    const before = structuredClone(state.organization);
    const result = settle(state);
    const assigned = result.organization.cadres.find((cadre) => cadre.currentAppointment);

    expect(state.organization).toEqual(before);
    expect(assigned?.assessments).toHaveLength(1);
    expect(assigned?.experiences[0]?.assessmentResults).toHaveLength(1);
    expect(result.assessments.some((assessment) => assessment.cadreId === assigned?.cadreId)).toBe(
      true,
    );
  });

  it('固定 RNG 与稳定干部顺序产生可重复结果', () => {
    expect(settle()).toEqual(settle());
  });

  it('达到配置退休年龄时原子关闭任职、履历、Seat 并追加离任事实', () => {
    const state = createInitialState();
    const cadre = state.organization.cadres.find((item) => item.currentAppointment);
    if (!cadre?.currentAppointment) throw new Error('Expected assigned NPC');
    cadre.birthYear = 1940;
    const appointmentId = cadre.currentAppointment.appointmentId;

    const result = settle(state, 360, 2012);
    const retired = result.organization.cadres.find((item) => item.cadreId === cadre.cadreId);
    const departure = result.organization.departures.find(
      (item) => item.appointmentId === appointmentId,
    );
    const seat = result.organization.seats.find((item) => item.currentAppointmentId === null);

    expect(retired).toMatchObject({
      status: 'retired',
      currentAppointment: null,
      exitedAtDay: 360,
    });
    expect(retired?.experiences[0]?.endReason).toBe('retirement');
    expect(departure).toMatchObject({ reason: 'retirement', appointmentId });
    expect(seat?.occupant).not.toEqual({ type: 'npc', id: cadre.cadreId });
    const restored = decodeCurrentSave(
      JSON.stringify(wrapSaveEnvelope({ ...state, organization: result.organization })),
    );
    expect(restored.success).toBe(true);
    expect(restored.state?.organization.departures).toEqual(result.organization.departures);
  });

  it('未任职 active NPC 纪律退出时只记录无 Seat 生命周期事实', () => {
    const state = createInitialState();
    const cadre = state.organization.cadres.find((item) => !item.currentAppointment);
    if (!cadre) throw new Error('Expected an unassigned NPC');
    const loader = getConfigLoader();
    const config = structuredClone(loader.getGameConfig().npcLifecycle);
    config.annualAssessment = {
      ...config.annualAssessment,
      baseScore: 0,
      specialtyWeight: 0,
      tenureBonusPerYear: 0,
      historyWeight: 0,
      randomSpread: 0,
      excellentThreshold: 100,
      competentThreshold: 100,
      basicThreshold: 100,
    };
    config.exit.consecutiveFailureThreshold = 1;

    const result = settleNpcLifecycle({
      organization: state.organization,
      currentDay: 360,
      currentYear: 2012,
      daysPerYear: 360,
      config,
      rankProgressionRules: loader.getAllCivilServiceRankProgressionRules(),
      rng: () => 0.5,
    });
    const exited = result.organization.cadres.find((item) => item.cadreId === cadre.cadreId);
    const departure = result.organization.departures.find((item) => item.cadreId === cadre.cadreId);

    expect(exited).toMatchObject({ status: 'exited', currentAppointment: null, exitedAtDay: 360 });
    expect(departure).toMatchObject({
      reason: 'disciplinary_exit',
      appointmentId: null,
      experienceId: null,
      seatId: null,
      positionId: null,
      institutionId: null,
      regionId: null,
    });
  });

  it('冻结或处分限制会阻止 NPC 职级资格', () => {
    const state = createInitialState();
    const cadre = state.organization.cadres.find(
      (item) => item.currentAppointment && item.civilServiceRank === 'clerk_1',
    );
    if (!cadre) throw new Error('Expected assigned clerk_1 NPC');
    cadre.civilServiceRankStartedAtDay = 0;
    cadre.assessments.push({ year: 2011, score: 90, tier: '优秀' });
    cadre.assessments.push({ year: 2012, score: 90, tier: '优秀' });
    cadre.restrictions.push({
      id: 'freeze-test',
      type: 'rank_advancement_freeze',
      startedAtDay: 0,
      endsAtDay: null,
      reason: 'test',
      sourceType: 'system',
      sourceId: null,
    });
    const loader = getConfigLoader();
    const result = settleNpcLifecycle({
      organization: state.organization,
      currentDay: 720,
      currentYear: 2013,
      daysPerYear: 360,
      config: loader.getGameConfig().npcLifecycle,
      rankProgressionRules: loader.getAllCivilServiceRankProgressionRules(),
      rng: () => 0.5,
    });

    expect(
      result.organization.cadres.find((item) => item.cadreId === cadre.cadreId)?.civilServiceRank,
    ).toBe('clerk_1');
  });

  it('同一年度共享职数时按 cadreId 稳定顺序只晋升一名 NPC', () => {
    const state = createInitialState();
    const first = state.organization.cadres.find(
      (item) => item.currentAppointment && item.civilServiceRank === 'clerk_1',
    );
    if (!first) throw new Error('Expected assigned clerk_1 NPC');
    first.civilServiceRankStartedAtDay = 0;
    first.assessments.push({ year: 2011, score: 90, tier: '优秀' });
    first.assessments.push({ year: 2012, score: 90, tier: '优秀' });
    const second = structuredClone(first);
    second.cadreId = `${first.cadreId}-z`;
    second.name = `${first.name}（副本）`;
    if (second.currentAppointment) {
      second.currentAppointment = {
        ...second.currentAppointment,
        appointmentId: `${second.currentAppointment.appointmentId}-z`,
      };
    }
    for (const experience of second.experiences) {
      experience.id = `${experience.id}-z`;
      experience.appointmentId = `${experience.appointmentId}-z`;
    }
    state.organization.cadres.push(second);
    const loader = getConfigLoader();
    const config = structuredClone(loader.getGameConfig().npcLifecycle);
    config.rankProgression.maxAdvancementsPerRankPerYear = 1;
    const result = settleNpcLifecycle({
      organization: state.organization,
      currentDay: 1080,
      currentYear: 2014,
      daysPerYear: 360,
      config,
      rankProgressionRules: loader.getAllCivilServiceRankProgressionRules(),
      rng: () => 0.5,
    });

    const changes = result.rankChanges.filter((change) => change.previousRank === 'clerk_1');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.cadreId).toBe(first.cadreId);
    expect(
      result.organization.cadres.find((item) => item.cadreId === second.cadreId)?.civilServiceRank,
    ).toBe('clerk_1');
  });

  it('退休 NPC 先离任，不得抢占同年度仍在职 NPC 的晋升职数', () => {
    const state = createInitialState();
    const candidates = state.organization.cadres.filter(
      (item) => item.currentAppointment && item.civilServiceRank === 'section_member_1',
    );
    const first = candidates.find((item) => item.cadreId === 'cadre_li_mei');
    const second = candidates.find((item) => item.cadreId === 'cadre_qian_yi');
    if (!first || !second) throw new Error('Expected two assigned section_member_1 NPCs');
    first.birthYear = 1978;
    second.birthYear = 1979;
    for (const cadre of [first, second]) {
      cadre.civilServiceRankStartedAtDay = 0;
      cadre.restrictions = [];
      cadre.assessments = Array.from({ length: 9 }, (_, index) => ({
        year: 2034 + index,
        score: 95,
        tier: '优秀',
      }));
    }
    const loader = getConfigLoader();
    const result = settleNpcLifecycle({
      organization: state.organization,
      currentDay: 5400,
      currentYear: 2043,
      daysPerYear: 360,
      config: loader.getGameConfig().npcLifecycle,
      rankProgressionRules: loader.getAllCivilServiceRankProgressionRules(),
      rng: () => 0.5,
    });
    const retired = result.organization.cadres.find((item) => item.cadreId === first.cadreId);
    const remaining = result.organization.cadres.find((item) => item.cadreId === second.cadreId);

    expect(retired).toMatchObject({ status: 'retired', civilServiceRank: 'section_member_1' });
    expect(retired?.assessments).toHaveLength(10);
    expect(result.organization.departures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cadreId: first.cadreId, reason: 'retirement' }),
      ]),
    );
    expect(remaining?.civilServiceRank).toBe('researcher_4');
    expect(
      result.rankChanges.filter((change) => change.previousRank === 'section_member_1'),
    ).toEqual([expect.objectContaining({ cadreId: second.cadreId, currentRank: 'researcher_4' })]);
  });

  it('跨两年时间推进每年只结算一次 NPC 年度事实', () => {
    const first = settle();
    first.organization.processedProducerKeys.push('npc-annual:2012');
    const second = settle({ ...createInitialState(), organization: first.organization }, 720, 2013);

    expect(
      second.organization.cadres.find((item) => item.currentAppointment)?.assessments,
    ).toHaveLength(2);
    expect(second.organization.processedProducerKeys).toEqual(['npc-annual:2012']);
  });

  it('真实 Store 时间轴跨两年各结算一次，并在重复 continuation 中保持 producer 幂等', () => {
    const state = createInitialState();
    state.character.integrity = 100;
    state.character.corruptionRisk = 0;
    state.character.stability = 100;
    state.world.facts.flood_prepared = true;
    state.career.appointment.probation = null;
    const store = createTestStore(state);
    let sequence = 0;
    const nextId = () => `npc-store-${sequence++}`;
    for (let index = 0; index < 24; index += 1) {
      store.dispatch({
        type: 'ADVANCE_TIME',
        granularity: 'month',
        _rng: () => 0.5,
        _idFactory: nextId,
      });
      while (store.getRawState().events.activeBlockingEventId !== null) {
        const blocker = store
          .getRawState()
          .events.pending.find(
            (event) => event.instanceId === store.getRawState().events.activeBlockingEventId,
          );
        if (!blocker) throw new Error('Expected active blocker instance');
        const option = blocker.snapshot.options[0];
        if (!option) throw new Error('Expected a blocker option');
        store.dispatch({
          type: 'CHOOSE_EVENT_OPTION',
          eventInstanceId: blocker.instanceId,
          optionId: option.id,
          _rng: () => 0.5,
          _idFactory: nextId,
        });
        store.dispatch({
          type: 'ADVANCE_TIME',
          granularity: 'day',
          _rng: () => 0.5,
          _idFactory: nextId,
        });
      }
    }
    const afterTwoYears = store.getRawState();
    const activeCadre = afterTwoYears.organization.cadres.find(
      (cadre) => cadre.status === 'active' && cadre.currentAppointment,
    );
    expect(afterTwoYears.organization.processedProducerKeys.length).toBeGreaterThanOrEqual(2);
    expect(activeCadre?.assessments.length).toBeGreaterThanOrEqual(2);
    const beforeRetry = structuredClone(afterTwoYears.organization);
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0.5,
      _idFactory: nextId,
    });
    expect(store.getRawState().organization.departures).toEqual(beforeRetry.departures);
    expect(store.getRawState().organization.processedProducerKeys).toEqual(
      beforeRetry.processedProducerKeys,
    );
  });

  it('真实 Store 年度节点同时结算退休与纪律退出，并持久化两类离任事实', () => {
    const state = createInitialState();
    const retirementCadre = state.organization.cadres.find((cadre) => cadre.currentAppointment);
    const disciplineCadre = state.organization.cadres.find((cadre) => !cadre.currentAppointment);
    if (!retirementCadre || !disciplineCadre)
      throw new Error('Expected assigned and unassigned NPC');
    retirementCadre.birthYear = 1940;
    for (const key of Object.keys(disciplineCadre.specialties))
      disciplineCadre.specialties[key] = -100;
    disciplineCadre.assessments.push({ year: 2011, score: 0, tier: '不称职' });
    const store = createTestStore(state);
    let sequence = 0;
    for (let index = 0; index < 6; index += 1) {
      store.dispatch({
        type: 'ADVANCE_TIME',
        granularity: 'month',
        _rng: () => 0.5,
        _idFactory: () => `npc-departure-${sequence++}`,
      });
    }
    const result = store.getRawState();
    expect(
      result.organization.cadres.find((cadre) => cadre.cadreId === retirementCadre.cadreId),
    ).toMatchObject({
      status: 'retired',
      currentAppointment: null,
    });
    expect(
      result.organization.cadres.find((cadre) => cadre.cadreId === disciplineCadre.cadreId),
    ).toMatchObject({
      status: 'exited',
      currentAppointment: null,
    });
    expect(result.organization.departures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cadreId: retirementCadre.cadreId, reason: 'retirement' }),
        expect.objectContaining({
          cadreId: disciplineCadre.cadreId,
          reason: 'disciplinary_exit',
          seatId: null,
        }),
      ]),
    );
    const restored = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(result)));
    expect(restored.success).toBe(true);
    expect(restored.state?.organization.departures).toEqual(result.organization.departures);
  });
});
