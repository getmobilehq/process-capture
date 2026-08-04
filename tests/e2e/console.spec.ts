import { test, expect, type Page } from '@playwright/test';
import { one, query } from './db';


async function tokensForProject(projectId: string): Promise<string[]> {
  const rows = await query<{ invite_token: string }>(
    'SELECT invite_token FROM interviewees WHERE project_id = $1 ORDER BY created_at',
    [projectId],
  );
  return rows.map((r) => r.invite_token);
}

async function login(page: Page) {
  await page.goto('/console');
  await expect(page).toHaveURL(/\/console\/login/);
  await page.locator('input[name="password"]').fill('test-admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/console$/);
}

async function addInterviewee(page: Page, name: string, email: string, role: string) {
  await page.locator('input[name="fullName"]').fill(name);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="role"]').fill(role);
  await page.getByRole('button', { name: /Add.*issue link/i }).click();
  await expect(page.getByText(name)).toBeVisible();
}

async function runMockedInterview(page: Page, token: string) {
  await page.goto(`/i/${token}`);
  await page.getByRole('button', { name: /Start interview/i }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${token}/interview$`));
  const textarea = page.getByLabel('Your reply', { exact: true });
  const send = page.getByRole('button', { name: /Submit answer/i });
  for (let i = 0; i < 16; i += 1) {
    await textarea.fill(`Answer ${i}`);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/turn') && r.request().method() === 'POST'),
      send.click(),
    ]);
    if ((await resp.json())?.review) break;
  }
  await page.getByRole('button', { name: /finish/i }).click();
  await expect(page.getByText(/Your interview is complete/i)).toBeVisible();
}

test('console: create campaign, issue links, interviews complete, conflict surfaces + raises', async ({
  page,
}) => {
  await login(page);

  // Create a fresh campaign.
  await page.locator('input[name="name"]').fill('Network operations');
  await page.locator('input[name="department"]').fill('Network operations');
  await page.locator('textarea[name="targetProcesses"]').fill('Fault triage');
  await page.getByRole('button', { name: /Create campaign/i }).click();

  await expect(page).toHaveURL(/\/console\/projects\/[^/]+$/);
  const projectId = page.url().split('/console/projects/')[1].split('?')[0];

  // Add two interviewees with different roles (so facet 6 rules differ).
  await addInterviewee(page, 'Alice Advisor', 'alice@ex.com', 'Complaints advisor');
  await addInterviewee(page, 'Mandy Manager', 'mandy@ex.com', 'Team leader');

  // Each gets a unique invite link (copy-to-clipboard control present).
  await expect(page.getByRole('button', { name: /Copy link/i })).toHaveCount(2);

  // Run both mocked interviews to completion.
  const tokens = await tokensForProject(projectId);
  expect(tokens).toHaveLength(2);
  for (const token of tokens) await runMockedInterview(page, token);

  // Register shows coverage and downloadable specs (FR-1.4).
  await page.goto(`/console/projects/${projectId}?tab=register`);
  // R5.6 — the register now opens the spec detail page rather than downloading
  // straight away; the download lives there alongside the process map.
  const specLinks = page.getByRole('link', { name: /Open spec v1/i });
  await expect(specLinks).toHaveCount(2);

  await specLinks.first().click();
  await expect(page).toHaveURL(/\/console\/sessions\//);
  await expect(page.getByRole('tab', { name: /Specification/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Process map/i })).toBeVisible();
  await page.goBack();
  await expect(page.getByText(/11 answered/).first()).toBeVisible();

  // A candidate conflict surfaces on facet 6 across the two informants (FR-1.6).
  await page.goto(`/console/projects/${projectId}?tab=conflicts`);
  const facet6 = page.locator('[data-conflict-facet="6"]');
  await expect(facet6).toBeVisible();
  await expect(facet6.getByText(/Alice Advisor/)).toBeVisible();
  await expect(facet6.getByText(/Mandy Manager/)).toBeVisible();

  // Raise it as a finding.
  await facet6.getByRole('button', { name: /Raise as finding/i }).click();

  // The candidate_conflict finding now appears in Findings.
  await page.goto(`/console/projects/${projectId}?tab=findings`);
  await expect(page.locator('span.tag').filter({ hasText: /candidate conflict/i })).toBeVisible();
  await expect(page.getByText(/Conflicting statements on Business rules/i)).toBeVisible();
});
