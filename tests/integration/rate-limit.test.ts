import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { makeTestDb, type TestDb } from '../helpers/db';
import {
  rateLimit,
  clearRateLimit,
  pruneRateLimits,
  __resetMemoryBuckets,
} from '@/lib/rate-limit';

const OPTS = { limit: 3, windowMs: 60_000 };

beforeEach(() => {
  __resetMemoryBuckets();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('shared rate limiting (SDD I-1)', () => {
  it('counts up to the limit, then refuses', async () => {
    const { db } = await makeTestDb();
    for (let i = 0; i < 3; i += 1) {
      const r = await rateLimit('turn:1.2.3.4', OPTS, db);
      expect(r.allowed).toBe(true);
      expect(r.source).toBe('shared');
    }
    const blocked = await rateLimit('turn:1.2.3.4', OPTS, db);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('keeps separate keys separate', async () => {
    const { db } = await makeTestDb();
    for (let i = 0; i < 4; i += 1) await rateLimit('turn:1.1.1.1', OPTS, db);
    const other = await rateLimit('turn:2.2.2.2', OPTS, db);
    expect(other.allowed).toBe(true);
  });

  // The reason this exists at all: two instances must share one count.
  it('counts across callers, which is what a second instance is', async () => {
    const { db } = await makeTestDb();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => rateLimit('turn:9.9.9.9', OPTS, db)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    // Exactly the limit gets through — no more, however concurrent the requests.
    expect(allowed).toBe(3);
    expect(results.every((r) => r.source === 'shared')).toBe(true);
  });

  it('starts a fresh window once the old one has passed', async () => {
    const { db } = await makeTestDb();
    // 600ms window, waited out with 500ms to spare. The first version allowed
    // 100ms of margin and failed under full-suite load — a timing test that is
    // only sometimes right is worse than none, because it teaches people to
    // re-run rather than read.
    const fast = { limit: 2, windowMs: 600 };
    await rateLimit('k', fast, db);
    await rateLimit('k', fast, db);
    expect((await rateLimit('k', fast, db)).allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 1100));
    const after = await rateLimit('k', fast, db);
    expect(after.allowed).toBe(true);
  });

  it('clears a bucket, so one success forgives the fumbles', async () => {
    const { db } = await makeTestDb();
    for (let i = 0; i < 4; i += 1) await rateLimit('login:5.5.5.5', OPTS, db);
    expect((await rateLimit('login:5.5.5.5', OPTS, db)).allowed).toBe(false);

    await clearRateLimit('login:5.5.5.5', db);
    expect((await rateLimit('login:5.5.5.5', OPTS, db)).allowed).toBe(true);
  });

  it('prunes windows that have passed, and leaves live ones alone', async () => {
    const { db } = await makeTestDb();
    await rateLimit('live', { limit: 5, windowMs: 60_000 }, db);
    await rateLimit('dead', { limit: 5, windowMs: 600 }, db);
    await new Promise((r) => setTimeout(r, 1100));

    expect(await pruneRateLimits(db)).toBe(1);
    // The live bucket kept its count rather than being reset by the prune.
    const r = await rateLimit('live', { limit: 5, windowMs: 60_000 }, db);
    expect(r.allowed).toBe(true);
  });
});

describe('degrading when the shared store is unreachable', () => {
  const broken = {
    insert: () => {
      throw new Error('connection refused');
    },
  } as unknown as TestDb;

  it('falls back to in-process counting rather than failing open', async () => {
    for (let i = 0; i < 3; i += 1) {
      const r = await rateLimit('turn:7.7.7.7', OPTS, broken);
      expect(r.allowed).toBe(true);
      expect(r.source).toBe('memory');
    }
    const blocked = await rateLimit('turn:7.7.7.7', OPTS, broken);
    expect(blocked.allowed).toBe(false);
    expect(blocked.source).toBe('memory');
  });

  it('says so in the log, because a sustained run means the limit is per-instance again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await rateLimit('k', OPTS, broken);
    expect(warn.mock.calls[0][0]).toMatch(/falling back to in-process/);
  });
});

// Client identification moved to tests/unit/client-ip.test.ts — the assertion here
// encoded the pre-fix behaviour (first forwarded hop), which was the bypass.
