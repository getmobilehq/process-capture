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

/**
 * Is this request coming from a page this app served?
 *
 * The cross-site request forgery defence for the API routes. Cookies do the
 * authenticating — the console session and the informant cookie — and a cookie is
 * attached by the browser whoever caused the request, so another site's form can
 * post to us *as the signed-in person* unless something checks where the request
 * came from. `SameSite=lax` covers most of it; this covers the rest, including
 * login itself, where there is no session yet to protect but an attacker can still
 * force a victim into *their* account and watch what gets typed into it.
 *
 * Compared against `x-forwarded-host` first, because behind Cloud Run `host` is
 * the container's internal name and would never match the browser's `Origin` —
 * the same trap that broke the login redirect (see `seeOther`).
 *
 * Absent `Origin` fails closed. Every browser sends it on POST; something that
 * does not is not the browser session these routes are written for. Routes
 * authenticated by a header token instead of a cookie (the retention sweep) are
 * not CSRF-able and deliberately do not call this.
 */
export function isSameOrigin(req: Request): boolean {
  const stated = req.headers.get('origin') ?? req.headers.get('referer');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!stated || !host) return false;
  try {
    return new URL(stated).host === host;
  } catch {
    return false;
  }
}

/** Guard for a mutating route: a rejection to return, or null to carry on. */
export function rejectCrossOrigin(req: Request): NextResponse | null {
  if (isSameOrigin(req)) return null;
  return NextResponse.json({ error: 'Request did not come from this site.' }, { status: 403 });
}
