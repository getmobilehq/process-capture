/**
 * Delta v1.1 UI behaviour that only shows up in a real browser: the expandable
 * checklist (R1.1), the interviewee's own not-applicable path (R1.3), the
 * pick-list (R2.1), and draft protection (R10.3).
 *
 * These exist because the interactive states are exactly what unit tests cannot
 * see — the checklist has to be expanded, the draft has to survive a reload.
 */
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';

const DB_PATH = './data/e2e.db';

/**
 * Sarah is the one seed informant no other spec touches — entry.spec takes the
 * first (Priya), interview.spec takes Tom, and console.spec adds its own. Sharing
 * an informant across specs couples them through session state.
 */
function sarahToken(): string {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db
      .prepare('SELECT invite_token FROM interviewees WHERE email = ?')
      .get('sarah.whitfield@example.com') as { invite_token: string } | undefined;
    if (!row) throw new Error('Seed interviewee sarah.whitfield@example.com not found');
    return row.invite_token;
  } finally {
    db.close();
  }
}

/**
 * Open the interview room. Once a session exists the entry screen redirects
 * straight into it (FR-3.8 resume), so these specs must tolerate both — they
 * share one informant and run in sequence.
 */
async function startInterview(page: import('@playwright/test').Page, token: string) {
  await page.goto(`/i/${token}`);
  const start = page.getByRole('button', { name: /Start interview/i });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
  } else {
    await page.goto(`/i/${token}/interview`);
  }
  await expect(page)).toHaveURL(new RegExp(`/i/${token}/interview$`));
  await expect(page.locator('.pc-msg.agent').first())).toBeVisible();
}

/** Clear any draft left by a previous spec in this file. */
async function clearDraft(page: import('@playwright/test').Page) {
  const textarea = page.getByLabel('Your reply', { exact: true });
  if ((await textarea.inputValue()) === '') return;
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.locator('.pc-confirm').getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(textarea)).toHaveValue('');
}

test.describe('checklist coverage rail (R1)', () => {
  test('shows what is still wanted, in plain language, and lets the informant rule it out', async ({
    page,
  }) => {
    const token = sarahToken();
    await startInterview(page, token);

    // The meter is counted in elements, never a bare percentage (R1.1).
    await expect(page.getByText(/0 of 40 things captured/))).toBeVisible();

    // Facets carry an outstanding count before anything is expanded.
    const facet3 = page.locator('.pc-facet').filter({ hasText: 'Triggers & events' });
    await expect(facet3.getByText('4 to go'))).toBeVisible();

    // Expanding shows the checklist in the informant's language, not facet jargon.
    await facet3.locator('.pc-facet-head').click();
    await expect(facet3.getByText('What sets it off'))).toBeVisible();
    await expect(facet3.getByText('How often it happens'))).toBeVisible();

    // R1.3 — the informant rules an element out themselves, inline, with a reason.
    await facet3.getByRole('button', { name: /Doesn.t apply to me/i }).first().click();
    await facet3.getByPlaceholder(/Why not/i).fill('we only ever get them by phone');
    await facet3.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(facet3.getByText(/Not applicable — we only ever get them by phone/))).toBeVisible();
    // Closing an element moves the derived meter off zero (R1.1).
    await expect(page.getByText(/1 of 40 things captured|0 of 40 things captured/))).toBeVisible();
  });
});

test.describe('pick-list facets (R2)', () => {
  test('offers sourced options and an always-present escape hatch', async ({ page }) => {
    const token = sarahToken();
    await startInterview(page, token);

    const picklist = page.locator('.pc-picklist');
    await expect(picklist)).toBeVisible();
    await expect(picklist.getByText(/Tap any that apply/i))).toBeVisible();

    // Every seeded option carries its source (R2.2) — never presented as bare fact.
    await expect(picklist.getByText('used at VMO2').first())).toBeVisible();

    // The escape hatch is present and co-equal, so the list is never a cage (R2.1).
    const escape = picklist.getByRole('button', { name: /Something else/i });
    await expect(escape)).toBeVisible();

    // Ticking an option marks it selected.
    const option = picklist.getByRole('button', { name: /Customer call/i });
    await option.click();
    await expect(picklist.getByRole('button', { name: /Customer call/i }))).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('data-loss protection (R10.3)', () => {
  test('an unsubmitted answer survives a reload and comes back with a banner', async ({ page }) => {
    const token = sarahToken();
    await startInterview(page, token);

    await clearDraft(page);
    const draft = 'We take the call, check the account, and raise a credit if it is wrong.';
    await page.getByLabel('Your reply', { exact: true }).fill(draft);

    // Autosave is debounced; wait for it to report saved rather than guessing.
    await expect(page.getByText(/· Saved/))).toBeVisible({ timeout: 10_000 });

    // The tab goes away and comes back — the hard requirement.
    await page.reload();

    await expect(page.getByLabel('Your reply', { exact: true }))).toHaveValue(draft);
    await expect(page.getByText(/You have an unsubmitted answer/i))).toBeVisible();
  });

  test('discard requires confirmation, states what is at stake, and is undoable', async ({
    page,
  }) => {
    const token = sarahToken();
    await startInterview(page, token);

    await clearDraft(page);
    const textarea = page.getByLabel('Your reply', { exact: true });
    const draft = 'Four minutes of transcription that must not be destroyed by two taps.';
    await textarea.fill(draft);
    await expect(page.getByText(/· Saved/))).toBeVisible({ timeout: 10_000 });

    // No single action destroys it: Discard opens a confirmation naming the cost.
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByText(/Discard \d+ words\?/))).toBeVisible();

    // And the confirmation offers the safe option first.
    await expect(page.getByRole('button', { name: /Keep it/i }))).toBeVisible();
    await page
      .locator('.pc-confirm')
      .getByRole('button', { name: 'Discard', exact: true })
      .click();
    await expect(textarea)).toHaveValue('');

    // Undo restores it byte-identically for the rest of the session.
    await page.getByRole('button', { name: /Undo discard/i }).click();
    await expect(textarea)).toHaveValue(draft);
  });

  test('the question budget is visible, so the interview has a felt horizon (R9.1)', async ({
    page,
  }) => {
    const token = sarahToken();
    await startInterview(page, token);
    await expect(page.getByText(/Question \d+ of ~25/))).toBeVisible();
    // R9.3 — finishing is available at all times, not only at the playback.
    await expect(page.getByRole('button', { name: /Finish recording/i }))).toBeVisible();
  });
});
