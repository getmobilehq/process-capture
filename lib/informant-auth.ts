/**
 * Binds an interview request to the person holding the invite link.
 *
 * The interview API used to authorise on the session id alone: possession of the
 * id *was* the permission. The ids are unguessable (nanoid, ~126 bits), so this
 * was never enumerable — but a session id is not treated as a secret anywhere. It
 * sits in the path of every request the informant makes, which puts it in every
 * access log, proxy log, browser history and support screenshot. The invite token
 * is the thing actually issued to a named person; the session id is a row key that
 * happened to be doing a credential's job.
 *
 * What made that urgent rather than theoretical: `POST /confirm` would end
 * someone's interview, spend a dozen model calls generating their specification,
 * and mark their invite token used — permanently, with nothing in the console to
 * re-issue it. One unauthenticated request, from anyone who had seen an id.
 *
 * So: a signed, httpOnly cookie is set when the interview starts, naming the
 * session it is for. The routes require it. Nothing about the informant's
 * experience changes — they arrive through `/i/{token}`, which sets it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';

export const INFORMANT_COOKIE = 'pc_informant';

/**
 * Long-lived on purpose. An interview is resumable for as long as the invite link
 * is valid, and expiring this would strand someone mid-answer with no way back
 * that they would understand. The invite token remains the real credential; this
 * only stops a bare session id being one.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signingKey(): string {
  return config.sessionSecret || config.adminPassword || 'disabled';
}

function sign(body: string): string {
  return createHmac('sha256', signingKey()).update(`informant.${body}`).digest('hex');
}

/** `<sessionId>.<expiry>.<hmac>` — the id is a claim, the HMAC makes it a credential. */
export function informantToken(sessionId: string): string {
  const body = `${sessionId}.${Date.now() + TTL_MS}`;
  return `${body}.${sign(body)}`;
}

/**
 * Does the caller hold a cookie for *this* session? Session ids never contain a
 * dot (nanoid's alphabet is A–Za–z0–9_-), so splitting on it is unambiguous.
 */
export function holdsSession(sessionId: string, cookie: string | undefined): boolean {
  if (!cookie) return false;
  const parts = cookie.split('.');
  if (parts.length !== 3) return false;

  const [id, rawExpires, mac] = parts;
  if (id !== sessionId) return false;

  const expected = Buffer.from(sign(`${id}.${rawExpires}`));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false;

  const expires = Number(rawExpires);
  return Number.isFinite(expires) && expires > Date.now();
}

/** Read the cookie for a route handler. */
export function informantHolds(sessionId: string): boolean {
  return holdsSession(sessionId, cookies().get(INFORMANT_COOKIE)?.value);
}

export const INFORMANT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: Math.floor(TTL_MS / 1000),
};
