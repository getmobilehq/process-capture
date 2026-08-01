import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getElements, getSession, setElement } from '@/lib/db/queries';
import { elementBelongsToFacet, getElement } from '@/lib/facets/facets';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REASON_CHARS = 300;

const bodySchema = z.object({
  elementId: z.string().min(1),
  reason: z.string().max(MAX_REASON_CHARS).optional().default(''),
});

/**
 * The interviewee's own not-applicable path (delta v1.1 R1.3). They can close a
 * checklist element the process genuinely does not have, with a short reason,
 * without waiting to be asked about it.
 *
 * Deliberately narrow: this endpoint can only mark not_applicable. Capturing
 * content stays with the engine, so a public caller can never assert that
 * something was answered.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  const rl = rateLimit(`element:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many changes — please slow down.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const session = getSession(params.sessionId);
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
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const element = getElement(parsed.data.elementId);
  if (!element || !elementBelongsToFacet(element.id, element.facetId)) {
    return NextResponse.json({ error: 'Unknown element' }, { status: 400 });
  }

  setElement({
    sessionId: session.id,
    facetId: element.facetId,
    elementId: element.id,
    state: 'not_applicable',
    naReason: parsed.data.reason.trim(),
  });

  return NextResponse.json({
    elements: getElements(session.id).map((r) => ({
      facetId: r.facetId,
      elementId: r.elementId,
      state: r.state,
      summary: r.summary,
      naReason: r.naReason,
    })),
  });
}
