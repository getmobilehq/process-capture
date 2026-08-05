import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { isValidSession } from '@/lib/auth';
import { config } from '@/lib/config';
import {
  getLatestSpec,
  getProcessGraph,
  getSession,
  listChangeReviews,
  recordChangeReview,
} from '@/lib/db/queries';
import { verificationState, type ReviewRecord } from '@/lib/graph/verification';
import type { ChangeSet } from '@/lib/graph/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  changeIndex: z.number().int().min(0),
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
/** Database rows → the shape the pure gate module expects. */
export async function reviewRecords(
  sessionId: string,
  specVersion: number,
): Promise<ReviewRecord[]> {
  return (await listChangeReviews(sessionId, specVersion)).map((r) => ({
    changeIndex: r.changeIndex,
    verdict: r.verdict,
    editedDescription: r.editedDescription,
    editedRationale: r.editedRationale,
    note: r.note,
    reviewer: r.reviewer,
    reviewedAt: r.reviewedAt,
  }));
}

export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  if (!config.toBeEnabled) {
    return NextResponse.json({ error: 'The to-be map is not enabled.' }, { status: 404 });
  }

  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const spec = await getLatestSpec(session.id);
  if (!spec) return NextResponse.json({ error: 'No specification yet.' }, { status: 409 });

  const row = await getProcessGraph(session.id, spec.version, 'tobe');
  if (!row?.changeSet) {
    return NextResponse.json(
      { error: 'Draw the to-be map first — there is nothing to review.' },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const changeSet = row.changeSet as ChangeSet;
  if (parsed.data.changeIndex >= changeSet.changes.length) {
    return NextResponse.json({ error: 'No such change' }, { status: 400 });
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
    verdict,
    editedDescription: parsed.data.editedDescription ?? null,
    editedRationale: parsed.data.editedRationale ?? null,
    note: parsed.data.note ?? '',
    // The console is a single shared login, so this is the honest attribution
    // available today rather than an invented identity (DL.62).
    reviewer: 'console admin',
  });

  return NextResponse.json({
    state: verificationState(changeSet, await reviewRecords(session.id, spec.version)),
  });
}
