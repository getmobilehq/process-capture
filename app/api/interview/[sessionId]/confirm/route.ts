import { NextResponse } from 'next/server';
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
export async function POST(_req: Request, { params }: { params: { sessionId: string } }) {
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
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
