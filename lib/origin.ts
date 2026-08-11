/**
 * Where this instance believes it lives, for minting invite links.
 *
 * `BASE_URL` wins when it is set — an explicit setting should always beat a
 * guess, and a custom domain is exactly that setting. When it is not set we read
 * the origin off the request the architect is already making, which removes a
 * genuine deployment awkwardness: the platform assigns a URL at create time, so
 * configuring it ahead of time means either deploying twice or hard-coding a URL
 * nobody has yet. Deriving it means one deploy, and links that match whichever
 * hostname the architect actually reached the console on.
 *
 * Server-side only — it reads request headers.
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { config } from './config';

export function originFromRequest(): string {
  if (process.env.BASE_URL) return config.baseUrl.replace(/\/+$/, '');

  const h = headers();
  // Cloud Run and every other managed proxy terminate TLS and forward these.
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return config.baseUrl.replace(/\/+$/, '');

  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * A 303 redirect to a path on this app, with a **relative** Location header.
 *
 * Deliberately not `NextResponse.redirect`, which demands an absolute URL and so
 * forces you to name an origin. Behind a proxy — Cloud Run, a load balancer,
 * anything — `new URL(req.url).origin` is the *internal* address the proxy
 * forwards to, not the address the browser used. Redirecting there sends the
 * browser to `localhost:3000`, and a `form-action 'self'` CSP correctly refuses
 * it, which is how this surfaced: a login form that silently did nothing.
 *
 * A relative Location sidesteps the question entirely (RFC 7231 §7.1.2).
 */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
