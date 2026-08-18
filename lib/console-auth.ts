import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, assertSession, isValidSession } from './auth';

/**
 * Redirect to the login page unless a valid admin session is present.
 *
 * Synchronous, so it can be the first statement of any server component. It
 * checks the signature only — a disabled account is caught by `requireAdminAsync`
 * on the routes that act, which is where revocation has to bite.
 */
export function requireAdmin(): void {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!isValidSession(token)) redirect('/console/login');
}

/**
 * Revocation-aware check for anything that writes or reveals. Disabling an
 * account must end its access, not merely anonymise what it does next.
 */
export async function requireAdminAsync(): Promise<void> {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!(await assertSession(token))) redirect('/console/login');
}

export function isAdmin(): boolean {
  return isValidSession(cookies().get(ADMIN_COOKIE)?.value);
}
