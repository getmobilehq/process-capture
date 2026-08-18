import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeTestDb, type TestDb } from '../helpers/db';
import { createConsoleUser, findConsoleUserByEmail, updateConsoleUser } from '@/lib/db/queries';

const state = { adminPassword: 'shared-secret', sessionSecret: 'signing-key' };
vi.mock('@/lib/config', () => ({
  config: {
    get adminPassword() { return state.adminPassword; },
    get sessionSecret() { return state.sessionSecret; },
  },
}));

let testDb: TestDb;
vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return { ...actual, getDb: () => testDb };
});
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true, retryAfterSec: 0, source: 'shared' }),
  clearRateLimit: async () => {},
}));

import {
  signIn,
  sessionToken,
  isValidSession,
  identityFromSession,
  hashPassword,
  generatePassword,
  SHARED_IDENTITY,
} from '@/lib/auth';

beforeEach(async () => {
  ({ db: testDb } = await makeTestDb());
  state.adminPassword = 'shared-secret';
  state.sessionSecret = 'signing-key';
});
afterEach(() => vi.restoreAllMocks());

async function addUser(email = 'priya@example.com', name = 'Priya Nair', pw = 'correct-horse') {
  return createConsoleUser({ email, name, passwordHash: hashPassword(pw) }, testDb);
}

describe('named console accounts (SDD I-3)', () => {
  it('signs in a named account and carries the person in the session', async () => {
    const user = await addUser();
    const r = await signIn({ email: 'priya@example.com', password: 'correct-horse' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity).toMatchObject({ userId: user.id, displayName: 'Priya Nair' });

    const token = sessionToken(r.identity);
    expect(isValidSession(token)).toBe(true);
    expect(await identityFromSession(token)).toMatchObject({ displayName: 'Priya Nair' });
  });

  it('is case- and space-insensitive about the email', async () => {
    await addUser();
    const r = await signIn({ email: '  PRIYA@Example.com ', password: 'correct-horse' });
    expect(r.ok).toBe(true);
  });

  it('refuses a wrong password', async () => {
    await addUser();
    expect(await signIn({ email: 'priya@example.com', password: 'wrong' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  // Telling an unauthenticated caller that an account exists is more than they need.
  it('reports a disabled account as invalid, not as disabled', async () => {
    const user = await addUser();
    await updateConsoleUser(user.id, { status: 'disabled' }, testDb);
    expect(await signIn({ email: 'priya@example.com', password: 'correct-horse' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('never stores the password in the clear', async () => {
    await addUser('tom@example.com', 'Tom Okafor', 'my-password');
    const row = await findConsoleUserByEmail('tom@example.com', testDb);
    expect(row!.passwordHash).not.toContain('my-password');
    expect(row!.passwordHash.startsWith('$2')).toBe(true);
  });

  it('generates passwords that are long and never repeat', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(a).not.toBe(b);
  });
});

describe('the shared credential still works', () => {
  // If this breaks, shipping I-3 locks a live deployment out of its own console.
  it('signs in with no email, using ADMIN_PASSWORD', async () => {
    const r = await signIn({ password: 'shared-secret' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.identity).toEqual(SHARED_IDENTITY);
  });

  it('still refuses the wrong shared password', async () => {
    expect(await signIn({ password: 'nope' })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('attributes a shared session to "console admin", not to a person', async () => {
    const token = sessionToken(SHARED_IDENTITY);
    expect(await identityFromSession(token)).toEqual(SHARED_IDENTITY);
  });
});

describe('session integrity', () => {
  it('rejects a tampered user id', async () => {
    const user = await addUser();
    const token = sessionToken({ userId: user.id, displayName: 'Priya Nair', email: 'p@e.com' });
    const forged = token.replace(user.id, 'someone-else');
    expect(isValidSession(forged)).toBe(false);
  });

  it('rejects a tampered expiry', async () => {
    const token = sessionToken(SHARED_IDENTITY);
    const [v, u, exp, mac] = token.split('.');
    expect(isValidSession(`${v}.${u}.${Number(exp) + 86_400_000}.${mac}`)).toBe(false);
  });

  it('rejects an expired session', async () => {
    const token = sessionToken(SHARED_IDENTITY);
    const [v, u, , mac] = token.split('.');
    expect(isValidSession(`${v}.${u}.${Date.now() - 1000}.${mac}`)).toBe(false);
  });

  it('rejects nonsense and nothing', () => {
    expect(isValidSession('forged')).toBe(false);
    expect(isValidSession(undefined)).toBe(false);
    expect(isValidSession('v2.a.b.c.d')).toBe(false);
  });

  // A signed-out account must not keep its name on new reviews.
  it('falls back to the shared identity when the account has been disabled', async () => {
    const user = await addUser();
    const token = sessionToken({ userId: user.id, displayName: 'Priya Nair', email: 'p@e.com' });
    await updateConsoleUser(user.id, { status: 'disabled' }, testDb);
    expect(await identityFromSession(token)).toEqual(SHARED_IDENTITY);
  });
});
