import { NextResponse } from 'next/server';
import { getInterviewee, getLatestSpec, getSession } from '@/lib/db/queries';
import { extractProcessGraph, GraphExtractionError } from '@/lib/graph/extract';
import { toBpmnXml } from '@/lib/graph/bpmn';
import { isValidSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Extract the process graph for a completed spec and serialise it (R5.1 → R5.3).
 *
 * Console-only: the graph is analysis for the architecture team, not something the
 * informant is shown. Extraction is a live model call, so this is a POST — it is
 * not a cheap idempotent read, and nothing should prefetch it.
 *
 * NOT YET PERSISTED: every call re-extracts. The graph belongs in a table keyed by
 * spec version so a map is drawn once per spec rather than once per view; that is
 * follow-up work, recorded in STATUS.
 */
export async function POST(_req: Request, { params }: { params: { sessionId: string } }) {
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const session = getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const spec = getLatestSpec(session.id);
  if (!spec) {
    return NextResponse.json(
      { error: 'This interview has no specification yet.' },
      { status: 409 },
    );
  }

  try {
    const graph = await extractProcessGraph({
      markdown: spec.markdown,
      specRef: `${session.id}:v${spec.version}`,
    });
    return NextResponse.json({
      graph,
      xml: toBpmnXml(graph),
      informant: getInterviewee(session.intervieweeId)?.fullName ?? 'the informant',
    });
  } catch (err) {
    if (err instanceof GraphExtractionError) {
      // R5.7 — a spec that cannot yield a valid graph fails loudly and says why,
      // rather than rendering an authoritative-looking diagram from bad material.
      return NextResponse.json({ error: err.message, details: err.errors }, { status: 422 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
