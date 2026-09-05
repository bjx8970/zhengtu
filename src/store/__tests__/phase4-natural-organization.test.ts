/**
 * Phase 4 自然组织世界路径验收（Store 级）。
 *
 * 除注明外全部通过公开 Store action（ADVANCE_TIME / START_PERSONAL_TASK /
 * ACCEPT_CAREER_OPPORTUNITY / ADVANCE_CAREER_PROCESS 等）驱动真实
 * Store/Engine/统一时间轴，不直接 push cadre/vacancy/selection/opportunity
 * 实例，也不直接设置最终资格事实跳过 producer；localStorage 不参与。
 *
 * 已知内容边界（见 docs/PHASE4_ACCEPTANCE.md）：
 * - 配置未提供任何玩家专长 producer 之外的领导岗位机会定义；NPC 年度考核
 *   复利使其考核事实长期高于玩家，因此自然竞争中"更优 NPC 获胜"是当前
 *   配置下的真实自然结果；
 * - 政治周期届期评估只对"空置且无活动空缺"的席位生产 Vacancy，而所有
 *   自然空缺都不会自动关闭，因此测试 C/D 使用真实
 *   cancelVacancyInTransaction 事务（organization_change，代表编制核销）
 *   制造前置状态，其余链路全部为真实管线。
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

function advanceToDay(store: TestStore, targetDay: number, idFactory: () => string): void {
  // 试用期失败等终局节点会让时间轴永久冻结：护栏防止测试空转。
  for (let guard = 0; guard < 4000; guard += 1) {
    if (store.getRawState().time.totalDaysPlayed >= targetDay) break;
    resolveBlockingEvents(store, idFactory);
    const remaining = targetDay - store.getRawState().time.totalDaysPlayed;
    const granularity: Granularity = remaining >= 30 ? 'month' : remaining >= 7 ? 'week' : 'day';
    store.dispatch({ type: 'ADVANCE_TIME', granularity, _rng: () => 0.99, _idFactory: idFactory });
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

/**
 * Phase 3 起沿用的"可审计竞争事实冻结"模式：在 Selection 创建前一次性写入
 * 可复核的考核/专长事实，使玩家基于真实履历获胜的方向可确定性重放。
 * 该步骤不 push 任何 cadre/vacancy/selection/opportunity 实例。
 */
function freezeAuditableCompetitionFacts(store: TestStore): void {
  const state = store.getRawState();
  const experience = state.career.experiences.find((item) => item.endedAtDay === null);
  if (!experience) throw new Error('Expected current career experience');
  experience.assessmentResults = [
    ...experience.assessmentResults,
    { year: state.time.year, score: 100, tier: '优秀' },
  ];
  state.career.specialties = { local_governance: 100 };
  for (const cadre of state.organization.cadres) {
    cadre.assessments = [{ year: state.time.year, score: 0, tier: '不称职' }];
    cadre.specialties = { local_governance: 0 };
    cadre.restrictions = [];
  }
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
    const store = createTestStore();
    newGame(store);
    grassrootsYears(store, 910, idFactory);
    advanceToDay(store, 2879, idFactory);

    // 第一届届期结束：连续衔接下一届，且当前所有空席都已有活动空缺或在职干部
    // （留任），因此届期评估不生产任何政治周期 Vacancy。
    store.dispatch({
      type: 'ADVANCE_TIME',
      granularity: 'day',
      _rng: () => 0.99,
      _idFactory: idFactory,
    });
    const termEnd = store.getRawState();
    expect(termEnd.time.totalDaysPlayed).toBe(2880);
    expect(termEnd.world.activeCycles.map((cycle) => cycle.termNumber)).toEqual([1, 2]);
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
      currentDay: 2880,
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
    advanceToDay(store, 4680, idFactory);
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
  });

  it('政治周期 → 届期评估 → Vacancy → 选拔 → 任职全链经真实管线闭合', () => {
    const idFactory = createIdFactory();
    const store = createTestStore();
    newGame(store);
    grassrootsYears(store, 910, idFactory);
    advanceToDay(store, 960, idFactory);
    // 冻结可审计竞争事实（Phase 3 沿用模式）：让玩家以确定性事实获胜进入副职。
    freezeAuditableCompetitionFacts(store);
    const deputyOpportunity = findDeputyOpportunity(store);
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: deputyOpportunity.id,
      _rng: () => 0,
      _idFactory: idFactory,
    });
    runSelectionRounds(store, deputyOpportunity.id, 6, idFactory);
    expect(store.getRawState().career.appointment).toMatchObject({
      positionId: 'admin_l2_0',
      leadershipRank: 'township_deputy',
    });
    // 玩家晋升后原科员席位经同一级联 producer 开放空缺。
    expect(
      store
        .getRawState()
        .organization.vacancies.find((vacancy) =>
          vacancy.vacancyId.startsWith('vacancy:appointment:'),
        ),
    ).toMatchObject({ seatId: 'seat:admin_l1_0:1', status: 'open' });

    // 副职任内真实治理：防汛行动 + 产业园政策链（镇长机会定义的事件前提）。
    // 事件链按真实日程激活：轮询等待 industrial_park_policy_proposal 进入 pending。
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_2',
      actionId: 'flood_preparation',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    store.dispatch({
      type: 'START_ACTION',
      deptId: 'admin_l2_0_dept_0',
      actionId: 'township_investment_promotion',
      tierKey: 'primary',
      _idFactory: idFactory,
    });
    let policyApproved = false;
    for (let step = 0; step < 40 && !policyApproved; step += 1) {
      resolveBlockingEvents(store, idFactory);
      const proposal = store
        .getRawState()
        .events.pending.find((instance) => instance.eventId === 'industrial_park_policy_proposal');
      if (proposal) {
        store.dispatch({
          type: 'CHOOSE_EVENT_OPTION',
          eventInstanceId: proposal.instanceId,
          optionId: 'submit_proposal',
          _rng: () => 0.99,
          _idFactory: idFactory,
        });
        store.dispatch({
          type: 'PROPOSE_POLICY',
          policyId: 'industrial_park_support',
          _idFactory: idFactory,
        });
        const policy = store
          .getRawState()
          .governance.policies.find((item) => item.policyId === 'industrial_park_support');
        if (!policy) throw new Error('Expected industrial park policy instance');
        store.dispatch({
          type: 'APPROVE_POLICY',
          policyInstanceId: policy.instanceId,
          _rng: () => 0.99,
          _idFactory: idFactory,
        });
        policyApproved = true;
        break;
      }
      advanceToDay(store, store.getRawState().time.totalDaysPlayed + 7, idFactory);
    }
    expect(policyApproved).toBe(true);
    // 政策进入实施阶段时 crisis 事件自然触发（preparation→implementation 转换）。
    let crisisFired = false;
    for (let step = 0; step < 30 && !crisisFired; step += 1) {
      advanceToDay(store, store.getRawState().time.totalDaysPlayed + 7, idFactory);
      crisisFired = store
        .getRawState()
        .events.history.some((record) => record.eventId === 'industrial_park_progress_crisis');
    }
    const governed = store.getRawState();
    const governedEventIds = new Set(governed.events.history.map((record) => record.eventId));
    expect(governedEventIds.has('flood_preparation_metrics')).toBe(true);
    expect(crisisFired).toBe(true);

    // 副职任内持续履职：让两次年度考核自然合格，解锁镇长机会。
    while (store.getRawState().time.totalDaysPlayed < 1700) {
      const weekStart = store.getRawState().time.totalDaysPlayed;
      store.dispatch({
        type: 'START_ACTION',
        deptId: 'admin_l2_0_dept_0',
        actionId: 'township_priority_delivery',
        tierKey: 'primary',
        _idFactory: idFactory,
      });
      store.dispatch({
        type: 'START_ACTION',
        deptId: 'admin_l2_0_dept_1',
        actionId: 'tax_collection',
        tierKey: 'secondary',
        _idFactory: idFactory,
      });
      advanceToDay(store, Math.min(weekStart + 7, 1700), idFactory);
    }

    // 等镇长机会自然出现（两次副职年度考核合格后），随后核销镇长编制：
    // 关联机会经真实信号管线失效，而不是绕过 producer。
    advanceToDay(store, 1700, idFactory);
    const beforeCancel = store.getRawState();
    const chiefOpportunity = beforeCancel.career.opportunities.find(
      (item) => item.definitionId === 'township_chief_leadership_vacancy',
    );
    expect(chiefOpportunity ?? null).not.toBeNull();
    const cancelled = cancelVacancyInTransaction(beforeCancel, {
      vacancyId: 'vacancy:initial:seat:admin_l3_0:1',
      cancellationReason: 'organization_change',
      currentDay: beforeCancel.time.totalDaysPlayed,
      idFactory,
    });
    expect(cancelled.success).toBe(true);
    expect(
      store
        .getRawState()
        .career.opportunities.find(
          (item) => item.id === chiefOpportunity?.id && item.status === 'available',
        ) ?? null,
    ).toBeNull();
    expect(
      store
        .getRawState()
        .career.opportunities.find(
          (item) => item.id === chiefOpportunity?.id && item.status === 'available',
        ) ?? null,
    ).toBeNull();

    // 第一届届期结束：政治周期在被核销的镇长席位上真实开放 Vacancy，
    // 并经信号级联重新派发镇长机会（新来源）。
    advanceToDay(store, 2880, idFactory);
    const termEnd = store.getRawState();
    const cycleVacancy = termEnd.organization.vacancies.find((vacancy) =>
      vacancy.vacancyId.startsWith('vacancy:political_cycle:party_congress:1:'),
    );
    expect(cycleVacancy).toMatchObject({ seatId: 'seat:admin_l3_0:1', status: 'open' });
    const chiefFromCycle = termEnd.career.opportunities.find(
      (item) =>
        item.definitionId === 'township_chief_leadership_vacancy' &&
        item.vacancyId === cycleVacancy?.vacancyId,
    );
    if (!chiefFromCycle || chiefFromCycle.status !== 'available')
      throw new Error('Expected chief opportunity from political cycle vacancy');

    const seatOccupantBeforeChief = new Map(
      store
        .getRawState()
        .organization.seats.filter((seat) => seat.occupant?.type === 'npc')
        .map((seat) => [seat.occupant?.id ?? '', seat.seatId]),
    );
    store.dispatch({
      type: 'ACCEPT_CAREER_OPPORTUNITY',
      opportunityId: chiefFromCycle.id,
      _rng: () => 0,
      _idFactory: idFactory,
    });
    runSelectionRounds(store, chiefFromCycle.id, 6, idFactory);
    const after = store.getRawState();
    const chiefSelection = after.organization.selections.at(-1);
    expect(chiefSelection?.status).toBe('completed');
    const winnerId = chiefSelection?.winnerId;
    expect(winnerId).toBeTruthy();
    // 周期岗位 Vacancy 消费为真实任职：赢家唯一并落位镇长席位。
    expect(
      after.organization.vacancies.find((vacancy) => vacancy.vacancyId === cycleVacancy?.vacancyId),
    ).toMatchObject({ status: 'filled', filledBy: winnerId ? { id: winnerId } : null });
    expect(seatOccupant(after, 'seat:admin_l3_0:1')).toBe(
      winnerId === 'player' ? 'player:player' : `npc:${winnerId}`,
    );
    // 赢家原岗位经同一级联 producer 释放新空缺（组织流动可级联）。
    if (winnerId && winnerId !== 'player') {
      const winnerPreviousSeatId = seatOccupantBeforeChief.get(winnerId);
      if (winnerPreviousSeatId) {
        expect(seatOccupant(after, winnerPreviousSeatId)).toBe('empty');
        expect(
          after.organization.vacancies.some(
            (vacancy) =>
              vacancy.status === 'open' &&
              vacancy.seatId === winnerPreviousSeatId &&
              vacancy.vacancyId.startsWith('vacancy:appointment:'),
          ),
        ).toBe(true);
      }
    } else {
      // 玩家获任镇长：原副职席位经同一级联 producer 释放新空缺。
      expect(winnerId).toBe('player');
      expect(seatOccupant(after, 'seat:admin_l2_0:1')).toBe('empty');
      expect(
        after.organization.vacancies.some(
          (vacancy) =>
            vacancy.status === 'open' &&
            vacancy.seatId === 'seat:admin_l2_0:1' &&
            vacancy.vacancyId.startsWith('vacancy:appointment:'),
        ),
      ).toBe(true);
      expect(after.career.appointment).toMatchObject({
        positionId: 'admin_l3_0',
        leadershipRank: 'township_chief',
      });
    }
    expect(after.world.activeCycles[0]).toMatchObject({ termNumber: 1, phase: 'evaluation' });
  });
});
