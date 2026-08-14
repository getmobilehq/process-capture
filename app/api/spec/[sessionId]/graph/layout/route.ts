import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { isValidSession } from '@/lib/auth';
import { getLatestSpec, getProcessGraph, getSession, saveDiagramLayout } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  kind: z.enum(['asis', 'tobe', 'opportunity']).default('asis'),
  /** BPMN XML as the architect arranged it. Null restores the generated layout. */
  diagramXml: z.string().max(2_000_000).nullable(),
});

/**
 * Save or clear the architect's adjusted drawing (R5.6).
 *
 * Presentation only. The extracted graph is the evidence and is never written
 * here — moving a box changes where it sits, not what was said. That separation
 * is what makes "reset to generated layout" a safe thing to offer: clearing this
 * column cannot lose anything an informant told us.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const spec = await getLatestSpec(session.id);
  if (!spec) return NextResponse.json({ error: 'No specification yet.' }, { status: 409 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const existing = await getProcessGraph(session.id, spec.version, parsed.data.kind);
  if (!existing) {
    return NextResponse.json(
      { error: 'Draw that view first — there is no diagram to adjust.' },
      { status: 409 },
    );
  }

  const row = await saveDiagramLayout({
    sessionId: session.id,
    specVersion: spec.version,
    kind: parsed.data.kind,
    diagramXml: parsed.data.diagramXml,
  });

  return NextResponse.json({ adjusted: Boolean(row?.diagramXml) });
}
