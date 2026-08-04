import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getSession,
  picklistOptions,
  recordEntityMention,
  upsertEntity,
} from '@/lib/db/queries';
import { entityKindFor, isPicklistFacet } from '@/lib/facets/facets';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  facetId: z.number().int().min(1).max(12),
  /** Tick a seeded option. */
  entityId: z.string().min(1).optional(),
  /** Or the "other — describe" escape hatch (R2.1). */
  name: z.string().min(1).max(120).optional(),
});

/**
 * The interviewee ticks a pick-list option, or describes one that is not on the
 * list (delta v1.1 R2.1). Selections write canonical entity ids, never free text
 * (R2.3); a described entity is created `pending` for admin confirmation.
 *
 * Ticking is additive only — there is no untick. A mention is evidence that the
 * informant said something, and evidence is not walked backwards (P2); a
 * correction is a matter for the conversation, not a checkbox.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  const rl = rateLimit(`entity:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many changes — please slow down.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  if (session.status === 'complete' || session.status === 'abandoned') {
    return NextResponse.json({ error: 'This interview is closed.' }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { facetId, entityId, name } = parsed.data;
  if (!isPicklistFacet(facetId)) {
    return NextResponse.json({ error: 'That facet is not a pick-list.' }, { status: 400 });
  }
  const kind = entityKindFor(facetId)!;

  let resolvedId: string;
  if (entityId) {
    resolvedId = entityId;
  } else if (name) {
    resolvedId = (await upsertEntity({ projectId: session.projectId, kind, name })).id;
  } else {
    return NextResponse.json({ error: 'Nothing to record' }, { status: 400 });
  }

  await recordEntityMention({
    sessionId: session.id,
    entityId: resolvedId,
    facetId,
    source: 'this_interview',
  });

  return NextResponse.json({ options: await picklistOptions(session.id, facetId) });
}
