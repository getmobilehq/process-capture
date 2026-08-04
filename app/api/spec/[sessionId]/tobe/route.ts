import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidSession } from '@/lib/auth';
import {
  getLatestSpec,
  getProcessGraph,
  getSession,
  saveProcessGraph,
} from '@/lib/db/queries';
import { processGraphSchema, type ChangeSet, type ProcessGraph } from '@/lib/graph/schema';
import { generateChangeSet, ChangeSetGenerationError } from '@/lib/graph/changeset';
import { applyChangeSet, ChangeSetApplicationError } from '@/lib/graph/apply';
import { toBpmnXml } from '@/lib/graph/bpmn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate a to-be change-set from the stored as-is graph and return the applied
 * graph (delta v1.1 R5.4).
 *
 * The as-is graph is read from the store, never taken from the request: a
 * change-set is only meaningful against the exact graph it was proposed for, and
 * accepting one over the wire would let a client key changes to a graph nobody
 * else can see. Both the change-set and the derived graph are persisted, so a
 * reviewer returns to the same proposal they left.
 *
 * Everything returned is `proposed` / `verified: false`. R5.4's gate means none of
 * it may reach a handover report until a human has reviewed each change, and that
 * review path is not built yet.
 */
export async function POST(_req: Request, { params }: { params: { sessionId: string } }) {
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const spec = await getLatestSpec(session.id);
  if (!spec) {
    return NextResponse.json({ error: 'This interview has no specification yet.' }, { status: 409 });
  }

  const asIsRow = await getProcessGraph(session.id, spec.version, 'asis');
  if (!asIsRow) {
    return NextResponse.json(
      { error: 'Draw the as-is process map first — changes are proposed against it.' },
      { status: 409 },
    );
  }

  const asIs = processGraphSchema.safeParse(asIsRow.graph);
  if (!asIs.success) {
    return NextResponse.json({ error: 'The stored as-is graph is not valid.' }, { status: 500 });
  }

  // A to-be already proposed for this spec version is returned as-is, so a
  // reviewer comes back to the same proposal rather than a freshly generated one.
  const storedToBe = await getProcessGraph(session.id, spec.version, 'tobe');
  if (storedToBe) {
    const graph = storedToBe.graph as ProcessGraph;
    const changeSet = storedToBe.changeSet as ChangeSet;
    const applied = applyChangeSet(asIs.data, changeSet);
    return NextResponse.json({
      changeSet,
      graph,
      xml: toBpmnXml(graph),
      changedIds: [...applied.changedIds],
      changes: [...applied.changeByNode.entries()],
      skipped: applied.skipped,
      cached: true,
    });
  }

  try {
    const changeSet = await generateChangeSet(asIs.data);
    const applied = applyChangeSet(asIs.data, changeSet);
    await saveProcessGraph({
      sessionId: session.id,
      specVersion: spec.version,
      kind: 'tobe',
      graph: applied.graph,
      changeSet,
    });
    return NextResponse.json({
      changeSet,
      graph: applied.graph,
      xml: toBpmnXml(applied.graph),
      changedIds: [...applied.changedIds],
      changes: [...applied.changeByNode.entries()],
      skipped: applied.skipped,
      cached: false,
    });
  } catch (err) {
    if (err instanceof ChangeSetGenerationError || err instanceof ChangeSetApplicationError) {
      return NextResponse.json({ error: err.message, details: err.errors }, { status: 422 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
