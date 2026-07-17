import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  clearLoginAttempts,
  recordLoginAttempt,
  sessionToken,
  verifyPassword,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'local';
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const ip = clientIp(req);

  const rl = recordLoginAttempt(ip);
  if (!rl.allowed) {
    return NextResponse.redirect(`${origin}/console/login?error=rate`, { status: 303 });
  }

  const form = await req.formData();
  const password = String(form.get('password') ?? '');

  if (!verifyPassword(password)) {
    return NextResponse.redirect(`${origin}/console/login?error=1`, { status: 303 });
  }

  clearLoginAttempts(ip);
  const res = NextResponse.redirect(`${origin}/console`, { status: 303 });
  res.cookies.set(ADMIN_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8, // 8-hour session
  });
  return res;
}
