import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api-error';
import { rejectCrossOrigin } from '@/lib/origin';
import { cookies } from 'next/headers';
import { isValidSession } from '@/lib/auth';
import { config } from '@/lib/config';
import { getLatestSpec, getProcessGraph, getSession } from '@/lib/db/queries';
import { processGraphSchema, type OpportunitySet } from '@/lib/graph/schema';
import { assessAutomation, AssessmentError } from '@/lib/graph/assessment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Assess whether this process would benefit from AI automation (R5.8).
 *
 * Reads the stored as-is graph and its opportunity classifications rather than
 * re-deriving either, so the assessment describes the same process the architect
 * is looking at. Everything returned is `proposed` and unverified: this is an
 * indication for a stakeholder's decision, not a recommendation to proceed.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  // Cross-site request forgery: these are cookie-authenticated, so the browser
  // attaches credentials whoever asked for the request.
  const wrongSite = rejectCrossOrigin(req);
  if (wrongSite) return wrongSite;
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  if (!config.toBeEnabled) {
    return NextResponse.json({ error: 'Analysis views are not enabled.' }, { status: 404 });
  }

  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const spec = await getLatestSpec(session.id);
  if (!spec) return NextResponse.json({ error: 'No specification yet.' }, { status: 409 });

  const asIsRow = await getProcessGraph(session.id, spec.version, 'asis');
  if (!asIsRow) {
    return NextResponse.json(
      { error: 'Draw the as-is process map first — the assessment is built on it.' },
      { status: 409 },
    );
  }
  const asIs = processGraphSchema.safeParse(asIsRow.graph);
  if (!asIs.success) {
    return NextResponse.json({ error: 'The stored as-is graph is not valid.' }, { status: 500 });
  }

  const oppRow = await getProcessGraph(session.id, spec.version, 'opportunity');
  if (!oppRow?.changeSet) {
    return NextResponse.json(
      { error: 'Run the opportunity overlay first — the assessment is built on its labels.' },
      { status: 409 },
    );
  }

  try {
    const result = await assessAutomation(asIs.data, oppRow.changeSet as OpportunitySet);
    return NextResponse.json({
      assessment: result,
      processName: asIs.data.name,
      specVersion: spec.version,
    });
  } catch (err) {
    if (err instanceof AssessmentError) {
      return NextResponse.json({ error: err.message, details: err.errors }, { status: 422 });
    }
    return serverError('automation assessment', err);
  }
}
