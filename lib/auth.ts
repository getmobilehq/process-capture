/**
 * Pilot-grade console auth (BUILD-REQUIREMENTS FR-1.1). The ADMIN_PASSWORD is
 * bcrypt-hashed at boot; a correct password mints a signed session cookie. Login
 * attempts are rate-limited per IP. This is deliberately simple and documented as
 * such — not enterprise SSO (which is an explicit V1 non-goal).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '@/lib/config';

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

// ── Rate limiting (per-process; sufficient for a single-instance pilot) ──────
interface Attempt {
  count: number;
  resetAt: number;
}
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function recordLoginAttempt(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

export function clearLoginAttempts(ip: string): void {
  attempts.delete(ip);
}
