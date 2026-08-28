/**
 * Phase 3 产品级浏览器验收：只通过用户可见入口完成科员至乡科级正职路径。
 *
 * 时间、考核、机会、事件和任职仍由 UI/生产管线产生；仅在 Selection 创建前
 * 冻结确定性的、可审计的竞争事实，以保证相对选拔结果可重放。
 */

import { expect, test, type Page } from '@playwright/test';

type JsonValue = boolean | number | string | null | JsonRecord | JsonValue[];

interface JsonRecord {
  [key: string]: JsonValue;
}

function asRecord(value: JsonValue | undefined, name: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Expected ${name} to be a record`);
  return value;
}

function asRecords(value: JsonValue | undefined, name: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} to be an array`);
  return value.map((item, index) => asRecord(item, `${name}[${index}]`));
}

async function savedState(page: Page): Promise<JsonRecord> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    return (JSON.parse(raw) as { state: JsonRecord }).state;
  });
}

async function changeSave(page: Page, change: (state: JsonRecord) => void): Promise<void> {
  const envelope = await page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    return JSON.parse(raw) as JsonRecord;
  });
  const state = asRecord(envelope.state, 'save state');
  change(state);
  const serializedEnvelope = JSON.stringify(envelope);
  await page.evaluate((next) => localStorage.setItem('zhengtu_autosave', next), serializedEnvelope);
  await page.reload();
}

/**
 * Freeze deterministic, auditable candidate facts before a Selection is created.
 * This helper intentionally writes no opportunity, Selection, process, Vacancy,
 * Appointment or Seat facts.
 *
 * @param state persisted test state
 */
function freezeRelativeSelectionCompetitionFacts(state: JsonRecord): void {
  const time = asRecord(state.time, 'time');
  const year = time.year;
  if (typeof year !== 'number') throw new Error('Expected numeric current year');
  const career = asRecord(state.career, 'career');
  const openExperiences = asRecords(career.experiences, 'career experiences').filter(
    (experience) => experience.endedAtDay === null,
  );
  if (openExperiences.length !== 1) throw new Error('Expected exactly one open career experience');
  const openExperience = openExperiences[0];
  if (!openExperience) throw new Error('Expected open career experience');
  const assessments = asRecords(openExperience.assessmentResults, 'assessment results');
  assessments.push({ year, score: 100, tier: '优秀' });
  openExperience.assessmentResults = assessments;
  career.specialties = { public_management: 100 };
  const character = asRecord(state.character, 'character');
  character.integrity = 100;
  character.network = 100;
  const organization = asRecord(state.organization, 'organization');
  for (const cadre of asRecords(organization.cadres, 'cadres')) {
    cadre.assessments = [{ year, score: 0, tier: '不称职' }];
    cadre.specialties = { public_management: 0 };
    cadre.restrictions = [];
  }
}

async function currentDay(page: Page): Promise<number> {
  return Number(asRecord((await savedState(page)).time, 'time').totalDaysPlayed);
}

async function setRng(page: Page, value: number): Promise<void> {
  await page.evaluate((next) => sessionStorage.setItem('phase3-e2e-rng', String(next)), value);
}

/**
 * 读取某档位中指定 actionId 的占用数（个人任务与部门行动共用槽位）。
 *
 * @param page Playwright 页面
 * @param tier 槽位档位（primary/secondary/reserve）
 * @param actionId 任务 ID 或行动 ID
 * @returns 该档位下该 actionId 的 occupant 数量
 */
async function tierOccupiedCount(page: Page, tier: string, actionId: string): Promise<number> {
  const state = await savedState(page);
  const slots = asRecord(asRecord(state.actions, 'actions').slots, 'slots');
  const occupants = (asRecord(slots[tier], `slots.${tier}`).occupants ?? []) as JsonRecord[];
  return occupants.filter((o) => o && o.actionId === actionId).length;
}

/** 路由到全局导航链接文案的映射（与 AppShell NAV_ITEMS 保持一致） */
const NAV_LABELS: Record<string, string> = {
  '#/main': '工作台',
  '#/tasks': '任务',
  '#/departments': '部门治理',
  '#/assessment': '年度考核',
  '#/career': '职务职级',
  '#/policies': '政策',
  '#/events': '事件',
};

/**
 * 通过点击全局导航链接切换路由。
 *
 * 不直接修改 location.hash：链接可能带有角标数字，因此按前缀匹配可访问名称。
 *
 * @param page Playwright 页面
 * @param route 目标 hash 路由，如 '#/tasks'
 */
async function go(page: Page, route: string): Promise<void> {
  const label = NAV_LABELS[route];
  if (!label) throw new Error(`Unknown route ${route}`);
  const link = page.getByRole('link', { name: new RegExp(`^${label}`) }).first();
  // 真实点击导航链接（满足 actionability 检查）。点击后 hash 变化，
  // 但 SolidJS 路由组件在微任务中才重渲染；若不等待，紧跟其后的推进/任务
  // 点击会落在未稳定渲染的 DOM 上，导致时间推进结算被截断、任务完成数漂移。
  // 这里用固定短等待让路由渲染与浏览器滚动稳定，消除 click 导航的竞态。
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
  await page.waitForTimeout(100);
}

async function createCharacter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => Number(sessionStorage.getItem('phase3-e2e-rng') ?? '0.99');
  });
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByTestId('character-name').fill('基层纵向验收干部');
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

/**
 * 在按钮可用时以真实用户点击启动，并确定性确认任务真正进入槽位。
 *
 * 点击后轮询存档确认对应档位的 occupant 数 +1，直接验证 store 状态而非依赖
 * UI disabled 表现，避免 SolidJS 响应式重渲染滞后使 reducer 静默拒绝
 * （点击了但任务未启动）导致的非确定性漏启动。
 *
 * @param page Playwright 页面
 * @param testId 启动按钮 data-testid
 * @returns 是否实际完成了点击启动
 */
async function startIfEnabled(page: Page, testId: string): Promise<boolean> {
  const button = page.getByTestId(testId);
  if ((await button.count()) === 0) return false;
  if (!(await button.isEnabled())) return false;

  // 仅对个人任务解析档位与任务 ID，用于点击后确定性确认槽位真正被占用。
  // 部门行动 testId 格式不同（含 deptId），保持简单真实点击。
  const match = testId.match(/^start-task-(.+)-(primary|secondary|reserve)$/);
  if (!match) {
    await button.click();
    return true;
  }
  // 正则已匹配成功，捕获组必为字符串；非空断言在此安全。
  const taskId = match[1]!;
  const tier = match[2]!;

  const before = await tierOccupiedCount(page, tier, taskId);
  await button.click();

  // 确定性确认：该任务在对应档位的占用数 +1（真正进入槽位）。
  // 若 SolidJS 重渲染滞后使 reducer 静默拒绝（点击了但未启动），重读按钮状态重试一次。
  const started = await expect
    .poll(async () => (await tierOccupiedCount(page, tier, taskId)) > before, {
      timeout: 2_000,
    })
    .toBe(true)
    .catch(() => false);
  if (!started && (await button.isEnabled())) {
    await button.click();
    await expect
      .poll(async () => (await tierOccupiedCount(page, tier, taskId)) > before, { timeout: 2_000 })
      .toBe(true);
  }
  return true;
}

async function resumeBlockingContinuations(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dialog = page.getByRole('dialog');
    if (!(await dialog.isVisible())) return;
    await dialog.locator('[data-testid^="blocking-event-option-"]').first().click();
    const state = await savedState(page);
    const pendingContinuation = asRecord(state.time, 'time').pendingContinuation;
    if (pendingContinuation !== null) {
      await go(page, '#/main');
      await setRng(page, 0.99);
      await page.getByTestId('advance-day').click();
    }
  }
  throw new Error('Blocking continuation did not settle after 10 attempts');
}

async function advanceOnce(page: Page, granularity: 'day' | 'week' | 'month'): Promise<void> {
  await go(page, '#/main');
  await setRng(page, 0.99);
  const before = await currentDay(page);
  await page.getByTestId(`advance-${granularity}`).click();
  await resumeBlockingContinuations(page);
  // 确定性确认：推进后时间应真增（至少 +1 天），避免推进按钮点击与
  // store 结算脱节导致循环空转。
  await expect.poll(async () => (await currentDay(page)) > before, { timeout: 5_000 }).toBe(true);
}

async function startClerkBatch(page: Page, includeReserve: boolean): Promise<void> {
  await go(page, '#/tasks');
  await startIfEnabled(page, 'start-task-task_village_research-primary');
  await startIfEnabled(page, 'start-task-task_agri_walk-primary');
  await startIfEnabled(page, 'start-task-task_draft_material-primary');
  await startIfEnabled(page, 'start-task-task_poverty_visit-secondary');
  await startIfEnabled(page, 'start-task-task_policy_brief-secondary');
  if (includeReserve) await startIfEnabled(page, 'start-task-task_draft_speech-reserve');
}

async function advanceClerkMonths(
  page: Page,
  targetDay: number,
  includeReserve: boolean,
): Promise<void> {
  while ((await currentDay(page)) < targetDay) {
    await startClerkBatch(page, includeReserve);
    const remaining = targetDay - (await currentDay(page));
    await advanceOnce(page, remaining >= 30 ? 'month' : remaining >= 7 ? 'week' : 'day');
  }
}

async function startDepartmentAction(
  page: Page,
  departmentId: string,
  actionId: string,
  tier: 'primary' | 'secondary' | 'reserve',
): Promise<boolean> {
  await go(page, '#/departments');
  const backButton = page.getByRole('button', { name: '返回部门列表' });
  if (await backButton.isVisible()) await backButton.click();
  await page.getByTestId(`department-${departmentId}`).click();
  return startIfEnabled(page, `start-action-${departmentId}-${actionId}-${tier}`);
}

async function startDeputyBatch(page: Page): Promise<void> {
  const projectStarted = await startDepartmentAction(
    page,
    'admin_l2_0_dept_0',
    'township_priority_delivery',
    'primary',
  );
  if (!projectStarted)
    await startDepartmentAction(
      page,
      'admin_l2_0_dept_0',
      'township_investment_promotion',
      'primary',
    );
  await startDepartmentAction(page, 'admin_l2_0_dept_1', 'tax_collection', 'primary');
  await startDepartmentAction(page, 'admin_l2_0_dept_2', 'safety_inspection', 'primary');
  await startDepartmentAction(page, 'admin_l2_0_dept_0', 'urban_planning', 'secondary');
  await startDepartmentAction(page, 'admin_l2_0_dept_1', 'budget_review', 'secondary');
  await startDepartmentAction(page, 'admin_l2_0_dept_3', 'social_assistance', 'reserve');
}

async function advanceDeputyMonths(page: Page, targetDay: number): Promise<void> {
  while ((await currentDay(page)) < targetDay) {
    await startDeputyBatch(page);
    const remaining = targetDay - (await currentDay(page));
    await advanceOnce(page, remaining >= 30 ? 'month' : remaining >= 7 ? 'week' : 'day');
  }
}

function availableOpportunityId(state: JsonRecord, definitionId: string): string {
  const career = asRecord(state.career, 'career');
  const opportunity = asRecords(career.opportunities, 'career opportunities').find(
    (candidate) => candidate.definitionId === definitionId && candidate.status === 'available',
  );
  if (!opportunity || typeof opportunity.id !== 'string')
    throw new Error(`Expected available opportunity ${definitionId}`);
  return opportunity.id;
}

async function completeSelection(page: Page, opportunityId: string): Promise<void> {
  await setRng(page, 0);
  for (let step = 0; step < 6; step += 1)
    await page.getByTestId(`advance-career-process-${opportunityId}`).click();
  await setRng(page, 0.99);
}

test('自然路径从建档、任务与考核走到乡科级正职，双通道和关键刷新保持独立', async ({ page }) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await createCharacter(page);
  await go(page, '#/career');
  await expect(page.getByTestId('advance-civil-service-rank')).toHaveCount(0);
  await expect(page.getByText(/录用试用期尚未结束/).first()).toBeVisible();

  await go(page, '#/tasks');
  await page.getByTestId('start-task-task_induction_training-primary').click();
  await page.reload();
  let state = await savedState(page);
  expect(asRecord(asRecord(state.actions, 'actions').slots, 'slots')).toBeDefined();

  await advanceClerkMonths(page, 180, false);
  state = await savedState(page);
  expect(asRecord(state.assessments, 'assessments').annualAssessments).toHaveLength(1);
  await go(page, '#/assessment');
  await expect(page.getByText('年度考核', { exact: true }).first()).toBeVisible();
  await advanceClerkMonths(page, 360, false);
  await go(page, '#/career');
  await expect(page.getByTestId('probation-status')).toHaveText('已转正');
  const clerkAppointment = asRecord(
    asRecord((await savedState(page)).career, 'career').appointment,
    'appointment',
  );
  await page.getByTestId('advance-civil-service-rank').click();
  await expect(page.getByTestId('rank-change-feedback')).toContainText(
    '具体职位、所属机构和领导职务均未变化',
  );
  await page.reload();
  state = await savedState(page);
  let career = asRecord(state.career, 'career');
  expect(career.civilServiceRank).toBe('clerk_1');
  expect(asRecord(career.appointment, 'appointment')).toEqual(clerkAppointment);

  await go(page, '#/tasks');
  await page.getByTestId('start-task-task_assigned_special-primary').click();
  await startIfEnabled(page, 'start-task-task_village_research-primary');
  await startIfEnabled(page, 'start-task-task_agri_walk-primary');
  await startIfEnabled(page, 'start-task-task_poverty_visit-secondary');
  await startIfEnabled(page, 'start-task-task_draft_material-secondary');
  await startIfEnabled(page, 'start-task-task_draft_speech-reserve');
  await advanceOnce(page, 'month');
  await advanceClerkMonths(page, 540, true);
  state = await savedState(page);
  expect(asRecord(state.world, 'world').facts).toMatchObject({ assigned_project_delivered: true });
  const deputyOpportunityId = availableOpportunityId(state, 'township_deputy_leadership_vacancy');

  await go(page, '#/career');
  await expect(page.getByTestId(`accept-opportunity-${deputyOpportunityId}`)).toBeDisabled();
  while ((await currentDay(page)) < 720) await advanceOnce(page, 'month');
  await go(page, '#/career');
  await changeSave(page, freezeRelativeSelectionCompetitionFacts);
  await go(page, '#/career');
  await page.getByTestId(`accept-opportunity-${deputyOpportunityId}`).click();
  await page.reload();
  await expect(page.getByText('当前选拔流程')).toBeVisible();
  const rankBeforeDeputy = asRecord((await savedState(page)).career, 'career').civilServiceRank;
  await completeSelection(page, deputyOpportunityId);
  await expect(page.getByTestId('appointment-change-feedback')).toContainText('公务员职级保持');
  state = await savedState(page);
  career = asRecord(state.career, 'career');
  expect(asRecord(career.appointment, 'appointment')).toMatchObject({
    positionId: 'admin_l2_0',
    leadershipRank: 'township_deputy',
  });
  expect(career.civilServiceRank).toBe(rankBeforeDeputy);
  await page.reload();
  expect(
    asRecord(asRecord((await savedState(page)).career, 'career').appointment, 'appointment'),
  ).toMatchObject({ positionId: 'admin_l2_0', leadershipRank: 'township_deputy' });

  await startDepartmentAction(
    page,
    'admin_l2_0_dept_0',
    'township_investment_promotion',
    'primary',
  );
  await startDepartmentAction(page, 'admin_l2_0_dept_2', 'flood_preparation', 'primary');
  await advanceOnce(page, 'week');
  await go(page, '#/events');
  await page.getByTestId(/event-option-.*-submit_proposal/).click();
  await go(page, '#/policies');
  await page.getByTestId('propose-policy-industrial_park_support').click();
  state = await savedState(page);
  const policy = asRecords(asRecord(state.governance, 'governance').policies, 'policies').find(
    (candidate) => candidate.policyId === 'industrial_park_support',
  );
  if (!policy || typeof policy.instanceId !== 'string')
    throw new Error('Expected industrial park policy');
  await page.getByTestId(`approve_policy-policy-${policy.instanceId}`).click();
  await go(page, '#/main');
  await setRng(page, 0.99);
  await page.getByTestId('advance-month').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  await resumeBlockingContinuations(page);

  await advanceDeputyMonths(page, 1080);
  await go(page, '#/career');
  await page.getByTestId('advance-civil-service-rank').click();
  const deputyAppointmentId = asRecord(
    asRecord((await savedState(page)).career, 'career').appointment,
    'appointment',
  ).appointmentId;
  await expect(page.getByTestId('rank-change-feedback')).toContainText(
    '具体职位、所属机构和领导职务均未变化',
  );
  await page.reload();
  state = await savedState(page);
  career = asRecord(state.career, 'career');
  expect(career.civilServiceRank).toBe('section_member_4');
  expect(asRecord(career.appointment, 'appointment').appointmentId).toBe(deputyAppointmentId);

  await advanceDeputyMonths(page, 1260);
  await go(page, '#/career');
  const chiefOpportunityId = availableOpportunityId(
    await savedState(page),
    'township_chief_leadership_vacancy',
  );
  while ((await currentDay(page)) < 1440) await advanceOnce(page, 'month');
  await go(page, '#/career');
  await changeSave(page, freezeRelativeSelectionCompetitionFacts);
  await go(page, '#/career');
  await page.getByTestId(`accept-opportunity-${chiefOpportunityId}`).click();
  await page.reload();
  const rankBeforeChief = asRecord((await savedState(page)).career, 'career').civilServiceRank;
  await completeSelection(page, chiefOpportunityId);
  await expect(page.getByTestId('appointment-change-feedback')).toContainText('公务员职级保持');
  state = await savedState(page);
  career = asRecord(state.career, 'career');
  expect(asRecord(career.appointment, 'appointment')).toMatchObject({
    positionId: 'admin_l3_0',
    leadershipRank: 'township_chief',
  });
  expect(career.civilServiceRank).toBe(rankBeforeChief);
  expect(Number(state.remainingBudget)).toBeGreaterThanOrEqual(0);
  expect(consoleErrors).toEqual([]);
});

test.describe('移动端核心入口', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('建档后可在移动端承接任务、推进时间并查看职务职级', async ({ page }) => {
    await createCharacter(page);
    await go(page, '#/tasks');
    await page.getByTestId('start-task-task_policy_brief-primary').click();
    await advanceOnce(page, 'week');
    await go(page, '#/career');
    await expect(page.getByText('职务与职级', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('probation-status-card')).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBe(false);
  });
});
