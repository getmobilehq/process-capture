import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api-error';
import { retentionCaller, retentionEnabled } from '@/lib/retention-auth';
import { applyRetention, describeRetention } from '@/lib/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The scheduled retention sweep (SDD issue I-2).
 *
 * Called by the platform's scheduler, not by a person, so it authenticates on the
 * caller's own identity rather than the console cookie — see lib/retention-auth.ts
 * for why that replaced a shared token. With no `RETENTION_CALLERS` set the route
 * does not exist at all: a destructive endpoint should be absent until someone
 * deliberately turns it on, not merely unprotected.
 *
 * `?dryRun=1` reports without deleting, which is how the job should be run the
 * first time against real data.
 */
export async function POST(req: Request) {
  if (!retentionEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const caller = await retentionCaller(req);
  if (!caller) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  // Who ran it, in the log, whether or not anything was deleted. A sweep that
  // removes a person's interview should never be anonymous.
  console.info(`retention: requested by ${caller.email}`);

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
    return serverError('retention sweep', err);
  }
}
