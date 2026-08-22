import { NextResponse } from 'next/server';
import { rejectCrossOrigin } from '@/lib/origin';
import { cookies } from 'next/headers';
import { isValidSession } from '@/lib/auth';
import { config } from '@/lib/config';
import {
  getInterviewee,
  getLatestSpec,
  getProcessGraph,
  getSession,
  saveProcessGraph,
} from '@/lib/db/queries';
import { processGraphSchema } from '@/lib/graph/schema';
import { assessAutonomy, summariseAutonomy, AutonomyError, type AutonomySet } from '@/lib/graph/autonomy';
import { renderAutonomySwimlane } from '@/lib/graph/swimlane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Place every step of the process on the autonomy scale (R5.9).
 *
 * Built on the stored as-is graph rather than a fresh extraction, so the levels
 * attach to the same steps the architect is looking at. Everything returned is
 * `proposed` and unverified: this says how far work *could* run without a person,
 * which is a claim about someone's job and not a decision anyone has taken.
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
      { error: 'Draw the as-is process map first — the levels attach to its steps.' },
      { status: 409 },
    );
  }
  const asIs = processGraphSchema.safeParse(asIsRow.graph);
  if (!asIs.success) {
    return NextResponse.json({ error: 'The stored as-is graph is not valid.' }, { status: 500 });
  }

  const informant = (await getInterviewee(session.intervieweeId))?.fullName ?? 'the informant';

  function respond(set: AutonomySet, cached: boolean) {
    const graph = asIs.success ? asIs.data : null;
    if (!graph) return NextResponse.json({ error: 'graph unavailable' }, { status: 500 });
    return NextResponse.json({
      autonomy: set,
      summary: summariseAutonomy(graph, set),
      svg: renderAutonomySwimlane(graph, set, { processName: graph.name, informant }),
      activities: graph.activities.map((a) => ({ id: a.id, name: a.name, laneId: a.laneId })),
      lanes: graph.lanes.map((l) => ({ id: l.id, name: l.name })),
      processName: graph.name,
      informant,
      cached,
    });
  }

  // Stored per (session, spec version) like every other analysis artefact: a live
  // model call is not deterministic, and two reviewers must not be looking at
  // different assessments of the same specification.
  const stored = await getProcessGraph(session.id, spec.version, 'autonomy');
  if (stored?.changeSet) return respond(stored.changeSet as AutonomySet, true);

  try {
    const set = await assessAutonomy(asIs.data, spec.markdown);
    await saveProcessGraph({
      sessionId: session.id,
      specVersion: spec.version,
      kind: 'autonomy',
      graph: { graphRef: set.graphRef },
      changeSet: set,
    });
    return respond(set, false);
  } catch (err) {
    if (err instanceof AutonomyError) {
      return NextResponse.json({ error: err.message, details: err.errors }, { status: 422 });
    }
    console.error('autonomy: assessment failed', err);
    return NextResponse.json({ error: 'The assessment could not be produced.' }, { status: 500 });
  }
}
