/** 浏览器验收：新录用试用期从建档、履约到转正并刷新恢复。 */

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
  await page.getByTestId('character-name').fill('试用干部');
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

async function accelerateToDay350(page: Page): Promise<void> {
  await page.evaluate(() => {
    const raw = localStorage.getItem('zhengtu_autosave');
    if (!raw) throw new Error('Expected a local save');
    const envelope = JSON.parse(raw) as { state: JsonRecord };
    const time = envelope.state.time as JsonRecord;
    Object.assign(time, { year: 2013, month: 6, day: 21, totalDaysPlayed: 350 });
    localStorage.setItem('zhengtu_autosave', JSON.stringify(envelope));
  });
  await page.reload();
}

test('建档、完成最低要求、跨到期日转正并刷新保持', async ({ page }) => {
  await createCharacter(page);
  await page.goto('/#/career');
  await expect(page.getByTestId('probation-status-card')).toBeVisible();
  await expect(page.getByTestId('probation-status')).toHaveText('试用中');

  await page.goto('/#/tasks');
  await expect(page.getByTestId('personal-task-task_policy_study')).toBeVisible();
  await page.getByTestId('start-task-task_policy_study-primary').click();
  await page.goto('/#/main');
  await page.getByTestId('advance-month').click();

  let state = await savedState(page);
  let career = asRecord(state.career, 'career');
  let appointment = asRecord(career.appointment, 'appointment');
  let probation = asRecord(appointment.probation, 'probation');
  expect(probation.completedActionCount).toBe(1);
  const identity = {
    appointmentId: appointment.appointmentId,
    positionId: appointment.positionId,
    institutionId: appointment.institutionId,
    leadershipRank: appointment.leadershipRank,
    civilServiceRank: career.civilServiceRank,
  };

  await accelerateToDay350(page);
  await page.goto('/#/main');
  await page.getByTestId('advance-month').click();
  state = await savedState(page);
  career = asRecord(state.career, 'career');
  appointment = asRecord(career.appointment, 'appointment');
  probation = asRecord(appointment.probation, 'probation');
  expect(probation.status).toBe('passed');
  expect(probation.resolvedAtDay).toBe(360);
  expect({
    appointmentId: appointment.appointmentId,
    positionId: appointment.positionId,
    institutionId: appointment.institutionId,
    leadershipRank: appointment.leadershipRank,
    civilServiceRank: career.civilServiceRank,
  }).toEqual(identity);

  await page.goto('/#/career');
  await expect(page.getByTestId('probation-status')).toHaveText('已转正');
  await expect(page.getByTestId('probation-feedback')).toContainText('正式转正');
  await page.reload();
  await expect(page.getByTestId('probation-status')).toHaveText('已转正');
  state = await savedState(page);
  career = asRecord(state.career, 'career');
  appointment = asRecord(career.appointment, 'appointment');
  expect({
    appointmentId: appointment.appointmentId,
    positionId: appointment.positionId,
    institutionId: appointment.institutionId,
    leadershipRank: appointment.leadershipRank,
    civilServiceRank: career.civilServiceRank,
  }).toEqual(identity);
});
