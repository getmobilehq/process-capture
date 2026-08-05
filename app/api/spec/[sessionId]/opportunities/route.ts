import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidSession } from '@/lib/auth';
import { config } from '@/lib/config';
import {
  getLatestSpec,
  getProcessGraph,
  getSession,
  saveProcessGraph,
} from '@/lib/db/queries';
import { processGraphSchema, type OpportunitySet, type ProcessGraph } from '@/lib/graph/schema';
import {
  classifyOpportunities,
  summariseOpportunities,
  OpportunityGenerationError,
} from '@/lib/graph/opportunity';
import { reviewRecords } from '@/lib/graph/reviews';
import { blockedReason, verificationState } from '@/lib/graph/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Classify the as-is activities by automation potential (delta v1.1 R5.5).
 *
 * Reads the stored as-is graph rather than re-extracting, so the labels attach to
 * the same activities the reviewer is looking at. Console-only, and everything
 * returned is `proposed` / `verified: false` — R5.5 puts these behind the same
 * human gate as the to-be change-set, because "this job could be automated" is a
 * claim about someone's work and should not reach a report unreviewed.
 */
export async function POST(_req: Request, { params }: { params: { sessionId: string } }) {
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
      { error: 'Draw the as-is process map first — the labels attach to its activities.' },
      { status: 409 },
    );
  }
  const asIs = processGraphSchema.safeParse(asIsRow.graph);
  if (!asIs.success) {
    return NextResponse.json({ error: 'The stored as-is graph is not valid.' }, { status: 500 });
  }

  async function respond(set: OpportunitySet, graph: ProcessGraph, cached: boolean) {
    const reviews = await reviewRecords(session!.id, spec!.version, 'opportunity');
    // The gate module counts items by index, so a classification set reviews
    // exactly like a change-set does.
    const state = verificationState(
      { baseGraph: set.graphRef, provenance: 'proposed', verified: false, changes: set.classifications.map((c) => ({
        op: 'modify' as const,
        target: c.activityId,
        description: c.rationale,
        resolvesAnnotationId: ['n/a'],
        rationale: c.rationale,
      })) },
      reviews,
    );
    return NextResponse.json({
      opportunities: set,
      summary: summariseOpportunities(set),
      activities: graph.activities.map((a) => ({ id: a.id, name: a.name })),
      review: state,
      blocked: blockedReason(state),
      cached,
    });
  }

  const stored = await getProcessGraph(session.id, spec.version, 'opportunity');
  if (stored?.changeSet) {
    return respond(stored.changeSet as OpportunitySet, asIs.data, true);
  }

  try {
    const set = await classifyOpportunities(asIs.data, spec.markdown);
    await saveProcessGraph({
      sessionId: session.id,
      specVersion: spec.version,
      kind: 'opportunity',
      // The graph column keys the row; the classifications live alongside it.
      graph: { graphRef: set.graphRef },
      changeSet: set,
    });
    return respond(set, asIs.data, false);
  } catch (err) {
    if (err instanceof OpportunityGenerationError) {
      return NextResponse.json({ error: err.message, details: err.errors }, { status: 422 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
