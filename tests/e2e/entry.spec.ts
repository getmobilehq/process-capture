import { test, expect } from '@playwright/test';
import { one } from './db';

async function firstToken(): Promise<string> {
  const row = await one<{ invite_token: string }>(
    'SELECT invite_token FROM interviewees ORDER BY created_at LIMIT 1',
  );
  if (!row) throw new Error('No seeded interviewee found');
  return row.invite_token;
}

/** Sessions belonging to an invite token — used to prove one was created. */
async function sessionCount(token: string): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT COUNT(*) AS n FROM sessions s
     JOIN interviewees i ON i.id = s.interviewee_id
     WHERE i.invite_token = $1`,
    [token],
  );
  return Number(row?.n ?? 0);
}

test('unknown token shows a polite dead-end', async ({ page }) => {
  await page.goto('/i/definitely-not-a-real-token');
  await expect(page.getByText(/don’t recognise this link/i)).toBeVisible();
});

test('valid token renders the entry screen', async ({ page }) => {
  await page.goto(`/i/${await firstToken()}`);
  await expect(page.getByRole('heading', { name: /Before you start\./ })).toBeVisible();
  await expect(page.getByText(/No screen recording, no monitoring/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Start interview/i })).toBeVisible();
});

test('starting creates a session row and lands on the interview', async ({ page }) => {
  const token = await firstToken();

  const before = await sessionCount(token);

  await page.goto(`/i/${token}`);
  await page.getByRole('button', { name: /Start interview/i }).click();

  await expect(page).toHaveURL(new RegExp(`/i/${token}/interview$`));
  await expect(page.getByLabel('Coverage')).toBeVisible();

  const after = await sessionCount(token);

  expect(after).toBe(before + 1);
});
