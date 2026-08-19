import { test, expect, type Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { query } from './db';

/**
 * Console account management (August 2026).
 *
 * The guards are the point of these tests: a page that creates console accounts
 * turns a stolen eight-hour session into permanent access unless something stops
 * it. Two things do — only a named account may create accounts, and the acting
 * person re-enters their own password.
 */
async function signInShared(page: Page) {
  await page.goto('/console');
  await expect(page).toHaveURL(/\/console\/login/);
  await page.locator('input[name="password"]').fill('test-admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/console$/);
}

async function signInNamed(page: Page, email: string, password: string) {
  await page.goto('/console/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/console$/);
}

test('a shared-password session can see People but cannot create accounts', async ({ page }) => {
  await signInShared(page);
  await page.getByRole('link', { name: 'People' }).click();
  await expect(page).toHaveURL(/\/console\/team$/);

  // The form is not offered, and the reason is stated rather than implied.
  await expect(page.locator('input[name="name"]')).toHaveCount(0);
  await expect(page.getByText(/signed in with the shared password/i).first()).toBeVisible();
});

test('a named account creates another, and the password is shown once', async ({ page }) => {
  // Bootstrap a named account directly, the way the CLI or job would.
  const email = `founder-${Date.now()}@example.com`;
  const password = 'founder-password';
  await query(
    `INSERT INTO console_users (id, email, name, password_hash, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', 'test', now(), now())`,
    [`u${Date.now()}`, email, 'Founder Person', bcrypt.hashSync(password, 10)],
  );

  await signInNamed(page, email, password);
  await page.goto('/console/team');

  // The page has two forms (add, reset), so scope to the one under test.
  const addForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create account' }) });

  // Wrong confirmation password is refused — a stolen cookie is not enough.
  const newEmail = `colleague-${Date.now()}@example.com`;
  await addForm.locator('input[name="name"]').fill('New Colleague');
  await addForm.locator('input[name="email"]').fill(newEmail);
  await addForm.locator('input[name="confirmPassword"]').fill('not-my-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/password was not recognised/i)).toBeVisible();

  const notCreated = await query('SELECT id FROM console_users WHERE email = $1', [newEmail]);
  expect(notCreated).toHaveLength(0);

  // With the right one, the account is created and its password shown once.
  const addAgain = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create account' }) });
  await addAgain.locator('input[name="name"]').fill('New Colleague');
  await addAgain.locator('input[name="email"]').fill(newEmail);
  await addAgain.locator('input[name="confirmPassword"]').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText(new RegExp(`Password for ${newEmail}`, 'i'))).toBeVisible();
  const shown = await page.locator('.pc-newcred-value').innerText();
  expect(shown.length).toBeGreaterThan(16);

  // Stored as a hash, never in the clear, and attributed to its creator.
  const rows = await query<{ password_hash: string; created_by: string }>(
    'SELECT password_hash, created_by FROM console_users WHERE email = $1',
    [newEmail],
  );
  expect(rows[0].password_hash).not.toContain(shown);
  expect(rows[0].password_hash.startsWith('$2')).toBe(true);
  expect(rows[0].created_by).toBe('Founder Person');

  // And the new account can actually sign in with what was displayed.
  await page.goto('/api/console/logout');
  await signInNamed(page, newEmail, shown);
  await expect(page).toHaveURL(/\/console$/);
});

test('you cannot disable your own account and lock yourself out', async ({ page }) => {
  const email = `solo-${Date.now()}@example.com`;
  const password = 'solo-password';
  await query(
    `INSERT INTO console_users (id, email, name, password_hash, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', 'test', now(), now())`,
    [`s${Date.now()}`, email, 'Solo Person', bcrypt.hashSync(password, 10)],
  );

  await signInNamed(page, email, password);
  await page.goto('/console/team');

  // No Disable control is offered against your own row.
  const ownRow = page.locator('tr', { hasText: email });
  await expect(ownRow.getByRole('button', { name: 'Disable' })).toHaveCount(0);
});
