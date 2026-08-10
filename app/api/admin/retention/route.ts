import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { applyRetention, describeRetention } from '@/lib/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The scheduled retention sweep (SDD issue I-2).
 *
 * Called by the platform's scheduler, not by a person, so it authenticates with a
 * shared token rather than the console cookie. With no `RETENTION_TOKEN` set the
 * route does not exist at all — a destructive endpoint should be absent until
 * someone deliberately turns it on, not merely unprotected.
 *
 * Two header names are accepted for one reason: Cloud Scheduler puts its OIDC
 * token in `Authorization`, so a scheduled call has nowhere else to carry ours.
 * `X-Retention-Token` is what the job uses; `Authorization: Bearer` is what a
 * person uses from a terminal.
 *
 * `?dryRun=1` reports without deleting, which is how the job should be run the
 * first time against real data.
 */
function authorised(req: Request): boolean {
  const expected = process.env.RETENTION_TOKEN ?? '';
  if (!expected) return false;
  const got =
    req.headers.get('x-retention-token') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // Compare on equal-length buffers so the check itself leaks no length signal.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.RETENTION_TOKEN) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';

  try {
    const result = await applyRetention({ dryRun });
    // Counts and ids only — never the content that was removed.
    return NextResponse.json({
      summary: describeRetention(result),
      applied: result.applied,
      cutoff: result.cutoff.toISOString(),
      retentionDays: result.retentionDays,
      sessions: result.sessions.length,
      interviewees: result.interviewees.length,
      deleted: result.deleted,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
