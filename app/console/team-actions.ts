'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ADMIN_COOKIE,
  generatePassword,
  hashPassword,
  identityFromSession,
  signIn,
} from '@/lib/auth';
import {
  createConsoleUser,
  findConsoleUserByEmail,
  updateConsoleUser,
} from '@/lib/db/queries';

/**
 * Console account management from the console (August 2026).
 *
 * This reverses DL.100, which kept account creation on the CLI on the grounds
 * that a page for making console accounts is a privilege escalation waiting to be
 * found. That reasoning still holds and is answered rather than dismissed:
 *
 *  1. **Only a named account may create accounts.** A session on the shared
 *     `ADMIN_PASSWORD` cannot — otherwise one shared password becomes a factory
 *     for permanent, individually-attributed ones, which is worse than the
 *     problem named accounts were built to solve.
 *  2. **The acting person re-enters their own password.** A stolen session cookie
 *     is enough to read the console for eight hours; it must not be enough to mint
 *     access that outlives it. This is the specific escalation a page introduces,
 *     so it is the specific thing guarded.
 *
 * The generated password is returned through the page once and never stored in
 * the clear, never logged, and never emailed.
 */
async function actingUser() {
  const identity = await identityFromSession(cookies().get(ADMIN_COOKIE)?.value);
  if (!identity) redirect('/console/login');
  return identity;
}

/** Re-authenticate the person acting, not merely the session they are holding. */
async function confirmIdentity(
  identity: { email: string | null },
  password: string,
): Promise<boolean> {
  if (!identity.email || !password) return false;
  const result = await signIn({ email: identity.email, password });
  return result.ok;
}

function back(params: Record<string, string>): never {
  redirect(`/console/team?${new URLSearchParams(params).toString()}`);
}

export async function addConsoleUserAction(formData: FormData): Promise<void> {
  const identity = await actingUser();
  if (!identity.userId) back({ error: 'shared' });

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (!email || !name) back({ error: 'missing' });
  if (!(await confirmIdentity(identity, confirm))) back({ error: 'confirm' });
  if (await findConsoleUserByEmail(email)) back({ error: 'exists' });

  const password = generatePassword();
  await createConsoleUser({
    email,
    name,
    passwordHash: hashPassword(password),
    createdBy: identity.displayName,
  });

  // Through the URL so it renders once and is not persisted anywhere. It is in
  // the architect's own address bar and history — acceptable for a value they are
  // about to hand over, and the alternative is storing it.
  back({ created: email, password });
}

export async function resetConsoleUserAction(formData: FormData): Promise<void> {
  const identity = await actingUser();
  if (!identity.userId) back({ error: 'shared' });

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const confirm = String(formData.get('confirmPassword') ?? '');
  if (!(await confirmIdentity(identity, confirm))) back({ error: 'confirm' });

  const user = await findConsoleUserByEmail(email);
  if (!user) back({ error: 'missing' });

  const password = generatePassword();
  await updateConsoleUser(user.id, { passwordHash: hashPassword(password) });
  back({ created: email, password });
}

export async function setConsoleUserStatusAction(formData: FormData): Promise<void> {
  const identity = await actingUser();
  if (!identity.userId) back({ error: 'shared' });

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const status = String(formData.get('status') ?? '') === 'disabled' ? 'disabled' : 'active';

  const user = await findConsoleUserByEmail(email);
  if (!user) back({ error: 'missing' });

  // Disabling yourself ends your own session immediately (assertSession refuses a
  // disabled account) and, if you are the only active account, locks everyone out
  // of account management. Refuse it rather than let someone find out.
  if (user.id === identity.userId) back({ error: 'self' });

  await updateConsoleUser(user.id, { status });
  back({ status: `${email}:${status}` });
}
