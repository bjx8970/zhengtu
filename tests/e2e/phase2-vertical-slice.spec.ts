/**
 * Browser acceptance coverage for the playable Phase 2 vertical slice.
 *
 * Each scenario creates a real local save through the character wizard, then
 * adjusts only the preconditions that would otherwise require many in-game years.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;

const events = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/config/templates/events.json'), 'utf8'),
) as JsonRecord[];
const positions = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/config/positions/positions.json'), 'utf8'),
) as JsonRecord[];

function eventDefinition(id: string): JsonRecord {
  const definition = events.find((item) => item.id === id);
  if (!definition) throw new Error(`Missing event definition: ${id}`);
  return definition;
}

function position(id: string): JsonRecord {
  const target = positions.find((item) => item.id === id);
  if (!target) throw new Error(`Missing position definition: ${id}`);
  return target;
}

function signal(day: number, type = 'world.metric_changed'): JsonRecord {
  return {
    signalId: `e2e-signal-${day}-${type}`,
    signalType: type,
    occurredAtDay: day,
    data: { metricId: 'flood_risk', value: 90 },
  };
}

function eventSnapshot(definition: JsonRecord): JsonRecord {
  const activation = definition.activation as JsonRecord | undefined;
  return {
    eventId: definition.id,
    title: definition.title,
    description: definition.description,
    category: definition.category,
    priority: definition.priority,
    presentation: definition.presentation,
    options: definition.options,
    automaticOutcome: definition.automaticOutcome ?? null,
    mutexGroup: null,
    contentVersion: 'phase2-e2e',
    deadlineDays: activation?.deadlineDays ?? null,
    chainId: definition.chainId ?? null,
    nodeId: definition.nodeId ?? null,
    repeatPolicy: definition.repeatPolicy,
  };
}

function pendingEvent(id: string, day: number, instanceId = `e2e-${id}`): JsonRecord {
  const definition = eventDefinition(id);
  const activation = definition.activation as JsonRecord | undefined;
  const deadlineDays = activation?.deadlineDays;
  return {
    instanceId,
    eventId: id,
    status: definition.presentation === 'blocking' ? 'active' : 'pending',
    triggeredAtDay: day,
    activatedAtDay: day,
    deadlineDay: typeof deadlineDays === 'number' ? day + deadlineDays : null,
    triggerContext: signal(day),
    sourceKey: `e2e:${id}:${day}`,
    chainInstanceId: null,
    snapshot: eventSnapshot(definition),
  };
}

function opportunity(id: string, positionId: string, day: number): JsonRecord {
  const target = position(positionId);
  return {
    id,
    definitionId:
      positionId === 'admin_l2_0'
        ? 'township_deputy_leadership_vacancy'
        : 'township_chief_leadership_vacancy',
    type: 'leadership_vacancy',
    status: 'available',
    source: {
      sourceType: 'assessment',
      sourceId: `assessment-${day}`,
      signalId: `assessment-${day}`,
      description: '年度考核',
    },
    sourceSignal: {
      signalId: `assessment-${day}`,
      signalType: 'assessment.completed',
      occurredAtDay: day,
      data: { year: 2027, score: 90, tier: '优秀' },
    },
    target: {
      positionId: target.id,
      positionName: target.name,
      institutionId: target.institutionId,
      institutionName: '青云镇人民政府',
      regionId: target.regionId,
      institutionLevel: target.institutionLevel,
      positionDomain: target.positionDomain,
      leadershipRank: target.leadershipRank,
    },
    appointmentType: 'substantive',
    appointmentReason: 'promotion',
    appearedAtDay: day,
    expiresAtDay: day + 30,
    acceptedAtDay: null,
    rejectedAtDay: null,
    resolvedAtDay: null,
    cancelledAtDay: null,
    requiresSelection: true,
    eligibilityConditions: [],
    finalOutcome: null,
    reason: '年度考核后出现的岗位机会',
  };
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
  const state = envelope.state as JsonRecord;
  change(state);
  await page.evaluate((next) => {
    localStorage.setItem('zhengtu_autosave', JSON.stringify(next));
  }, envelope);
  await page.reload();
}

async function savedState(page: Page): Promise<JsonRecord> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    return (JSON.parse(raw) as JsonRecord).state as JsonRecord;
  });
}

test('职业链：建档、职级晋升与两次任职保持独立', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await createCharacter(page);
  await changeSave(page, (state) => {
    const time = state.time as JsonRecord;
    time.totalDaysPlayed = 360;
    const career = state.career as JsonRecord;
    career.civilServiceRankStartedAtDay = 0;
    career.opportunities = [opportunity('e2e-deputy', 'admin_l2_0', 360)];
    const assessments = state.assessments as JsonRecord;
    assessments.annualAssessments = [{ year: 2027, score: 90, tier: '优秀' }];
    const world = state.world as JsonRecord;
    (world.metrics as JsonRecord)['rank_quota.clerk_1'] = 1;
  });

  await page.goto('/#/career');
  await expect(page.getByTestId('advance-civil-service-rank')).toBeVisible();
  await page.getByTestId('advance-civil-service-rank').click();
  await page.getByTestId('accept-opportunity-e2e-deputy').click();
  for (let step = 0; step < 6; step += 1)
    await page.getByTestId('advance-career-process-e2e-deputy').click();

  let state = await savedState(page);
  expect((state.career as JsonRecord).civilServiceRank).toBe('clerk_1');
  expect(((state.career as JsonRecord).appointment as JsonRecord).positionId).toBe('admin_l2_0');

  await changeSave(page, (next) => {
    const time = next.time as JsonRecord;
    time.totalDaysPlayed = 1080;
    const career = next.career as JsonRecord;
    career.opportunities = [opportunity('e2e-chief', 'admin_l3_0', 1080)];
  });
  await page.goto('/#/career');
  await page.getByTestId('accept-opportunity-e2e-chief').click();
  for (let step = 0; step < 6; step += 1)
    await page.getByTestId('advance-career-process-e2e-chief').click();

  state = await savedState(page);
  const career = state.career as JsonRecord;
  expect((career.appointment as JsonRecord).positionId).toBe('admin_l3_0');
  expect(career.civilServiceRank).toBe('clerk_1');
  expect(consoleErrors).toEqual([]);
});

test('产业政策链：批准后触发阻塞危机，刷新不丢失事件', async ({ page }) => {
  await createCharacter(page);
  await changeSave(page, (state) => {
    ((state.world as JsonRecord).facts as JsonRecord).industrial_park_policy_proposed = true;
  });

  await page.goto('/#/policies');
  await page.getByTestId('propose-policy-industrial_park_support').click();
  const proposed = await savedState(page);
  const policy = ((proposed.governance as JsonRecord).policies as JsonRecord[])[0];
  if (!policy) throw new Error('Expected proposed industrial park policy');
  await page.getByTestId(`approve_policy-policy-${policy.instanceId}`).click();
  await page.goto('/#/main');
  await page.getByTestId('advance-month').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId(/blocking-event-option-.*-rectification_plan/).click();
  const state = await savedState(page);
  expect((state.events as JsonRecord).activeBlockingEventId).toBeNull();
});

test('防汛链：阻塞中断后选择分支，并保留同日延迟事件日期', async ({ page }) => {
  await createCharacter(page);
  await changeSave(page, (state) => {
    const time = state.time as JsonRecord;
    const event = pendingEvent('flood_emergency', time.totalDaysPlayed as number);
    const eventsState = state.events as JsonRecord;
    eventsState.pending = [event];
    eventsState.activeBlockingEventId = event.instanceId;
    time.pendingContinuation = { absoluteDay: time.totalDaysPlayed, remainingNodes: [] };
  });

  await expect(page.getByRole('dialog')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId(/blocking-event-option-.*-coordinate_rescue/).click();
  const state = await savedState(page);
  const eventsState = state.events as JsonRecord;
  expect(eventsState.activeBlockingEventId).toBeNull();
  expect((eventsState.history as JsonRecord[])[0]?.eventId).toBe('flood_emergency');
  expect((eventsState.scheduled as JsonRecord[])[0]?.activateAtDay).toBe(2);
});

test('调查链：举报选择后进入历史，延迟事件可刷新且不可重复选择', async ({ page }) => {
  await createCharacter(page);
  await changeSave(page, (state) => {
    const time = state.time as JsonRecord;
    const event = pendingEvent('investigation_start', time.totalDaysPlayed as number);
    const eventsState = state.events as JsonRecord;
    eventsState.pending = [event];
  });

  await page.goto('/#/events');
  await page.getByTestId(/event-option-e2e-investigation_start-cooperate/).click();
  await expect(page.getByTestId(/event-option-e2e-investigation_start-cooperate/)).toHaveCount(0);
  await page.reload();
  const state = await savedState(page);
  const eventsState = state.events as JsonRecord;
  expect((eventsState.history as JsonRecord[])[0]?.eventId).toBe('investigation_start');
  expect((eventsState.scheduled as JsonRecord[])[0]?.eventId).toBe('formal_investigation');
});
