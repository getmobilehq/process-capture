import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/console');
  await expect(page).toHaveURL(/\/console\/login/);
  await page.locator('input[name="password"]').fill('test-admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/console$/);
}

test('archive a target process, then restore it', async ({ page }) => {
  await login(page);

  await page.locator('input[name="name"]').fill('Field operations');
  await page.locator('input[name="department"]').fill('Field operations');
  await page.locator('textarea[name="targetProcesses"]').fill('Fault triage\nEngineer dispatch');
  await page.getByRole('button', { name: /Create campaign/i }).click();
  await expect(page).toHaveURL(/\/console\/projects\/[^/]+$/);

  const processes = page.locator('.pc-proclist:not(.archived) li');
  await expect(processes).toHaveCount(2);

  // Archive the first one.
  await processes
    .filter({ hasText: 'Fault triage' })
    .getByRole('button', { name: 'Archive' })
    .click();

  // It leaves the live list and appears under Archived — not deleted.
  await expect(page.locator('.pc-proclist:not(.archived) li')).toHaveCount(1);
  await expect(page.locator('.pc-proclist:not(.archived)')).not.toContainText('Fault triage');
  await expect(page.locator('.pc-archived summary')).toContainText('Archived (1)');
  await expect(page.locator('.pc-proclist.archived')).toContainText('Fault triage');
  await expect(page.locator('.pc-proclist.archived')).toContainText('kept, not deleted');

  // An archived process is no longer offered to a new interviewee.
  await page.locator('input[name="fullName"]').fill('Nadia Field');
  await page.locator('input[name="email"]').fill('nadia@ex.com');
  await page.locator('input[name="role"]').fill('Field engineer');
  await page.getByRole('button', { name: /Add.*issue link/i }).click();

  const token = await page.evaluate(async () => {
    const res = await fetch(window.location.href);
    return (await res.text()).match(/\/i\/([A-Za-z0-9_-]{20,})/)?.[1] ?? '';
  });
  expect(token).not.toBe('');
  await page.goto(`/i/${token}`);
  // The live process plus the always-present "Something else" escape hatch (R2.1).
  const options = page.locator('select[name="processName"] option');
  await expect(options).toHaveText(['Engineer dispatch', 'Something else']);

  // Restore puts it back on offer.
  await page.goBack();
  await page.locator('.pc-archived summary').click();
  await page
    .locator('.pc-proclist.archived li')
    .filter({ hasText: 'Fault triage' })
    .getByRole('button', { name: 'Restore' })
    .click();

  await expect(page.locator('.pc-proclist:not(.archived) li')).toHaveCount(2);
  await expect(page.locator('.pc-archived')).toHaveCount(0);
});
