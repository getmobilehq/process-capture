import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api-error';
import { rejectCrossOrigin } from '@/lib/origin';
import {
  deleteProcessGraph,
  getInterviewee,
  getLatestSpec,
  getProcessGraph,
  getSession,
  saveProcessGraph,
} from '@/lib/db/queries';
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
 * Extracted once per (session, spec version) and stored. Model calls are not
 * deterministic, so re-extracting per view would leave two reviewers looking at
 * different diagrams of the same specification. `?refresh=1` discards the stored
 * graph and extracts again — an explicit act, never a side effect of viewing.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  // Cross-site request forgery: these are cookie-authenticated, so the browser
  // attaches credentials whoever asked for the request.
  const wrongSite = rejectCrossOrigin(req);
  if (wrongSite) return wrongSite;
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const spec = await getLatestSpec(session.id);
  if (!spec) {
    return NextResponse.json(
      { error: 'This interview has no specification yet.' },
      { status: 409 },
    );
  }

  const informant = (await getInterviewee(session.intervieweeId))?.fullName ?? 'the informant';

  if (new URL(req.url).searchParams.get('refresh') === '1') {
    await deleteProcessGraph(session.id, spec.version, 'asis');
    // A to-be derived from the old graph would now be keyed to something that no
    // longer exists, so it goes with it.
    await deleteProcessGraph(session.id, spec.version, 'tobe');
  }

  const stored = await getProcessGraph(session.id, spec.version, 'asis');
  if (stored) {
    const graph = stored.graph as Parameters<typeof toBpmnXml>[0];
    // The architect's adjusted drawing wins over the generated one. `adjusted`
    // tells the UI to offer "reset to generated layout" — without it, someone
    // who has rearranged a diagram has no way back.
    return NextResponse.json({
      graph,
      xml: stored.diagramXml ?? toBpmnXml(graph),
      adjusted: Boolean(stored.diagramXml),
      informant,
      cached: true,
    });
  }

  try {
    const graph = await extractProcessGraph({
      markdown: spec.markdown,
      specRef: `${session.id}:v${spec.version}`,
    });
    await saveProcessGraph({
      sessionId: session.id,
      specVersion: spec.version,
      kind: 'asis',
      graph,
    });
    return NextResponse.json({
      graph,
      xml: toBpmnXml(graph),
      informant,
      cached: false,
    });
  } catch (err) {
    if (err instanceof GraphExtractionError) {
      // R5.7 — a spec that cannot yield a valid graph fails loudly and says why,
      // rather than rendering an authoritative-looking diagram from bad material.
      return NextResponse.json({ error: err.message, details: err.errors }, { status: 422 });
    }
    return serverError('graph extraction', err);
  }
}
