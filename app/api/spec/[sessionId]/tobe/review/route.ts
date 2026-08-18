import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { assertSession, identityFromSession, SHARED_IDENTITY } from '@/lib/auth';
import { config } from '@/lib/config';
import {
  getLatestSpec,
  getProcessGraph,
  getSession,
  recordChangeReview,
} from '@/lib/db/queries';
import { verificationState } from '@/lib/graph/verification';
import { reviewRecords } from '@/lib/graph/reviews';
import type { ChangeSet } from '@/lib/graph/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  changeIndex: z.number().int().min(0),
  /** Which set is being reviewed — to-be changes, or opportunity labels (R5.5). */
  subject: z.enum(['change', 'opportunity']).optional().default('change'),
  verdict: z.enum(['approved', 'edited', 'rejected']),
  editedDescription: z.string().max(2000).optional(),
  editedRationale: z.string().max(2000).optional(),
  note: z.string().max(1000).optional(),
});

/**
 * Record a reviewer's verdict on one proposed change (delta v1.1 R5.4).
 *
 * Per change, not per set: approving four and rejecting a fifth is the normal
 * outcome, and a set-level flag cannot express it. The response returns the whole
 * verification state so the UI always shows what is still outstanding.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  const cookie = cookies().get('pc_admin')?.value;
  // assertSession, not isValidSession: this records who approved a recommendation
  // about someone's job, so a disabled account must be refused rather than
  // silently attributed to "console admin".
  if (!(await assertSession(cookie))) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  const identity = (await identityFromSession(cookie)) ?? SHARED_IDENTITY;
  if (!config.toBeEnabled) {
    return NextResponse.json({ error: 'The to-be map is not enabled.' }, { status: 404 });
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

  const subject = parsed.data.subject;
  const row = await getProcessGraph(
    session.id,
    spec.version,
    subject === 'opportunity' ? 'opportunity' : 'tobe',
  );
  if (!row?.changeSet) {
    return NextResponse.json(
      { error: 'Draw that view first — there is nothing to review.' },
      { status: 409 },
    );
  }

  // Both sets are reviewed by index, so the count is all the gate needs.
  const items =
    subject === 'opportunity'
      ? (row.changeSet as { classifications: unknown[] }).classifications
      : (row.changeSet as ChangeSet).changes;
  if (parsed.data.changeIndex >= items.length) {
    return NextResponse.json({ error: 'No such item' }, { status: 400 });
  }

  // An "edited" verdict without wording is really an approval; treat it as one
  // rather than storing an edit that changed nothing.
  const edited =
    (parsed.data.editedDescription ?? '').trim() || (parsed.data.editedRationale ?? '').trim();
  const verdict =
    parsed.data.verdict === 'edited' && !edited ? 'approved' : parsed.data.verdict;

  await recordChangeReview({
    sessionId: session.id,
    specVersion: spec.version,
    changeIndex: parsed.data.changeIndex,
    subject,
    verdict,
    editedDescription: parsed.data.editedDescription ?? null,
    editedRationale: parsed.data.editedRationale ?? null,
    note: parsed.data.note ?? '',
    // The person who actually ruled on this (SDD I-3). Falls back to "console
    // admin" only when the shared credential was used — which is the honest label
    // for a session nobody is named in.
    reviewer: identity.displayName,
    reviewerId: identity.userId,
  });

  const reviews = await reviewRecords(session.id, spec.version, subject);
  const asChanges =
    subject === 'opportunity'
      ? {
          baseGraph: 'opportunities',
          provenance: 'proposed' as const,
          verified: false,
          changes: (items as { activityId: string; rationale: string }[]).map((c) => ({
            op: 'modify' as const,
            target: c.activityId,
            description: c.rationale,
            resolvesAnnotationId: ['n/a'],
            rationale: c.rationale,
          })),
        }
      : (row.changeSet as ChangeSet);

  return NextResponse.json({ state: verificationState(asChanges, reviews) });
}
