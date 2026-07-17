import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, isValidSession } from './auth';

/** Redirect to the login page unless a valid admin session cookie is present. */
export function requireAdmin(): void {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!isValidSession(token)) redirect('/console/login');
}

export function isAdmin(): boolean {
  return isValidSession(cookies().get(ADMIN_COOKIE)?.value);
}
