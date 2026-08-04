import { NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(`${origin}/console/login`, { status: 303 });
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
