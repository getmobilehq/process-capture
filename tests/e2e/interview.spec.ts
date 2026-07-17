import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';

const DB_PATH = './data/e2e.db';

function lastToken(): string {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db
      .prepare('SELECT invite_token FROM interviewees ORDER BY created_at DESC LIMIT 1')
      .get() as { invite_token: string } | undefined;
    if (!row) throw new Error('No seeded interviewee found');
    return row.invite_token;
  } finally {
    db.close();
  }
}

function sessionFor(token: string): { id: string; status: string } | undefined {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT s.id, s.status FROM sessions s
         JOIN interviewees i ON i.id = s.interviewee_id
         WHERE i.invite_token = ? ORDER BY s.created_at DESC LIMIT 1`,
      )
      .get(token) as { id: string; status: string } | undefined;
  } finally {
    db.close();
  }
}

test('golden path: mocked interview reaches review with 11 answered + 1 unknown', async ({ page }) => {
  const token = lastToken();

  // Start the interview.
  await page.goto(`/i/${token}`);
  await page.getByRole('button', { name: /Start interview/i }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${token}/interview$`));

  // The opening question is present before any input.
  await expect(page.locator('.pc-msg.agent').first()).toBeVisible();

  const textarea = page.getByLabel('Your reply');
  const send = page.getByRole('button', { name: 'Send' });

  let final: {
    review: boolean;
    status: string;
    coverage: { facetId: number; state: string }[];
  } | null = null;

  for (let i = 0; i < 16; i += 1) {
    await textarea.fill(`Here is my answer number ${i}.`);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/turn') && r.request().method() === 'POST'),
      send.click(),
    ]);
    final = await resp.json();
    if (final?.review) break;
  }

  expect(final).not.toBeNull();
  expect(final!.review).toBe(true);
  expect(final!.status).toBe('review');

  const answered = final!.coverage.filter((c) => c.state === 'answered').length;
  const unknown = final!.coverage.filter((c) => c.state === 'unknown_to_informant').length;
  const pendingOrPartial = final!.coverage.filter(
    (c) => c.state === 'pending' || c.state === 'partial',
  ).length;
  expect(answered).toBe(11);
  expect(unknown).toBe(1);
  expect(pendingOrPartial).toBe(0);

  // UI reflects review and full coverage.
  await expect(page.getByText(/12\/12 resolved/)).toBeVisible();
  expect(sessionFor(token)!.status).toBe('review');

  // Confirm the review → interview completes and a spec is generated (FR-4.2, FR-5).
  await page.getByRole('button', { name: /finish/i }).click();
  await expect(page.getByText(/Your interview is complete/i)).toBeVisible();

  const session = sessionFor(token)!;
  expect(session.status).toBe('complete');

  // The generated spec downloads and honours provenance (P4) and email absence (P7).
  const specRes = await page.request.get(`/api/spec/${session.id}`);
  expect(specRes.ok()).toBeTruthy();
  const md = await specRes.text();
  expect(md).toMatch(/^provenance: stated$/m);
  expect(md).not.toContain('@example.com');
});
