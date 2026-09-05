/** 新工作台验收：响应式导航、真实任务进度、主题持久化和存档续玩。 */
import { expect, test, type Page } from '@playwright/test';

async function createCharacter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByTestId('character-name').fill('林知行');
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page
    .locator('main')
    .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}

for (const width of [1440, 900, 390, 320]) {
  test(`工作台 ${width}px：建档、全部导航、亮暗主题与续玩`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expectNoHorizontalOverflow(page);
    if (width === 1440)
      await page.screenshot({ path: testInfo.outputPath('splash.png'), fullPage: true });
    await createCharacter(page);
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: testInfo.outputPath('workspace-light.png') });
    const nav = page.getByRole('navigation', { name: '工作台导航' });
    const routes = [
      ['任务', '个人任务'],
      ['部门治理', '部门治理'],
      ['年度考核', 'KPI 考核'],
      ['职务职级', '职务与职级'],
      ['政策', '政策治理'],
      ['事件', '事件中心'],
      ['工作台', '工作台'],
    ];
    for (const [label, heading] of routes) {
      if (!label || !heading) throw new Error('Expected navigation labels');
      const link = nav.getByRole('link', { name: label, exact: true });
      await link.click();
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    if (width === 1440) await page.screenshot({ path: testInfo.outputPath('workspace-dark.png') });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('link', { name: '返回游戏首页', exact: true }).click();
    await page.getByRole('button', { name: /继续游戏/ }).click();
    await expect(page.getByRole('heading', { name: '林知行，欢迎回到工作台。' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('日程无需刷新即可更新进度、剩余天数和占用数', async ({ page }) => {
  await createCharacter(page);
  await page.getByRole('button', { name: '安排主要日程', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '个人任务', exact: true })).toBeVisible();
  await page.getByTestId('start-task-task_policy_brief-primary').click();
  await page.getByRole('navigation').getByRole('link', { name: '工作台', exact: true }).click();
  await expect(page.getByTestId('schedule-count-primary')).toHaveText('1/3');
  const task = page.locator('.schedule-item');
  await expect(task).toContainText('剩余 3 天');
  await page.getByTestId('advance-day').click();
  await expect(task).toContainText('剩余 2 天');
  await expect(task.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  await page.getByTestId('advance-day').click();
  await expect(task).toContainText('剩余 1 天');
  await expect(task.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
  await page.reload();
  await expect(task).toContainText('剩余 1 天');
  await page.getByTestId('advance-day').click();
  await expect(task).toHaveCount(0);
  await expect(page.getByTestId('schedule-count-primary')).toHaveText('0/3');
  await expect(
    page.locator('.overview-metric', { hasText: '已完成个人任务' }).locator('strong'),
  ).toHaveText('1项');
});

for (const theme of ['light', 'dark'] as const) {
  test(`风险徽章在 ${theme} 主题中保留红色语义`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await createCharacter(page);
    if (theme === 'dark') await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('navigation').getByRole('link', { name: '年度考核', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // 新角色的真实初始 KPI 属于最低等级；验证浏览器最终绘制颜色，而非只检查类名。
    const badge = page.getByText('不称职', { exact: true });
    await expect(badge).toBeVisible();
    const expected = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-danger)';
      probe.style.backgroundColor = 'var(--color-danger-soft)';
      document.body.append(probe);
      const computed = getComputedStyle(probe);
      const colors = { color: computed.color, background: computed.backgroundColor };
      probe.remove();
      return colors;
    });
    await expect(badge).toHaveCSS('color', expected.color);
    await expect(badge).toHaveCSS('background-color', expected.background);
    const channels = expected.color.match(/\d+/g)?.map(Number);
    expect(channels?.length).toBeGreaterThanOrEqual(3);
    const [red = 0, green = 0, blue = 0] = channels ?? [];
    expect(red).toBeGreaterThan(green);
    expect(red).toBeGreaterThan(blue);
  });
}
