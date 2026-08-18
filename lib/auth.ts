/**
 * Pilot-grade console auth (BUILD-REQUIREMENTS FR-1.1). The ADMIN_PASSWORD is
 * bcrypt-hashed at boot; a correct password mints a signed session cookie. Login
 * attempts are rate-limited per IP. This is deliberately simple and documented as
 * such — not enterprise SSO (which is an explicit V1 non-goal).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '@/lib/config';
import { clearRateLimit, rateLimit } from '@/lib/rate-limit';

export const ADMIN_COOKIE = 'pc_admin';

let cachedHash: string | null = null;
function adminHash(): string | null {
  if (!config.adminPassword) return null;
  if (!cachedHash) cachedHash = bcrypt.hashSync(config.adminPassword, 10);
  return cachedHash;
}

export function adminEnabled(): boolean {
  return Boolean(config.adminPassword);
}

export function verifyPassword(submitted: string): boolean {
  const hash = adminHash();
  if (!hash) return false;
  return bcrypt.compareSync(submitted, hash);
}

/** The expected cookie value — an HMAC over a constant, keyed by the password. */
export function sessionToken(): string {
  return createHmac('sha256', config.adminPassword || 'disabled').update('console-admin-v1').digest('hex');
}

export function isValidSession(token: string | undefined): boolean {
  if (!token || !adminEnabled()) return false;
  const expected = Buffer.from(sessionToken());
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got);
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
