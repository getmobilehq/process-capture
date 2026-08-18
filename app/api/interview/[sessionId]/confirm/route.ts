import { NextResponse } from 'next/server';
import { informantHolds } from '@/lib/informant-auth';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { completeInterview } from '@/lib/engine/engine';
import { SpecValidationError } from '@/lib/spec/generate';
import { getSession } from '@/lib/db/queries';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Finalise the interview. Reachable from `review` (the normal path) and from
 * `open` (delta v1.1 R9.3 — "Finish recording", available at all times). An
 * early finish still produces a valid spec; what was not reached is written to
 * open_items rather than papered over (R9.4).
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  // Completion runs per-facet spec generation — roughly a dozen model calls. It
  // was the one interview route with no limit at all.
  const rl = await rateLimit(`confirm:${clientIp(req)}`, { limit: 6, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  // Only the person who opened the invite link may act on this interview. The
  // session id alone used to be the permission, and it appears in every access
  // log — see lib/informant-auth.ts.
  if (!informantHolds(params.sessionId)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  try {
    const { specVersion } = await completeInterview(params.sessionId);
    return NextResponse.json({ status: 'complete', specVersion, surveyUrl: config.surveyUrl });
  } catch (err) {
    if (err instanceof SpecValidationError) {
      // FR-5.5: an invalid spec is a hard failure that blocks completion.
      return NextResponse.json(
        { error: 'The specification failed validation and was not saved.', details: err.errors },
        { status: 422 },
      );
    }
    // Logged, not returned: this reached an unauthenticated caller and could
    // carry Postgres table names or internal invariant messages.
    console.error('confirm: completeInterview failed', err);
    return NextResponse.json({ error: 'The interview could not be completed.' }, { status: 400 });
  }
}
