/** NPC 年度生命周期 Engine 与时间轴接入测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../../config/loader';
import { createInitialState } from '../../../store/game-store';
import { settleNpcLifecycle } from '../npc-lifecycle';

function settle(state = createInitialState(), currentDay = 360, currentYear = 2012) {
  const loader = getConfigLoader();
  let sequence = 0;
  return settleNpcLifecycle({
    organization: state.organization,
    currentDay,
    currentYear,
    daysPerYear: 360,
    config: loader.getGameConfig().npcLifecycle,
    rankProgressionRules: loader.getAllCivilServiceRankProgressionRules(),
    rng: () => 0.5,
    idFactory: () => `npc-test-${sequence++}`,
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
    expect(result.signals.some((signal) => signal.signalType === 'assessment.completed')).toBe(
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
});
