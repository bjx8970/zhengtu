/**
 * Browser acceptance coverage for the playable Phase 2/3 vertical slice.
 *
 * Saves only accelerate to legal pre-trigger states. Opportunities, policy
 * facts, blocking events and delayed follow-ups must be produced by UI actions
 * and the production time pipeline under test.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonValue = boolean | number | string | null | JsonRecord | JsonValue[];

interface JsonRecord {
  [key: string]: JsonValue;
}

interface PositionFixture {
  id: string;
  name: string;
  institutionId: string;
  regionId: string;
  institutionLevel: string;
  positionDomain: string;
  leadershipRank: string;
  departmentTemplateIds: string[];
  annualBudget: number;
}

interface InstitutionFixture {
  id: string;
  name: string;
  level: string;
  regionId: string;
}

interface KpiFixture {
  targetValue: number;
  calcType: 'absolute' | 'inverse' | 'ratio';
}

const positions = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/config/positions/positions.json'), 'utf8'),
) as PositionFixture[];
const institutions = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/config/institutions/institutions.json'), 'utf8'),
) as Record<string, InstitutionFixture>;
const kpiTemplates = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/config/templates/kpis.json'), 'utf8'),
) as Record<string, KpiFixture>;

function asRecord(value: JsonValue | undefined, name: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Expected ${name} to be a record`);
  return value;
}

function asRecords(value: JsonValue | undefined, name: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} to be an array`);
  return value.map((item, index) => asRecord(item, `${name}[${index}]`));
}

function position(id: string): PositionFixture {
  const target = positions.find((item) => item.id === id);
  if (!target) throw new Error(`Missing position definition: ${id}`);
  return target;
}

function seedPlayerOrganizationSeat(
  state: JsonRecord,
  target: PositionFixture,
  appointment: JsonRecord,
): void {
  const organization = asRecord(state.organization, 'organization');
  const seats = asRecords(organization.seats, 'organization seats');
  const playerSeats = seats.filter((seat) => {
    const occupant = seat.occupant;
    return (
      occupant !== null &&
      typeof occupant === 'object' &&
      !Array.isArray(occupant) &&
      occupant.type === 'player'
    );
  });
  if (playerSeats.length !== 1) throw new Error('Expected exactly one initialized player seat');
  const previousSeat = playerSeats[0];
  if (!previousSeat) throw new Error('Expected initialized player seat');
  Object.assign(previousSeat, {
    occupant: null,
    currentAppointmentId: null,
    occupiedAtDay: null,
    sourceTransitionId: String(appointment.appointmentId),
  });

  const institution = institutions[target.institutionId];
  if (!institution) throw new Error(`Missing institution definition: ${target.institutionId}`);
  let targetSeat = seats.find((seat) => seat.positionId === target.id);
  if (!targetSeat) {
    targetSeat = {
      seatId: `seat:${target.id}:1`,
      positionId: target.id,
      positionNameSnapshot: target.name,
      institutionId: target.institutionId,
      institutionNameSnapshot: institution.name,
      regionId: target.regionId,
      institutionLevel: target.institutionLevel,
      positionDomain: target.positionDomain,
      leadershipRank: target.leadershipRank,
      occupant: null,
      currentAppointmentId: null,
      occupiedAtDay: null,
      sourceTransitionId: null,
    };
    seats.push(targetSeat);
  }
  if (targetSeat.occupant !== null)
    throw new Error(`Expected target organization seat ${target.id} to be vacant`);
  if (typeof appointment.appointmentId !== 'string')
    throw new Error('Expected stable player appointment ID');
  if (typeof appointment.startedAtDay !== 'number')
    throw new Error('Expected player appointment start day');
  Object.assign(targetSeat, {
    occupant: { type: 'player', id: 'player' },
    currentAppointmentId: appointment.appointmentId,
    occupiedAtDay: appointment.startedAtDay,
    sourceTransitionId: appointment.appointmentId,
  });
  organization.seats = seats;
}

async function createCharacter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByTestId('character-name').fill('测试干部');
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="birthplace-province-"]').first().click();
  await page.locator('[data-testid^="birthplace-city-"]').first().click();
  await page.getByTestId('character-next').click();
  await page.getByTestId('generate-gaokao-score').click();
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="university-tier-"]').first().click();
  await page
    .locator('[data-testid^="university-"]:not([data-testid^="university-tier-"])')
    .first()
    .click();
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="family-background-"]').first().click();
  await page.locator('[data-testid^="promotion-path-"]').first().click();
  await page.getByTestId('character-next').click();
  await page.locator('[data-testid^="career-line-"]:not([disabled])').click();
  await page.getByTestId('character-complete').click();
  await expect(page).toHaveURL(/#\/main$/);
}

async function changeSave(page: Page, change: (state: JsonRecord) => void): Promise<void> {
  const envelope = await page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected character creation to write a local save');
    return JSON.parse(raw) as JsonRecord;
  });
  const state = asRecord(envelope.state, 'save state');
  change(state);
  const serializedEnvelope = JSON.stringify(envelope);
  await page.evaluate((next) => localStorage.setItem('zhengtu_autosave', next), serializedEnvelope);
  await page.reload();
}

async function savedState(page: Page): Promise<JsonRecord> {
  const serializedState = await page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    return JSON.stringify((JSON.parse(raw) as { state: unknown }).state);
  });
  return JSON.parse(serializedState) as JsonRecord;
}

function seedYearEnd(state: JsonRecord, totalDaysPlayed = 359): void {
  const time = asRecord(state.time, 'time');
  time.year = 2012;
  time.month = 12;
  time.day = 30;
  time.totalDaysPlayed = totalDaysPlayed;
  const career = asRecord(state.career, 'career');
  asRecord(career.appointment, 'appointment').probation = null;
}

function seedHighAssessmentPreconditions(state: JsonRecord): void {
  const character = asRecord(state.character, 'character');
  Object.assign(character, {
    integrity: 100,
    stability: 100,
    ambition: 100,
    competence: 100,
    charisma: 100,
    network: 100,
    diligence: 100,
    vigor: 100,
    corruptionRisk: 0,
  });
  const departmentStates = asRecord(
    asRecord(state.actions, 'actions').departmentStates,
    'department states',
  );
  for (const departmentState of Object.values(departmentStates)) {
    asRecord(departmentState, 'department state').kpiValues = Object.fromEntries(
      Object.entries(kpiTemplates).map(([id, template]) => [
        id,
        template.calcType === 'inverse' ? 0 : template.targetValue * 1.5,
      ]),
    );
  }
}

function selectOpportunityId(state: JsonRecord, targetPositionId: string): string {
  const career = asRecord(state.career, 'career');
  const opportunity = asRecords(career.opportunities, 'career opportunities').find(
    (item) =>
      asRecord(item.target, 'opportunity target').positionId === targetPositionId &&
      item.status === 'available',
  );
  if (!opportunity || typeof opportunity.id !== 'string') {
    const availableTargets = asRecords(career.opportunities, 'career opportunities')
      .filter((item) => item.status === 'available')
      .map((item) => asRecord(item.target, 'opportunity target').positionId)
      .join(', ');
    const assessment = asRecords(
      asRecord(state.assessments, 'assessments').annualAssessments,
      'annual assessments',
    ).at(-1);
    const lastScore = assessment?.score;
    const lastTier = assessment?.tier;
    throw new Error(
      `Expected available opportunity for ${targetPositionId}; available targets: ${availableTargets || 'none'}; last assessment: ${String(lastScore)}/${String(lastTier)}`,
    );
  }
  return opportunity.id;
}

async function advanceCareerProcess(page: Page, opportunityId: string): Promise<void> {
  for (let step = 0; step < 6; step += 1)
    await page.getByTestId(`advance-career-process-${opportunityId}`).click();
}

async function advanceMonthResolvingBlockingEvents(page: Page): Promise<void> {
  await page.getByTestId('advance-month').click();
  for (let attempt = 0; attempt < 5 && (await page.getByRole('dialog').isVisible()); attempt += 1) {
    await page
      .getByRole('dialog')
      .locator('[data-testid^="blocking-event-option-"]')
      .first()
      .click();
    await page.getByTestId('advance-day').click();
  }
}

function seedEconomicDevelopmentPost(state: JsonRecord): void {
  const target = position('admin_l6_0');
  const career = asRecord(state.career, 'career');
  const appointment = asRecord(career.appointment, 'appointment');
  Object.assign(appointment, {
    positionId: target.id,
    institutionId: target.institutionId,
    regionId: target.regionId,
    institutionLevel: target.institutionLevel,
    positionDomain: target.positionDomain,
    leadershipRank: target.leadershipRank,
  });
  seedPlayerOrganizationSeat(state, target, appointment);
  const experience = asRecords(career.experiences, 'career experiences')[0];
  if (!experience) throw new Error('Expected initial career experience');
  Object.assign(experience, {
    positionId: target.id,
    positionNameSnapshot: target.name,
    institutionId: target.institutionId,
    institutionNameSnapshot: target.institutionId,
    regionId: target.regionId,
    institutionLevel: target.institutionLevel,
    positionDomain: target.positionDomain,
    leadershipRank: target.leadershipRank,
  });
  state.remainingBudget = target.annualBudget;
  const departmentStates: JsonRecord = {};
  for (const [index] of target.departmentTemplateIds.entries()) {
    const departmentId = `${target.id}_dept_${index}`;
    departmentStates[departmentId] = {
      id: departmentId,
      kpiValues: {},
      monthlyConsumption: 0,
      cumulativeConsumption: 0,
      lastActionDay: 0,
      actionCooldownUntilDays: {},
    };
  }
  asRecord(state.actions, 'actions').departmentStates = departmentStates;
}

test('职业链：副职治理成果生成正职机会，职级与两次任职独立变化', async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await createCharacter(page);
  await page.goto('/#/career');
  await expect(page.getByTestId('advance-civil-service-rank')).toHaveCount(0);
  await expect(page.getByText(/录用试用期尚未结束/).first()).toBeVisible();
  await expect(
    page.getByText('职数库存', { exact: true }).locator('..').getByText('0/1', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/优秀或称职年度考核补充 1/)).toBeVisible();
  await page.goto('/#/main');
  await changeSave(page, (state) => {
    seedYearEnd(state, 719);
    seedHighAssessmentPreconditions(state);
    const time = asRecord(state.time, 'time');
    time.year = 2013;
    const career = asRecord(state.career, 'career');
    career.civilServiceRank = 'clerk_1';
    career.civilServiceRankStartedAtDay = 360;
    asRecord(career.appointment, 'appointment').probation = {
      status: 'passed',
      startedAtDay: 0,
      endsAtDay: 360,
      extensionCount: 0,
      completedActionCount: 1,
      resolvedAtDay: 360,
      outcomeReason: '已通过试用期',
      evaluations: [],
    };
    asRecord(state.world, 'world').facts = {
      ...asRecord(asRecord(state.world, 'world').facts, 'world facts'),
      assigned_project_delivered: true,
    };
    asRecord(state.assessments, 'assessments').annualAssessments = [
      { year: 2012, score: 90, tier: '优秀' },
    ];
  });
  await page.getByTestId('advance-day').click();
  await page.goto('/#/career');
  const deputyId = selectOpportunityId(await savedState(page), 'admin_l2_0');
  await page.getByTestId(`accept-opportunity-${deputyId}`).click();
  await advanceCareerProcess(page, deputyId);

  let state = await savedState(page);
  let career = asRecord(state.career, 'career');
  expect(career.civilServiceRank).toBe('clerk_1');
  expect(asRecord(career.appointment, 'appointment').positionId).toBe('admin_l2_0');

  await changeSave(page, seedHighAssessmentPreconditions);
  await page.goto('/#/departments');
  await page.getByTestId('department-admin_l2_0_dept_0').click();
  await page
    .getByTestId('start-action-admin_l2_0_dept_0-township_investment_promotion-primary')
    .click();
  await page.goto('/#/main');
  await page.getByTestId('advance-week').click();
  await page.goto('/#/departments');
  await page.getByTestId('department-admin_l2_0_dept_2').click();
  await page.getByTestId('start-action-admin_l2_0_dept_2-flood_preparation-primary').click();
  await page.goto('/#/main');
  await page.getByTestId('advance-week').click();
  let events = asRecord((await savedState(page)).events, 'events');
  expect(
    asRecords(events.history, 'event history').some(
      (event) => event.eventId === 'flood_preparation_metrics',
    ),
  ).toBe(true);
  await page.goto('/#/events');
  await page.getByTestId(/event-option-.*-submit_proposal/).click();
  await page.goto('/#/policies');
  await page.getByTestId('propose-policy-industrial_park_support').click();
  const governance = asRecord((await savedState(page)).governance, 'governance');
  const policies = asRecords(governance.policies, 'policies');
  const industrialPolicy = policies.find((item) => item.policyId === 'industrial_park_support');
  if (!industrialPolicy || typeof industrialPolicy.instanceId !== 'string')
    throw new Error('Expected industrial park policy');
  await page.getByTestId(`approve_policy-policy-${industrialPolicy.instanceId}`).click();
  await page.goto('/#/main');
  await page.getByTestId('advance-month').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId(/blocking-event-option-.*-rectification_plan/).click();
  await page.getByTestId('advance-day').click();
  events = asRecord((await savedState(page)).events, 'events');
  expect(
    asRecords(events.history, 'event history').some(
      (event) => event.eventId === 'industrial_park_progress_crisis',
    ),
  ).toBe(true);
  while (Number(asRecord((await savedState(page)).time, 'time').totalDaysPlayed) < 1440)
    await advanceMonthResolvingBlockingEvents(page);
  await page.goto('/#/career');
  await expect(page.getByTestId('township-chief-readiness')).toContainText(
    '当前任职内称职及以上考核次数不少于 2 次',
  );
  const chiefId = selectOpportunityId(await savedState(page), 'admin_l3_0');
  await page.getByTestId(`accept-opportunity-${chiefId}`).click();
  await advanceCareerProcess(page, chiefId);

  state = await savedState(page);
  career = asRecord(state.career, 'career');
  expect(asRecord(career.appointment, 'appointment').positionId).toBe('admin_l3_0');
  expect(career.civilServiceRank).toBe('clerk_1');
  expect(consoleErrors).toEqual([]);
});

test('产业政策链：招商行动产生提议事实并触发园区危机', async ({ page }) => {
  await createCharacter(page);
  await changeSave(page, seedEconomicDevelopmentPost);
  await page.goto('/#/departments');
  await page.getByTestId('department-admin_l6_0_dept_1').click();
  await page.getByTestId('start-action-admin_l6_0_dept_1-investment_promotion-primary').click();
  await page.goto('/#/main');
  await page.getByTestId('advance-week').click();
  const events = asRecord((await savedState(page)).events, 'events');
  expect(
    asRecords(events.history, 'event history').some(
      (event) => event.eventId === 'investment_promotion_completed',
    ),
  ).toBe(true);
  await page.getByTestId('advance-day').click();
  await page.goto('/#/events');
  await page.getByTestId(/event-option-.*-submit_proposal/).click();
  await page.goto('/#/policies');
  await page.getByTestId('propose-policy-industrial_park_support').click();
  const governance = asRecord((await savedState(page)).governance, 'governance');
  const policies = asRecords(governance.policies, 'policies');
  const industrialPolicy = policies.find((item) => item.policyId === 'industrial_park_support');
  if (!industrialPolicy || typeof industrialPolicy.instanceId !== 'string')
    throw new Error('Expected industrial park policy');
  await page.getByTestId(`approve_policy-policy-${industrialPolicy.instanceId}`).click();
  await page.goto('/#/main');
  await page.getByTestId('advance-month').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId(/blocking-event-option-.*-rectification_plan/).click();
});

test('防汛链：月度风险真实中断时间轴，刷新后延迟事件按原日期触发', async ({ page }) => {
  await createCharacter(page);
  await changeSave(page, (state) => {
    seedYearEnd(state);
    const world = asRecord(state.world, 'world');
    asRecord(world.metrics, 'world metrics').flood_risk = 90;
    asRecord(world.facts, 'world facts').flood_prepared = false;
  });
  await page.getByTestId('advance-day').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  let state = await savedState(page);
  const interrupted = asRecord(state.time, 'time');
  const continuation = asRecord(interrupted.pendingContinuation, 'continuation');
  const remainingNodes = asRecords(continuation.remainingNodes, 'continuation nodes');
  expect(remainingNodes.length).toBeGreaterThan(0);
  expect(remainingNodes.some((node) => node.type === 'annual_assessment')).toBe(true);

  await page.reload();
  await page.getByTestId(/blocking-event-option-.*-coordinate_rescue/).click();
  await page.getByTestId('advance-day').click();
  state = await savedState(page);
  expect(asRecord(state.time, 'time').totalDaysPlayed).toBe(360);
  await page.getByTestId('advance-day').click();
  state = await savedState(page);
  expect(asRecord(state.time, 'time').totalDaysPlayed).toBe(361);
  let events = asRecord(state.events, 'events');
  expect(
    asRecords(events.pending, 'pending events').filter(
      (event) => event.eventId === 'flood_accountability',
    ),
  ).toHaveLength(0);
  const scheduledAccountability = asRecords(events.scheduled, 'scheduled events').filter(
    (event) => event.eventId === 'flood_accountability',
  );
  expect(scheduledAccountability).toHaveLength(1);
  expect(scheduledAccountability[0]?.activateAtDay).toBe(362);

  await page.reload();
  await page.getByTestId('advance-day').click();
  await page.goto('/#/events');
  state = await savedState(page);
  expect(asRecord(state.time, 'time').totalDaysPlayed).toBe(362);
  events = asRecord(state.events, 'events');
  expect(
    asRecords(events.pending, 'pending events').filter(
      (event) => event.eventId === 'flood_accountability',
    ),
  ).toHaveLength(1);
  expect(
    asRecords(events.scheduled, 'scheduled events').filter(
      (event) => event.eventId === 'flood_accountability',
    ),
  ).toHaveLength(0);
});

test('调查链：年度信号触发举报，延迟调查在刷新后仅于原日期结算', async ({ page }) => {
  await createCharacter(page);
  await changeSave(page, (state) => {
    seedYearEnd(state);
    const character = asRecord(state.character, 'character');
    character.integrity = 0;
    character.corruptionRisk = 100;
    character.stability = 0;
  });
  await page.getByTestId('advance-day').click();
  await page.goto('/#/main');
  await page.getByTestId('advance-day').click();
  await page.getByTestId('advance-day').click();
  await page.goto('/#/events');
  const cooperateOption = page.getByTestId(/event-option-.*-cooperate/);
  await expect(cooperateOption).toHaveCount(1);
  await cooperateOption.click();
  await page.goto('/#/events');
  await expect(page.getByTestId(/event-option-.*-cooperate/)).toHaveCount(0);
  const afterResolution = asRecord((await savedState(page)).events, 'events');
  expect(
    asRecords(afterResolution.history, 'event history').some(
      (event) => event.eventId === 'investigation_start' && event.chosenOptionId === 'cooperate',
    ),
  ).toBe(true);
  const scheduledAt = asRecords(
    asRecord((await savedState(page)).events, 'events').scheduled,
    'scheduled',
  )[0];
  if (!scheduledAt || typeof scheduledAt.activateAtDay !== 'number')
    throw new Error('Expected delayed formal investigation');
  expect(scheduledAt.activateAtDay).toBe(365);

  await page.reload();
  await page.goto('/#/main');
  await page.getByTestId('advance-day').click();
  await page.getByTestId('advance-day').click();
  let state = await savedState(page);
  expect(
    asRecords(asRecord(state.events, 'events').history, 'history').some(
      (event) => event.eventId === 'formal_investigation',
    ),
  ).toBe(false);
  await page.getByTestId('advance-day').click();
  state = await savedState(page);
  expect(
    asRecords(asRecord(state.events, 'events').history, 'history').some(
      (event) => event.eventId === 'formal_investigation',
    ),
  ).toBe(true);
});
