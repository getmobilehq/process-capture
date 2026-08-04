/**
 * Minimal in-memory fixed-window rate limiter (BUILD-REQUIREMENTS §8 Phase 7).
 *
 * PER-PROCESS. With N app instances the effective limit becomes N × the value
 * passed here, and nothing reports that it has happened. The pilot deployment is
 * therefore pinned to `--max-instances=1` (DL.57, DEPLOY-GCP.md) — that flag is a
 * correctness constraint for this file, not a capacity choice.
 *
 * Before scaling out, move the buckets into a table. P6 rules out Redis, and a
 * table is sufficient at this volume.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > opts.limit) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}
