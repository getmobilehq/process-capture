import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidSession } from '@/lib/auth';
import { processGraphSchema } from '@/lib/graph/schema';
import { generateChangeSet, ChangeSetGenerationError } from '@/lib/graph/changeset';
import { applyChangeSet, ChangeSetApplicationError } from '@/lib/graph/apply';
import { toBpmnXml } from '@/lib/graph/bpmn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate a to-be change-set from an as-is graph and return the applied graph
 * (delta v1.1 R5.4).
 *
 * Takes the graph in the body rather than re-extracting: the client already has
 * the as-is map, and re-extracting would risk generating changes against a
 * different graph than the one on screen. Once graphs are persisted (DL.38) this
 * should take a graph id instead.
 *
 * Console-only, and everything returned is `proposed` / `verified: false`. R5.4's
 * gate means none of this may reach a handover report until a human has reviewed
 * each change — and that review path is not built yet.
 */
export async function POST(req: Request) {
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = processGraphSchema.safeParse((body as { graph?: unknown })?.graph);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid as-is graph is required' }, { status: 400 });
  }

  try {
    const changeSet = await generateChangeSet(parsed.data);
    const applied = applyChangeSet(parsed.data, changeSet);
    return NextResponse.json({
      changeSet,
      graph: applied.graph,
      xml: toBpmnXml(applied.graph),
      changedIds: [...applied.changedIds],
      changes: [...applied.changeByNode.entries()],
      skipped: applied.skipped,
    });
  } catch (err) {
    if (err instanceof ChangeSetGenerationError || err instanceof ChangeSetApplicationError) {
      return NextResponse.json({ error: err.message, details: err.errors }, { status: 422 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
