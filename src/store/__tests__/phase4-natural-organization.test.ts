/**
 * Phase 4 自然组织世界路径验收（Store 级）。
 *
 * 除注明外全部通过公开 Store action（ADVANCE_TIME / START_PERSONAL_TASK /
 * ACCEPT_CAREER_OPPORTUNITY / ADVANCE_CAREER_PROCESS 等）驱动真实
 * Store/Engine/统一时间轴，不直接 push cadre/vacancy/selection/opportunity
 * 实例，也不直接设置最终资格事实跳过 producer；localStorage 不参与。
 *
 * 自然结果边界（见 docs/PHASE4_ACCEPTANCE.md）：
 * - NPC 年度考核按配置复利累积（早期即 90+ 且高于玩家年度考核均值），
 *   因此玩家在首次副职竞争中自然落选、NPC 获胜是当前配置下的真实结果；
 * - 玩家继续基层历练积累专长后可在后续真实空缺中凭真实履历反超获胜；
 * - 政治周期届期评估只对"空置且无活动空缺"的席位生产 Vacancy，而所有
 *   自然空缺都不会自动关闭，因此测试使用真实 cancelVacancyInTransaction
 *   事务（organization_change，代表编制核销）制造前置状态，其余链路
 *   （届期评估 → producer → NPC 自主补员 → 机会 → 选拔 → 任职）全部为
 *   真实管线。
 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../../config/loader';
import type { GameAction } from '../../types/game';
import { cancelVacancyInTransaction } from '../transactions/vacancy-transaction';
import { createTestStore } from '../game-store';
import { decodeCurrentSave, wrapSaveEnvelope } from '../save-codec';

type TestStore = ReturnType<typeof createTestStore>;
type Granularity = Extract<GameAction, { type: 'ADVANCE_TIME' }>['granularity'];

function createIdFactory(): () => string {
  let nextId = 0;
  return () => `phase4-natural-${nextId++}`;
}

function resolveBlockingEvents(store: TestStore, idFactory: () => string): void {
  const loader = getConfigLoader();
  for (let guard = 0; guard < 50 && store.getRawState().events.activeBlockingEventId; guard += 1) {
    const state = store.getRawState();
    const instance = state.events.pending.find(
      (item) => item.instanceId === state.events.activeBlockingEventId,
    );
    if (!instance) throw new Error('Active blocking event is missing from pending events');
    const definition = loader.getEventDefinition(instance.eventId);
    const option = definition?.options[0];
    if (!option) throw new Error(`Blocking event ${instance.eventId} has no playable option`);
    store.dispatch({
      type: 'CHOOSE_EVENT_OPTION',
      eventInstanceId: instance.instanceId,
      optionId: option.id,
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
  }
}

/**
 * 确定性变化随机序列：NPC 年度考核偏移与 NPC 自主补员的随机项需要
 * 候选间彼此不同（否则并列），同时保持整场可重放。
 */
function createSequenceRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function advanceToDay(
  store: TestStore,
  targetDay: number,
  idFactory: () => string,
  rng: () => number = () => 0.99,
): void {
  // 试用期失败等终局节点会让时间轴永久冻结：护栏防止测试空转。
  for (let guard = 0; guard < 4000; guard += 1) {
    if (store.getRawState().time.totalDaysPlayed >= targetDay) break;
    resolveBlockingEvents(store, idFactory);
    const remaining = targetDay - store.getRawState().time.totalDaysPlayed;
    const granularity: Granularity = remaining >= 30 ? 'month' : remaining >= 7 ? 'week' : 'day';
    store.dispatch({ type: 'ADVANCE_TIME', granularity, _rng: rng, _idFactory: idFactory });
  }
  if (store.getRawState().time.totalDaysPlayed < targetDay)
    throw new Error(
      `Timeline stalled at day ${store.getRawState().time.totalDaysPlayed} before target ${targetDay}`,
    );
  // 目标日内可能留下未完成的 continuation 节点：继续消费直到当日结算完整。
  for (let guard = 0; guard < 50 && store.getRawState().time.pendingContinuation; guard += 1) {
    resolveBlockingEvents(store, idFactory);
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
  }
  if (store.getRawState().time.pendingContinuation)
    throw new Error('Continuation did not settle after 50 attempts');
  resolveBlockingEvents(store, idFactory);
}

function newGame(store: TestStore): void {
  store.dispatch({
    type: 'NEW_GAME',
    data: {
      characterName: '组织世界验收员',
      familyBackground: 'peasant',
      promotionPath: 'gongwuyuan',
    },
  });
}

/** 在 id 附近执行一次个人任务；被前置/冷却/槽位拒绝时静默跳过（与真实 UI 行为一致）。 */
function startTask(
  store: TestStore,
  taskId: string,
  tierKey: 'primary' | 'secondary' | 'reserve',
  idFactory: () => string,
): void {
  store.dispatch({ type: 'START_PERSONAL_TASK', taskId, tierKey, _idFactory: idFactory });
}

/**
 * 自然基层历练：常规任务热身 → 上级交办专项 → 长期驻村/走访轮转，
 * 并在满足 360 天任职要求后走职级晋升通道（clerk_2 → clerk_1）。
 */
function grassrootsYears(store: TestStore, targetDay: number, idFactory: () => string): void {
  advanceToDay(store, 60, idFactory);
  for (const [index, taskId] of [
    'task_window_duty',
    'task_policy_brief',
    'task_monthly_report',
  ].entries()) {
    startTask(store, taskId, index === 0 ? 'primary' : 'secondary', idFactory);
  }
  advanceToDay(store, 68, idFactory);
  startTask(store, 'task_assigned_special', 'primary', idFactory);
  const rotation = ['task_village_research', 'task_poverty_visit', 'task_agri_walk'] as const;
  while (store.getRawState().time.totalDaysPlayed < targetDay) {
    for (const [index, taskId] of rotation.entries()) {
      startTask(store, taskId, index === 0 ? 'primary' : 'secondary', idFactory);
    }
    const day = store.getRawState().time.totalDaysPlayed;
    advanceToDay(store, Math.min(day + 7, targetDay), idFactory);
    if (day >= 540 && store.getRawState().career.civilServiceRank === 'clerk_2') {
      store.dispatch({ type: 'ADVANCE_CIVIL_SERVICE_RANK', _idFactory: idFactory });
    }
  }
}

function findDeputyOpportunity(store: TestStore): { id: string; expiresAtDay: number | null } {
  const opportunity = store
    .getRawState()
    .career.opportunities.find(
      (item) => item.definitionId === 'township_deputy_leadership_vacancy',
    );
  if (!opportunity || opportunity.status !== 'available')
    throw new Error('Expected an available township deputy opportunity');
  return { id: opportunity.id, expiresAtDay: opportunity.expiresAtDay };
}

function runSelectionRounds(
  store: TestStore,
  opportunityId: string,
  rounds: number,
  idFactory: () => string,
): void {
  for (let round = 0; round < rounds; round++)
    store.dispatch({
      type: 'ADVANCE_CAREER_PROCESS',
      opportunityId,
      _rng: () => 0,
      _idFactory: idFactory,
    });
}

function seatOccupant(state: ReturnType<TestStore['getRawState']>, seatId: string): string {
  const seat = state.organization.seats.find((item) => item.seatId === seatId);
  if (!seat) throw new Error(`Expected seat ${seatId}`);
  return seat.occupant ? `${seat.occupant.type}:${seat.occupant.id}` : 'empty';
}

describe('Phase 4 自然组织世界路径', () => {
  it('无玩家操作时 NPC 世界自行演进且不产生伪空缺', () => {
    const idFactory = createIdFactory();
    const store = createTestStore();
    newGame(store);
    const initialVacancyIds = store
      .getRawState()
      .organization.vacancies.map((vacancy) => vacancy.vacancyId)
      .sort();

    // 玩家只完成入职培训（否则试用期终局会冻结时间轴），此后只推进时间。
    startTask(store, 'task_induction_training', 'primary', idFactory);
    advanceToDay(store, 90, idFactory);
    advanceToDay(store, 1120, idFactory);
    const state = store.getRawState();

    // NPC 年度考核事实持续产生：干部世界不是静态的。
    const luoXia = state.organization.cadres.find((cadre) => cadre.cadreId === 'cadre_luo_xia');
    if (!luoXia) throw new Error('Expected NPC cadre_luo_xia');
    expect(luoXia.assessments.length).toBeGreaterThanOrEqual(1);
    expect(state.assessments.annualAssessments.length).toBeGreaterThanOrEqual(1);

    // 首届政治周期在 2015 年 Congress 节点创建并按日推进阶段。
    // 开局月份为 7 月：2015 年从第 900 天开始（900/180/0 为 2013/2014/2015 年初），
    // 因此 Congress 节点落在第 900 天，第 1120 天处于 implementation 阶段。
    expect(state.world.activeCycles[0]).toMatchObject({
      type: 'party_congress',
      termNumber: 1,
      startedAtDay: 900,
      phase: 'implementation',
    });

    // 没有干部离任，也没有测试外的 Vacancy producer 触发：空缺集合保持初始事实。
    expect(state.organization.departures).toEqual([]);
    expect(state.organization.vacancies.map((vacancy) => vacancy.vacancyId).sort()).toEqual(
      initialVacancyIds,
    );
    for (const vacancy of state.organization.vacancies) expect(vacancy.status).toBe('open');

    // 空置席位与 Vacancy 一一对应；在届干部没有产生任何政治周期伪空缺。
    const producerKeys = state.organization.processedProducerKeys;
    expect(producerKeys.some((key) => key.startsWith('vacancy:political_cycle'))).toBe(false);
    for (const seat of state.organization.seats) {
      const activeVacancy = state.organization.vacancies.some(
        (vacancy) =>
          vacancy.seatId === seat.seatId &&
          (vacancy.status === 'open' || vacancy.status === 'selecting'),
      );
      expect(activeVacancy || seat.occupant !== null).toBe(true);
    }
  });

  it('自然副职竞争：更优 NPC 击败玩家、真实任职并级联旧岗位空缺', () => {
    const idFactory = createIdFactory();
    const store = createTestStore();
    newGame(store);
    grassrootsYears(store, 910, idFactory);
    // 等待在途任务完成，避免 running_work 拒绝接受。
    advanceToDay(store, 960, idFactory);

    const state = store.getRawState();
    const localGovernance = state.career.specialties.local_governance ?? 0;
    expect(localGovernance).toBeGreaterThanOrEqual(60);
    const opportunity = findDeputyOpportunity(store);

    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: opportunity.id,
      _rng: () => 0.5,
      _idFactory: idFactory,
    });
    const selection = store.getRawState().organization.selections.at(-1);
    if (!selection) throw new Error('Expected a frozen Selection');
    // 配置修复后玩家与 NPC 进入同一候选池：真实双人竞争。
    expect(selection.candidates.map((candidate) => candidate.candidateType).sort()).toEqual([
      'npc',
      'player',
    ]);
    expect(selection.status).toBe('active');

    // 中途刷新/解码重放：候选快照与已结算阶段不漂移。
    runSelectionRounds(store, opportunity.id, 3, idFactory);
    const midSelection = structuredClone(store.getRawState().organization.selections.at(-1));
    if (!midSelection) throw new Error('Expected mid-selection');
    const decoded = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(store.getRawState())));
    expect(decoded.success).toBe(true);
    if (!decoded.state) throw new Error('Expected decoded save');
    const resumed = createTestStore(decoded.state);
    runSelectionRounds(resumed, opportunity.id, 3, idFactory);
    runSelectionRounds(store, opportunity.id, 3, idFactory);

    const finalSelection = store.getRawState().organization.selections.at(-1);
    const resumedSelection = resumed.getRawState().organization.selections.at(-1);
    expect(finalSelection?.status).toBe('completed');
    expect(finalSelection?.winnerId).toBe(resumedSelection?.winnerId);
    // 当前配置下 NPC 年度考核复利高于玩家：更优 NPC 正常获胜。
    expect(finalSelection?.winner).toMatchObject({ type: 'npc', id: 'cadre_luo_xia' });

    const after = store.getRawState();
    // NPC 真实任职改变组织状态；玩家落选后原任职保持不变。
    expect(seatOccupant(after, 'seat:admin_l2_0:1')).toBe('npc:cadre_luo_xia');
    expect(seatOccupant(after, 'seat:admin_l1_0:1')).toBe('player:player');
    expect(after.career.appointment).toMatchObject({
      positionId: 'admin_l1_0',
      leadershipRank: 'none',
    });
    const deputyVacancy = after.organization.vacancies.find(
      (vacancy) => vacancy.vacancyId === 'vacancy:initial:seat:admin_l2_0:1',
    );
    expect(deputyVacancy).toMatchObject({
      status: 'filled',
      filledBy: { type: 'npc', id: 'cadre_luo_xia' },
    });
    // 玩家 CareerProcess 与世界级 Selection 不产生双重结算。
    expect(after.career.activeProcess).toBeNull();
    expect(after.career.completedProcesses.at(-1)).toMatchObject({
      status: 'completed',
      winnerId: 'cadre_luo_xia',
      selectionId: finalSelection?.selectionId,
    });

    // NPC 原岗位进入同一组织 Vacancy 机制：真实级联 producer。
    const cascadeVacancy = after.organization.vacancies.find((vacancy) =>
      vacancy.vacancyId.startsWith('vacancy:appointment:npc-appointment:cadre_luo_xia:0'),
    );
    expect(cascadeVacancy).toMatchObject({
      status: 'open',
      seatId: 'seat:admin_l1_2:1',
      sourceType: 'appointment',
    });
    expect(seatOccupant(after, 'seat:admin_l1_2:1')).toBe('empty');
    // 玩家落选不等于 Vacancy 自动关闭：世界仅有一个新空缺来自级联。
    const openVacancyIds = after.organization.vacancies
      .filter((vacancy) => vacancy.status === 'open')
      .map((vacancy) => vacancy.vacancyId);
    expect(openVacancyIds).toEqual([
      'vacancy:initial:seat:admin_l3_0:1',
      expect.stringMatching(/^vacancy:appointment:npc-appointment:cadre_luo_xia:0/),
    ]);
  });

  it('政治周期届期评估：留任不制造伪空缺，编制核销后真实释放岗位', () => {
    const idFactory = createIdFactory();
    const rng = createSequenceRng(7);
    const store = createTestStore();
    newGame(store);
    grassrootsYears(store, 910, idFactory);
    // 第一届届期为 [900, 2700]：届期结束当天连续衔接下一届，且当前所有空席
    // 都已有活动空缺或在职干部（留任），届期评估不生产任何政治周期 Vacancy。
    advanceToDay(store, 2700, idFactory, rng);
    const termEnd = store.getRawState();
    expect(termEnd.time.totalDaysPlayed).toBe(2700);
    expect(termEnd.world.activeCycles.map((cycle) => cycle.termNumber)).toEqual([1, 2]);
    expect(termEnd.world.activeCycles[0]).toMatchObject({ startedAtDay: 900, endsAtDay: 2700 });
    expect(termEnd.organization.processedProducerKeys).toContain(
      'political-cycle:party_congress:1',
    );
    expect(
      termEnd.organization.vacancies.filter((vacancy) => vacancy.sourceType === 'political_cycle'),
    ).toEqual([]);

    // 编制核销（真实取消事务，含信号级联）：镇长岗位空缺被组织撤销后，
    // 该席位进入"空置且无活动空缺"状态。
    const chiefVacancyId = 'vacancy:initial:seat:admin_l3_0:1';
    const cancelled = cancelVacancyInTransaction(store.getRawState(), {
      vacancyId: chiefVacancyId,
      cancellationReason: 'organization_change',
      currentDay: 2700,
      idFactory,
    });
    // cancelVacancyInTransaction 通过事务副本原子提交并写回 Store 状态。
    expect(cancelled.success).toBe(true);
    expect(
      store
        .getRawState()
        .organization.vacancies.find((vacancy) => vacancy.vacancyId === chiefVacancyId),
    ).toMatchObject({ status: 'cancelled', cancellationReason: 'organization_change' });

    // 第二届届期结束：政治周期 producer 在被核销席位上真实开放 Vacancy。
    advanceToDay(store, 4500, idFactory, rng);
    const secondTermEnd = store.getRawState();
    expect(secondTermEnd.organization.processedProducerKeys).toContain(
      'political-cycle:party_congress:2',
    );
    const cycleVacancy = secondTermEnd.organization.vacancies.find((vacancy) =>
      vacancy.vacancyId.startsWith('vacancy:political_cycle:party_congress:2:'),
    );
    expect(cycleVacancy).toMatchObject({
      seatId: 'seat:admin_l3_0:1',
      status: 'open',
      sourceType: 'political_cycle',
      reason: 'political_cycle',
    });
    // 玩家仍为科员：镇长机会定义条件未满足，信号管线诚实拦截，不凭空派发机会。
    expect(
      secondTermEnd.career.opportunities.filter(
        (opportunity) => opportunity.definitionId === 'township_chief_leadership_vacancy',
      ),
    ).toEqual([]);

    // 补员延迟（30 天）届满：组织以 NPC-only 相对选拔自主填补周期空缺，
    // 全程未 dispatch 任何机会接受/选拔推进 action，只有时间推进。
    const seatsBeforeStaffing = new Map(
      secondTermEnd.organization.seats
        .filter((seat) => seat.occupant?.type === 'npc')
        .map((seat) => [seat.occupant?.id ?? '', seat.seatId]),
    );
    advanceToDay(store, 4560, idFactory, rng);
    const staffed = store.getRawState();
    expect(
      staffed.organization.vacancies.find(
        (vacancy) => vacancy.vacancyId === cycleVacancy?.vacancyId,
      ),
    ).toMatchObject({ status: 'filled', filledBy: { type: 'npc' } });
    const staffingSelection = staffed.organization.selections.find(
      (selection) => selection.vacancyId === cycleVacancy?.vacancyId,
    );
    expect(staffingSelection?.status).toBe('completed');
    const staffingWinnerId = staffingSelection?.winnerId;
    expect(staffingWinnerId ?? null).not.toBeNull();
    expect(staffingWinnerId === 'player').toBe(false);
    expect(
      staffingSelection?.candidates.every((candidate) => candidate.candidateType === 'npc'),
    ).toBe(true);
    expect(seatOccupant(staffed, 'seat:admin_l3_0:1')).toBe(`npc:${staffingWinnerId}`);
    const staffingWinnerPreviousSeat = seatsBeforeStaffing.get(staffingWinnerId ?? '');
    expect(staffingWinnerPreviousSeat ?? null).not.toBeNull();
    expect(seatOccupant(staffed, staffingWinnerPreviousSeat ?? '')).toBe('empty');
    expect(
      staffed.organization.vacancies.some(
        (vacancy) =>
          vacancy.status === 'open' &&
          vacancy.seatId === staffingWinnerPreviousSeat &&
          vacancy.vacancyId.startsWith('vacancy:appointment:'),
      ),
    ).toBe(true);
    // 级联产生的平行副职空缺向玩家派发真实机会（玩家可再次进入候选池）。
    const cascadedOpportunity = staffed.career.opportunities.find(
      (opportunity) =>
        opportunity.vacancyId?.startsWith('vacancy:appointment:') &&
        opportunity.status === 'available',
    );
    expect(cascadedOpportunity ?? null).not.toBeNull();
  });

  it('自然纵向路径：首次落选 → 持续历练 → 政治周期补员级联 → 凭真实履历再获任', () => {
    const idFactory = createIdFactory();
    const rng = createSequenceRng(11);
    const store = createTestStore();
    newGame(store);
    grassrootsYears(store, 910, idFactory);
    advanceToDay(store, 960, idFactory, rng);

    // 首次真实副职竞争：当前配置下 NPC 年度考核复利更高，玩家自然落选，
    // NPC 获任并经级联 producer 释放原岗位空缺。
    const firstOpportunity = findDeputyOpportunity(store);
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: firstOpportunity.id,
      _rng: () => 0,
      _idFactory: idFactory,
    });
    runSelectionRounds(store, firstOpportunity.id, 6, idFactory);
    const firstSelection = store.getRawState().organization.selections.at(-1);
    expect(firstSelection?.status).toBe('completed');
    expect(firstSelection?.winnerId).toBe('cadre_luo_xia');
    expect(seatOccupant(store.getRawState(), 'seat:admin_l2_0:1')).toBe('npc:cadre_luo_xia');
    expect(store.getRawState().career.appointment).toMatchObject({
      positionId: 'admin_l1_0',
      leadershipRank: 'none',
    });

    // 玩家不放弃：继续基层历练，专长与考核由真实任务/年度结算持续积累。
    grassrootsYears(store, 1250, idFactory);
    const lateState = store.getRawState();
    expect(lateState.career.specialties.local_governance ?? 0).toBeGreaterThan(100);

    // 核销镇长初始编制（真实取消事务）：为政治周期届期评估释放席位。
    const cancelled = cancelVacancyInTransaction(store.getRawState(), {
      vacancyId: 'vacancy:initial:seat:admin_l3_0:1',
      cancellationReason: 'organization_change',
      currentDay: store.getRawState().time.totalDaysPlayed,
      idFactory,
    });
    expect(cancelled.success).toBe(true);

    // 第一届届期结束：政治周期在被核销席位上真实开放镇长空缺；
    // 玩家仍为科员，信号管线不派发镇长机会。
    advanceToDay(store, 2700, idFactory, rng);
    const termEnd = store.getRawState();
    const cycleVacancy = termEnd.organization.vacancies.find((vacancy) =>
      vacancy.vacancyId.startsWith('vacancy:political_cycle:party_congress:1:'),
    );
    expect(cycleVacancy).toMatchObject({
      seatId: 'seat:admin_l3_0:1',
      status: 'open',
      sourceType: 'political_cycle',
    });
    expect(
      termEnd.career.opportunities.filter(
        (opportunity) => opportunity.vacancyId === cycleVacancy?.vacancyId,
      ),
    ).toEqual([]);

    // 补员延迟届满：NPC-only 相对选拔自主填补镇长岗位并级联旧岗位——
    // 此段全程只推进时间，没有任何机会接受/选拔推进 action。
    const seatsBeforeStaffing = new Map(
      termEnd.organization.seats
        .filter((seat) => seat.occupant?.type === 'npc')
        .map((seat) => [seat.occupant?.id ?? '', seat.seatId]),
    );
    advanceToDay(store, 2760, idFactory, rng);
    const staffed = store.getRawState();
    expect(
      staffed.organization.vacancies.find(
        (vacancy) => vacancy.vacancyId === cycleVacancy?.vacancyId,
      ),
    ).toMatchObject({ status: 'filled', filledBy: { type: 'npc' } });
    const staffingSelection = staffed.organization.selections.find(
      (selection) => selection.vacancyId === cycleVacancy?.vacancyId,
    );
    expect(staffingSelection?.status).toBe('completed');
    const staffingWinnerId = staffingSelection?.winnerId;
    expect(staffingWinnerId ?? null).not.toBeNull();
    expect(staffingWinnerId === 'player').toBe(false);
    expect(
      staffingSelection?.candidates.every((candidate) => candidate.candidateType === 'npc'),
    ).toBe(true);
    expect(seatOccupant(staffed, 'seat:admin_l3_0:1')).toBe(`npc:${staffingWinnerId}`);
    const staffingWinnerPreviousSeat = seatsBeforeStaffing.get(staffingWinnerId ?? '');
    expect(staffingWinnerPreviousSeat ?? null).not.toBeNull();
    expect(seatOccupant(staffed, staffingWinnerPreviousSeat ?? '')).toBe('empty');
    const cascadeVacancy = staffed.organization.vacancies.find(
      (vacancy) =>
        vacancy.status === 'open' &&
        vacancy.seatId === staffingWinnerPreviousSeat &&
        vacancy.vacancyId.startsWith('vacancy:appointment:'),
    );
    expect(cascadeVacancy ?? null).not.toBeNull();

    // 级联副职空缺向玩家派发真实机会：玩家再次进入同一相对选拔候选池，
    // 凭持续积累的真实专长/考核履历自然获胜并任职。
    const secondOpportunity = staffed.career.opportunities.find(
      (opportunity) =>
        opportunity.vacancyId === cascadeVacancy?.vacancyId && opportunity.status === 'available',
    );
    if (!secondOpportunity) throw new Error('Expected player opportunity from cascade vacancy');
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: secondOpportunity.id,
      _rng: () => 0,
      _idFactory: idFactory,
    });
    runSelectionRounds(store, secondOpportunity.id, 6, idFactory);
    const after = store.getRawState();
    const secondSelection = after.organization.selections.find(
      (selection) => selection.vacancyId === cascadeVacancy?.vacancyId,
    );
    expect(secondSelection?.status).toBe('completed');
    expect(secondSelection?.winnerId).toBe('player');
    expect(after.career.appointment).toMatchObject({
      positionId: cascadeVacancy?.positionId,
      leadershipRank: 'township_deputy',
    });
    expect(
      after.career.opportunities.find((item) => item.id === secondOpportunity.id),
    ).toMatchObject({
      status: 'resolved',
      finalOutcome: 'appointed',
    });
    // 玩家原科员席位经同一级联 producer 释放新空缺（组织流动继续级联）。
    expect(seatOccupant(after, 'seat:admin_l1_0:1')).toBe('empty');
    expect(
      after.organization.vacancies.some(
        (vacancy) =>
          vacancy.status === 'open' &&
          vacancy.seatId === 'seat:admin_l1_0:1' &&
          vacancy.vacancyId.startsWith('vacancy:appointment:'),
      ),
    ).toBe(true);
    expect(after.career.experiences.filter((item) => item.endedAtDay === null)).toHaveLength(1);
  });
});
