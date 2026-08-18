/**
 * Fixed-window rate limiter, shared across instances (SDD issue I-1).
 *
 * Buckets live in Postgres, so the limit means the same thing however many
 * instances are running. Previously they lived in process memory, which made
 * `--max-instances=1` a correctness constraint rather than a capacity choice: with
 * N instances the effective limit silently became N × the configured value, and
 * nothing reported that it had happened.
 *
 * A table rather than Redis (P6 — extend before adding). The whole increment is a
 * single `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which Postgres applies
 * atomically, so two simultaneous requests cannot both read the same count and
 * both decide they are under the limit. That atomicity is the entire reason this
 * works; a read-then-write would be a race with a rate limiter's name on it.
 *
 * **On failure it falls back to the in-process limiter rather than failing open.**
 * A database blip must not let an unauthenticated endpoint spend model credits
 * without limit, and it must not block an informant mid-interview either. The
 * fallback is exactly the behaviour this file had before, so the worst case is the
 * old behaviour rather than no behaviour — degraded, never absent.
 */
import { sql } from 'drizzle-orm';
import { getDb, type DB } from './db';
import { rateLimits } from './db/schema';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  /** Where the decision came from. `memory` means the shared store was unreachable. */
  source: 'shared' | 'memory';
}

// ── In-process fallback ──────────────────────────────────────────────────────
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

/** Bound the map: an attacker cycling IPs must not be able to grow it forever. */
const MAX_MEMORY_BUCKETS = 10_000;

function memoryLimit(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_MEMORY_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
    // Still oversized after clearing the expired: drop the lot rather than grow
    // without bound. A cleared window is a moment of leniency, not a leak.
    if (buckets.size > MAX_MEMORY_BUCKETS) buckets.clear();
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterSec: 0, source: 'memory' };
  }
  bucket.count += 1;
  if (bucket.count > opts.limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      source: 'memory',
    };
  }
  return { allowed: true, retryAfterSec: 0, source: 'memory' };
}

// ── Shared store ─────────────────────────────────────────────────────────────

/**
 * One statement, applied atomically:
 *   - no row, or the window has passed → start a new window at 1
 *   - otherwise → increment within the existing window
 * and return whichever count and reset now apply.
 */
export async function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  injected?: DB,
): Promise<RateLimitResult> {
  const seconds = Math.ceil(opts.windowMs / 1000);

  try {
    // Resolved inside the try, deliberately. As a default parameter this threw
    // before the catch could see it, so a missing or malformed DATABASE_URL took
    // the whole request down instead of degrading to the in-process limiter.
    const db = injected ?? getDb();
    const rows = await db
      .insert(rateLimits)
      .values({
        key,
        count: 1,
        resetAt: sql`now() + make_interval(secs => ${seconds})`,
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.resetAt} < now() then 1 else ${rateLimits.count} + 1 end`,
          resetAt: sql`case when ${rateLimits.resetAt} < now() then now() + make_interval(secs => ${seconds}) else ${rateLimits.resetAt} end`,
        },
      })
      .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

    const row = rows[0];
    if (!row) return memoryLimit(key, opts);

    if (row.count > opts.limit) {
      const retry = Math.ceil((row.resetAt.getTime() - Date.now()) / 1000);
      return { allowed: false, retryAfterSec: Math.max(1, retry), source: 'shared' };
    }
    return { allowed: true, retryAfterSec: 0, source: 'shared' };
  } catch (err) {
    // Degraded, never absent. Logged at warn because a sustained run of these
    // means the limit is per-instance again and someone should know.
    console.warn(
      `rate-limit: shared store unavailable, falling back to in-process (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return memoryLimit(key, opts);
  }
}

/**
 * Delete windows that have passed. Called by the retention sweep — the table is
 * tiny, but an unbounded row count is a slow leak and this costs nothing.
 */
export async function pruneRateLimits(db: DB = getDb()): Promise<number> {
  const rows = await db
    .delete(rateLimits)
    .where(sql`${rateLimits.resetAt} < now()`)
    .returning({ key: rateLimits.key });
  return rows.length;
}

/** Reset a bucket — used when a login succeeds, so one success clears the count. */
export async function clearRateLimit(key: string, injected?: DB): Promise<void> {
  try {
    const db = injected ?? getDb();
    await db.delete(rateLimits).where(sql`${rateLimits.key} = ${key}`);
  } catch {
    // Best effort: failing to clear only means the caller keeps their remaining
    // allowance for the rest of the window.
  }
  buckets.delete(key);
}

/**
 * The caller's address, as far as it can be trusted.
 *
 * Reads the LAST `x-forwarded-for` entry, not the first. Google's front end
 * appends to whatever the client sent, so the first entry is a value the caller
 * chose — taking it let anyone mint a fresh rate-limit bucket per request by
 * rotating the header, which defeated the console brute-force limit outright and
 * removed the only cap on model spend.
 *
 * The last entry is written by the proxy in front of us and cannot be forged from
 * outside it. Behind a different topology (an external load balancer adds its own
 * hop) this offset needs revisiting — hence one definition, here, rather than a
 * copy in each route.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return req.headers.get('x-real-ip') ?? 'local';
}

/** Test seam: drop the in-process fallback state. */
export function __resetMemoryBuckets(): void {
  buckets.clear();
}

/**
 * Refuse an oversized request before parsing it.
 *
 * `req.formData()` and `req.json()` buffer the whole body into memory, so a size
 * check *after* parsing bounds what is forwarded, not what is allocated — one
 * large POST could exhaust the container regardless of any rate limit. Checking
 * Content-Length first is not a complete defence (the header can lie, and a
 * chunked body has none), which is why the post-parse caps stay; it closes the
 * cheap case, which is the one that gets used.
 */
export function tooLarge(req: Request, maxBytes: number): boolean {
  const declared = Number(req.headers.get('content-length') ?? '0');
  return Number.isFinite(declared) && declared > maxBytes;
}
