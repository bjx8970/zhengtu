/** 浏览器验收：科员阶段个人任务制——承接、推进交付、KPI 台账与部门治理封禁。 */

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

async function createCharacter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByTestId('character-name').fill('科员干部');
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

async function savedState(page: Page): Promise<JsonRecord> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    return (JSON.parse(raw) as { state: JsonRecord }).state;
  });
}

test('科员以个人任务完成工作循环且看不到部门治理行动', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await createCharacter(page);

  // 无领导职务：部门治理页转只读，不提供治理行动入口
  await page.goto('/#/departments');
  await expect(page.getByTestId('departments-readonly-notice')).toBeVisible();
  await expect(page.locator('[data-testid^="start-action-"]')).toHaveCount(0);

  // 主页以个人任务为第一政务入口，科员不展示部门治理入口卡
  await page.goto('/#/main');
  await expect(page.locator('.choice-card', { hasText: '个人任务' })).toBeVisible();
  await expect(page.locator('.choice-card', { hasText: '部门治理' })).toHaveCount(0);

  // 承接 3 天日常任务（政策解读简报 → 办公效率 +3）
  await page.goto('/#/tasks');
  await expect(page.getByTestId('personal-task-task_policy_brief')).toBeVisible();
  await expect(page.getByTestId('task-cost-task_policy_brief')).toHaveText('成本 5万');
  const budgetBefore = Number((await savedState(page)).remainingBudget);
  await page.getByTestId('start-task-task_policy_brief-primary').click();
  let state = await savedState(page);
  expect(state.remainingBudget).toBe(budgetBefore - 5);

  // 推进一周交付：效果 + KPI 台账 + 完成计数 + task.completed 信号链路
  await page.goto('/#/main');
  await page.getByTestId('advance-week').click();

  state = await savedState(page);
  const actions = asRecord(state.actions, 'actions');
  const personalTasks = asRecord(actions.personalTasks, 'personal tasks');
  expect(personalTasks.totalCompleted).toBe(1);
  expect(asRecord(personalTasks.completedCounts, 'completed counts').task_policy_brief).toBe(1);
  const departmentStates = asRecord(actions.departmentStates, 'department states');
  const ledger = asRecord(departmentStates.personal_work, 'personal work ledger');
  expect(asRecord(ledger.kpiValues, 'ledger kpi values').office_efficiency).toBe(3);
  const notifications = actions.lastCompletedActions as JsonRecord[];
  expect(
    notifications.some(
      (item) => item.actionName === '政策解读简报' && item.deptName === '个人任务',
    ),
  ).toBe(true);

  // 刷新后状态保持（localStorage + 存档解码）
  await page.reload();
  await page.goto('/#/tasks');
  await expect(page.getByTestId('personal-task-task_policy_brief')).toBeVisible();
  state = await savedState(page);
  expect(
    asRecord(asRecord(state.actions, 'actions').personalTasks, 'personal tasks').totalCompleted,
  ).toBe(1);

  expect(consoleErrors).toEqual([]);
});
