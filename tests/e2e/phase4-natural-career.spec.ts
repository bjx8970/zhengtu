/**
 * Phase 4 自然路径浏览器验收：只通过真实 UI 入口驱动组织世界演进。
 *
 * 全程不写 localStorage（仅只读断言）：建档、任务、时间推进、机会接受、
 * 选拔推进与页面刷新均由用户可见入口触发；NPC 年度考核、政治周期、
 * Vacancy 生产与相对选拔结果全部由真实 Store/Engine/统一时间轴产生。
 *
 * 自然结果说明：基层任务积累 local_governance 专长后玩家与 NPC 进入同一
 * 候选池；在当前内容配置下，NPC 年度考核复利使其在本场景窗口内自然获胜。
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

/** 只读读取本地存档状态；测试从不写 localStorage。 */
async function savedState(page: Page): Promise<JsonRecord> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    return (JSON.parse(raw) as { state: JsonRecord }).state;
  });
}

async function currentDay(page: Page): Promise<number> {
  return Number(asRecord((await savedState(page)).time, 'time').totalDaysPlayed);
}

async function setRng(page: Page, value: number): Promise<void> {
  await page.evaluate((next) => sessionStorage.setItem('phase4-e2e-rng', String(next)), value);
}

/** 路由到全局导航链接文案的映射（与 AppShell NAV_ITEMS 保持一致）。 */
const NAV_LABELS: Record<string, string> = {
  '#/main': '工作台',
  '#/tasks': '任务',
  '#/career': '职务职级',
};

async function go(page: Page, route: string): Promise<void> {
  const label = NAV_LABELS[route];
  if (!label) throw new Error(`Unknown route ${route}`);
  const link = page.getByRole('link', { name: new RegExp(`^${label}`) }).first();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
  await page.waitForTimeout(100);
}

async function createCharacter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => Number(sessionStorage.getItem('phase4-e2e-rng') ?? '0.99');
  });
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByTestId('character-name').fill('组织世界自然路径验收员');
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
  await expect.poll(async () => (await currentDay(page)) > before, { timeout: 5_000 }).toBe(true);
}

/** 在按钮可用时点击启动（冷却/前置不满足时按钮禁用，跳过即可）。 */
async function startIfEnabled(page: Page, testId: string): Promise<void> {
  const button = page.getByTestId(testId);
  if ((await button.count()) > 0 && (await button.isEnabled())) await button.click();
}

/** 与真实玩家一致的科员工作批次：基层调研/走访积累专长，文书任务维持考核。 */
async function startClerkBatch(page: Page): Promise<void> {
  await go(page, '#/tasks');
  await startIfEnabled(page, 'start-task-task_village_research-primary');
  await startIfEnabled(page, 'start-task-task_agri_walk-primary');
  await startIfEnabled(page, 'start-task-task_draft_material-primary');
  await startIfEnabled(page, 'start-task-task_poverty_visit-secondary');
  await startIfEnabled(page, 'start-task-task_policy_brief-secondary');
}

async function advanceClerkMonths(page: Page, targetDay: number): Promise<void> {
  while ((await currentDay(page)) < targetDay) {
    await startClerkBatch(page);
    const remaining = targetDay - (await currentDay(page));
    await advanceOnce(page, remaining >= 30 ? 'month' : remaining >= 7 ? 'week' : 'day');
  }
}

/** 上级交办专项是副职机会派发的事实前提：轮询启动直至事实落账。 */
async function ensureAssignedProjectDelivered(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await savedState(page);
    const facts = asRecord(asRecord(state.world, 'world').facts, 'facts');
    if (facts.assigned_project_delivered === true) return;
    await go(page, '#/tasks');
    await startIfEnabled(page, 'start-task-task_assigned_special-primary');
    await advanceOnce(page, 'week');
  }
  throw new Error('assigned_project_delivered was not produced by task_assigned_special');
}

test('自然路径：NPC 世界演进、副职竞争落选、级联空缺与政治周期', async ({ page }) => {
  test.setTimeout(360_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await createCharacter(page);

  // 新游戏只含初始事实：两个未分配编制席位空缺，无任何选拔。
  const state0 = await savedState(page);
  const organization0 = asRecord(state0.organization, 'organization');
  const initialVacancyIds = asRecords(organization0.vacancies, 'vacancies')
    .map((vacancy) => String(vacancy.vacancyId))
    .sort();
  expect(initialVacancyIds).toEqual([
    'vacancy:initial:seat:admin_l2_0:1',
    'vacancy:initial:seat:admin_l3_0:1',
  ]);
  expect(asRecords(organization0.selections, 'selections')).toEqual([]);

  // 自然基层历练：任务批次、年度考核、试用期与职级晋升全部走真实入口。
  await go(page, '#/tasks');
  await page.getByTestId('start-task-task_induction_training-primary').click();
  await advanceClerkMonths(page, 180);
  const state180 = await savedState(page);
  expect(asRecord(state180.assessments, 'assessments').annualAssessments).toHaveLength(1);
  await advanceClerkMonths(page, 540);
  await ensureAssignedProjectDelivered(page);
  await go(page, '#/career');
  await page.getByTestId('advance-civil-service-rank').click();
  const state540 = await savedState(page);
  expect(asRecord(state540.career, 'career').civilServiceRank).toBe('clerk_1');
  await advanceClerkMonths(page, 930);

  // 只读断言：NPC 世界在玩家推进时间时自行演进（年度考核事实积累）。
  const state930 = await savedState(page);
  const organization930 = asRecord(state930.organization, 'organization');
  const luoXia = asRecords(organization930.cadres, 'cadres').find(
    (cadre) => cadre.cadreId === 'cadre_luo_xia',
  );
  if (!luoXia) throw new Error('Expected NPC cadre_luo_xia');
  expect(asRecords(luoXia.assessments, 'npc assessments').length).toBeGreaterThanOrEqual(2);
  const career930 = asRecord(state930.career, 'career');
  const specialties = asRecord(career930.specialties, 'specialties');
  expect(Number(specialties.local_governance ?? 0)).toBeGreaterThanOrEqual(60);

  // 等待在途任务完成（在途行动会阻止机会接受），再通过 UI 接受副职机会。
  while ((await currentDay(page)) < 985) await advanceOnce(page, 'month');
  await go(page, '#/career');
  const opportunityId = await page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    const parsed = JSON.parse(raw) as {
      state: {
        career: { opportunities: Array<{ definitionId: string; status: string; id: string }> };
      };
    };
    const opportunity = parsed.state.career.opportunities.find(
      (item) =>
        item.definitionId === 'township_deputy_leadership_vacancy' && item.status === 'available',
    );
    if (!opportunity) throw new Error('Expected an available deputy opportunity');
    return opportunity.id;
  });
  await setRng(page, 0.5);
  await page.getByTestId(`accept-opportunity-${opportunityId}`).click();
  await expect(page.getByText('当前选拔流程')).toBeVisible();

  // 冻结的候选池来自真实组织事实：玩家与 NPC 同池竞争。
  const selection = await page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    const parsed = JSON.parse(raw) as {
      state: { organization: { selections: JsonRecord[] } };
    };
    const selection = parsed.state.organization.selections.at(-1);
    if (!selection) throw new Error('Expected a Selection');
    return {
      status: selection.status,
      candidateTypes: (selection.candidates as JsonRecord[])
        .map((candidate) => candidate.candidateType)
        .sort(),
    };
  });
  expect(selection.status).toBe('active');
  expect(selection.candidateTypes).toEqual(['npc', 'player']);

  // 六个阶段全部由 UI 推进按钮结算（确定性随机输入）。
  await setRng(page, 0);
  for (let stage = 0; stage < 6; stage += 1)
    await page.getByTestId(`advance-career-process-${opportunityId}`).click();
  await setRng(page, 0.99);

  // 自然结果：当前配置下 NPC 年度考核复利更高，玩家落选、NPC 获任。
  await expect(page.getByTestId('selection-outcome')).toContainText('落选');
  const stateAfter = await savedState(page);
  const organizationAfter = asRecord(stateAfter.organization, 'organization');
  const careerAfter = asRecord(stateAfter.career, 'career');
  const finalSelection = asRecords(organizationAfter.selections, 'selections').at(-1);
  if (!finalSelection) throw new Error('Expected a completed Selection');
  expect(finalSelection.status).toBe('completed');
  expect(finalSelection.winnerId).toBe('cadre_luo_xia');
  const vacancies = asRecords(organizationAfter.vacancies, 'vacancies');
  const deputyVacancy = vacancies.find(
    (vacancy) => vacancy.vacancyId === 'vacancy:initial:seat:admin_l2_0:1',
  );
  if (!deputyVacancy) throw new Error('Expected deputy vacancy');
  expect(deputyVacancy.status).toBe('filled');
  expect(deputyVacancy.filledBy).toMatchObject({ type: 'npc', id: 'cadre_luo_xia' });
  // NPC 原岗位经同一级联 producer 释放新空缺（组织流动可级联）。
  const cascadeVacancy = vacancies.find((vacancy) =>
    String(vacancy.vacancyId).startsWith('vacancy:appointment:npc-appointment:cadre_luo_xia:0'),
  );
  if (!cascadeVacancy) throw new Error('Expected cascade vacancy on NPC old seat');
  expect(cascadeVacancy.status).toBe('open');
  expect(cascadeVacancy.sourceType).toBe('appointment');
  // 玩家落选后原任职保持不变，CareerProcess 与世界级 Selection 无双重结算。
  expect(asRecord(careerAfter.appointment, 'appointment')).toMatchObject({
    positionId: 'admin_l1_0',
    leadershipRank: 'none',
  });
  expect(careerAfter.activeProcess ?? null).toBeNull();

  // 刷新后选拔结果不漂移。
  await page.reload();
  await expect(page.getByTestId('selection-outcome')).toContainText('落选');

  // 推进过 2015 年 Congress 节点（第 900 天）：职业页显示真实政治周期状态。
  while ((await currentDay(page)) < 1120) await advanceOnce(page, 'month');
  await go(page, '#/career');
  await expect(page.getByTestId('political-cycle-status')).toBeVisible();
  await expect(page.getByTestId('political-cycle-status')).toContainText('第 1 届基层组织调整');
  const stateCycle = await savedState(page);
  const cycles = asRecords(asRecord(stateCycle.world, 'world').activeCycles, 'activeCycles');
  expect(cycles[0]).toMatchObject({ type: 'party_congress', termNumber: 1, startedAtDay: 900 });
  expect(consoleErrors).toEqual([]);
});
