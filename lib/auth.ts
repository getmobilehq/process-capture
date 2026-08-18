/**
 * Console authentication (FR-1.1; named accounts added for SDD issue I-3).
 *
 * Two ways in, deliberately:
 *
 *  1. **A named account** — email and password, checked against `console_users`.
 *     The session carries who they are, so a review can be attributed to a person
 *     rather than to "the console".
 *  2. **The shared `ADMIN_PASSWORD`** — the original single credential. Kept
 *     because removing it would lock a running deployment out of its own console
 *     the moment this ships, and because someone has to be able to get in to
 *     create the first account. Reviews made this way are still attributed to
 *     "console admin", which is the honest label for an unidentified session.
 *
 * The shared path is a bootstrap, not a peer. Once named accounts exist it should
 * be retired by unsetting ADMIN_PASSWORD — at which point every review carries a
 * person, which is the whole point of I-3.
 *
 * Still not SSO. That remains a V1 non-goal; this answers "who", which is the
 * question governance actually asks.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '@/lib/config';
import { clearRateLimit, rateLimit } from '@/lib/rate-limit';
import {
  findConsoleUserByEmail,
  getConsoleUser,
  recordConsoleLogin,
} from '@/lib/db/queries';

export const ADMIN_COOKIE = 'pc_admin';

/** Sessions last a working day; long enough not to nag, short enough to expire. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface ConsoleIdentity {
  /** Null for the shared credential — nobody in particular is signed in. */
  userId: string | null;
  /** What goes on a review. A name where we have one, else "console admin". */
  displayName: string;
  email: string | null;
}

export const SHARED_IDENTITY: ConsoleIdentity = {
  userId: null,
  displayName: 'console admin',
  email: null,
};

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * The signing key. `SESSION_SECRET` when set; otherwise derived from
 * ADMIN_PASSWORD so existing deployments keep working without new configuration.
 *
 * The fallback has a consequence worth stating: changing ADMIN_PASSWORD
 * invalidates every session. That is the correct behaviour for a shared
 * credential — a rotated password should log everyone out — but it is a reason to
 * set SESSION_SECRET explicitly once named accounts are in use.
 */
function signingKey(): string {
  return config.sessionSecret || config.adminPassword || 'disabled';
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('hex');
}

export function adminEnabled(): boolean {
  return Boolean(config.adminPassword) || Boolean(config.sessionSecret);
}

// ── Passwords ────────────────────────────────────────────────────────────────

let cachedHash: string | null = null;
function adminHash(): string | null {
  if (!config.adminPassword) return null;
  if (!cachedHash) cachedHash = bcrypt.hashSync(config.adminPassword, 10);
  return cachedHash;
}

/** The shared credential. True only when ADMIN_PASSWORD is set and matches. */
export function verifyPassword(submitted: string): boolean {
  const hash = adminHash();
  if (!hash) return false;
  return bcrypt.compareSync(submitted, hash);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

/** A password worth issuing: long, random, and not something a person invented. */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/**
 * `v2.<userId|->.<expiry>.<hmac>` — the identity travels in the cookie so a
 * review can name a person without a database round trip on every request.
 *
 * Signed, not encrypted: the contents are a user id and an expiry, neither of
 * which is a secret. What matters is that they cannot be altered, and the HMAC
 * covers both.
 */
export function sessionToken(identity: ConsoleIdentity = SHARED_IDENTITY): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const body = `v2.${identity.userId ?? '-'}.${expires}`;
  return `${body}.${sign(body)}`;
}

interface ParsedSession {
  userId: string | null;
  expires: number;
}

function parseSession(token: string): ParsedSession | null {
  const parts = token.split('.');

  // Legacy single-value cookie: an HMAC over a constant. Accepted so that anyone
  // signed in when this deploys is not thrown out mid-task.
  if (parts.length === 1) {
    const expected = Buffer.from(
      createHmac('sha256', config.adminPassword || 'disabled')
        .update('console-admin-v1')
        .digest('hex'),
    );
    const got = Buffer.from(token);
    if (expected.length === got.length && timingSafeEqual(expected, got)) {
      return { userId: null, expires: Date.now() + 60_000 };
    }
    return null;
  }

  if (parts.length !== 4 || parts[0] !== 'v2') return null;
  const [, rawUser, rawExpires, mac] = parts;
  const body = `v2.${rawUser}.${rawExpires}`;

  const expected = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  const expires = Number(rawExpires);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;

  return { userId: rawUser === '-' ? null : rawUser, expires };
}

export function isValidSession(token: string | undefined): boolean {
  if (!token || !adminEnabled()) return false;
  return parseSession(token) !== null;
}

/**
 * Who is signed in. Reads the user only when the cookie names one, so the shared
 * path stays a pure signature check.
 *
 * A disabled account resolves to the shared identity rather than failing: their
 * session is already valid and short-lived, and locking a page mid-render is a
 * worse outcome than one more review labelled "console admin". `isValidSession`
 * governs access; this governs attribution.
 */
export async function identityFromSession(
  token: string | undefined,
): Promise<ConsoleIdentity | null> {
  if (!token || !adminEnabled()) return null;
  const parsed = parseSession(token);
  if (!parsed) return null;
  if (!parsed.userId) return SHARED_IDENTITY;

  try {
    const user = await getConsoleUser(parsed.userId);
    if (!user || user.status !== 'active') return SHARED_IDENTITY;
    return { userId: user.id, displayName: user.name, email: user.email };
  } catch {
    return SHARED_IDENTITY;
  }
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

export type SignInResult =
  | { ok: true; identity: ConsoleIdentity }
  | { ok: false; reason: 'invalid' | 'disabled' };

/**
 * Check a submitted credential. An email selects the named path; without one the
 * shared password is tried.
 *
 * A disabled account is reported as `invalid`, not `disabled` — telling an
 * unauthenticated caller that an account exists but is switched off is more than
 * they need to know.
 */
export async function signIn(input: {
  email?: string;
  password: string;
}): Promise<SignInResult> {
  const email = (input.email ?? '').trim().toLowerCase();

  if (email) {
    let user;
    try {
      user = await findConsoleUserByEmail(email);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    if (!user || user.status !== 'active') return { ok: false, reason: 'invalid' };
    if (!bcrypt.compareSync(input.password, user.passwordHash)) {
      return { ok: false, reason: 'invalid' };
    }
    // Best effort: a failure to stamp the login must not fail the login.
    try {
      await recordConsoleLogin(user.id);
    } catch {
      /* ignore */
    }
    return { ok: true, identity: { userId: user.id, displayName: user.name, email: user.email } };
  }

  if (verifyPassword(input.password)) return { ok: true, identity: SHARED_IDENTITY };
  return { ok: false, reason: 'invalid' };
}

// ── Rate limiting (shared across instances — SDD I-1) ───────────────────────
// This one guards the console password, so per-process counting was the worst of
// the five: with N instances an attacker got N × the attempts and nothing said so.
// It now uses the same shared buckets as every other limited route.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export async function recordLoginAttempt(
  ip: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const r = await rateLimit(`login:${ip}`, { limit: MAX_ATTEMPTS, windowMs: WINDOW_MS });
  return r.allowed ? { allowed: true } : { allowed: false, retryAfterSec: r.retryAfterSec };
}

/** A correct password clears the count, so one success forgives the fumbles. */
export async function clearLoginAttempts(ip: string): Promise<void> {
  await clearRateLimit(`login:${ip}`);
}
