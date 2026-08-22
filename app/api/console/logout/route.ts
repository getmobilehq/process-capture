import { isSameOrigin, seeOther } from '@/lib/origin';
import { ADMIN_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  // Forced logout is only a nuisance, but the check costs a line and the rule
  // "every cookie-authenticated POST verifies where it came from" is easier to
  // keep than a list of exceptions.
  if (!isSameOrigin(req)) return seeOther('/console');

  const res = seeOther('/console/login');
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
