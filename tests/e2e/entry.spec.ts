import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';

const DB_PATH = './data/e2e.db';

function readDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH, { readonly: false });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function firstToken(): string {
  return readDb((db) => {
    const row = db.prepare('SELECT invite_token FROM interviewees ORDER BY created_at LIMIT 1').get() as
      | { invite_token: string }
      | undefined;
    if (!row) throw new Error('No seeded interviewee found in e2e.db');
    return row.invite_token;
  });
}

test('unknown token shows a polite dead-end', async ({ page }) => {
  await page.goto('/i/definitely-not-a-real-token');
  await expect(page.getByText(/don’t recognise this link/i)).toBeVisible();
});

test('valid token renders the entry screen', async ({ page }) => {
  await page.goto(`/i/${firstToken()}`);
  await expect(page.getByRole('heading', { name: /Before you start\./ })).toBeVisible();
  await expect(page.getByText(/No screen recording, no monitoring/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Start interview/i })).toBeVisible();
});

test('starting creates a session row and lands on the interview', async ({ page }) => {
  const token = firstToken();

  const before = readDb(
    (db) =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM sessions s
             JOIN interviewees i ON i.id = s.interviewee_id
             WHERE i.invite_token = ?`,
          )
          .get(token) as { n: number }
      ).n,
  );

  await page.goto(`/i/${token}`);
  await page.getByRole('button', { name: /Start interview/i }).click();

  await expect(page).toHaveURL(new RegExp(`/i/${token}/interview$`));
  await expect(page.getByLabel('Coverage')).toBeVisible();

  const after = readDb(
    (db) =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM sessions s
             JOIN interviewees i ON i.id = s.interviewee_id
             WHERE i.invite_token = ?`,
          )
          .get(token) as { n: number }
      ).n,
  );

  expect(after).toBe(before + 1);
});
