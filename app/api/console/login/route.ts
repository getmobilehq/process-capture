import { seeOther } from '@/lib/origin';
import { clientIp } from '@/lib/rate-limit';
import { ADMIN_COOKIE, clearLoginAttempts, recordLoginAttempt, sessionToken, signIn } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ip = clientIp(req);

  const rl = await recordLoginAttempt(ip);
  if (!rl.allowed) {
    return seeOther('/console/login?error=rate');
  }

  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  // Email is optional: without one the shared ADMIN_PASSWORD path is tried, which
  // is how a deployment with no accounts yet still lets someone in to make them.
  const email = String(form.get('email') ?? '');

  const result = await signIn({ email, password });
  if (!result.ok) {
    return seeOther('/console/login?error=1');
  }

  await clearLoginAttempts(ip);
  const res = seeOther('/console');
  res.cookies.set(ADMIN_COOKIE, sessionToken(result.identity), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8, // 8-hour session
  });
  return res;
}
