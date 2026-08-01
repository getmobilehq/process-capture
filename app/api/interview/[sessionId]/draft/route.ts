import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  discardDraft,
  getActiveDraft,
  getSession,
  getUndoableDraft,
  saveDraft,
  startNewTake,
  undoDiscard,
} from '@/lib/db/queries';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DRAFT_CHARS = 20_000;

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    seq: z.number().int().positive(),
    content: z.string().max(MAX_DRAFT_CHARS),
    origin: z.enum(['typed', 'voice', 'mixed']).optional(),
  }),
  z.object({ action: z.literal('discard') }),
  z.object({ action: z.literal('undo') }),
  z.object({ action: z.literal('rerecord'), seq: z.number().int().positive() }),
]);

function view(row: { content: string; seq: number; take: number; status: string } | undefined) {
  return row ? { content: row.content, seq: row.seq, take: row.take, status: row.status } : null;
}

/**
 * Draft persistence for the answer composer (delta v1.1 R10.3).
 *
 * Autosave is generous with writes and stingy with destruction: nothing here
 * removes a row. Discard is reversible for the rest of the session, and a
 * re-record archives the prior take rather than overwriting it — so no sequence of
 * two taps can permanently destroy a transcription.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  // Autosave is chatty by design; the cap is high enough not to throttle typing.
  const rl = rateLimit(`draft:${clientIp(req)}`, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many saves — please slow down.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const session = getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  switch (parsed.data.action) {
    case 'save': {
      const row = saveDraft({
        sessionId: session.id,
        seq: parsed.data.seq,
        content: parsed.data.content,
        origin: parsed.data.origin,
      });
      return NextResponse.json({ draft: view(row), canUndo: Boolean(getUndoableDraft(session.id)) });
    }
    case 'discard': {
      discardDraft(session.id);
      return NextResponse.json({ draft: null, canUndo: Boolean(getUndoableDraft(session.id)) });
    }
    case 'undo': {
      const row = undoDiscard(session.id);
      if (!row) return NextResponse.json({ error: 'Nothing to undo.' }, { status: 409 });
      return NextResponse.json({ draft: view(row), canUndo: Boolean(getUndoableDraft(session.id)) });
    }
    case 'rerecord': {
      const row = startNewTake(session.id, parsed.data.seq);
      return NextResponse.json({ draft: view(row), canUndo: Boolean(getUndoableDraft(session.id)) });
    }
  }
}

/** Session recovery (R10.3): what was unsubmitted when the tab went away. */
export async function GET(_req: Request, { params }: { params: { sessionId: string } }) {
  const session = getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  return NextResponse.json({
    draft: view(getActiveDraft(session.id)),
    canUndo: Boolean(getUndoableDraft(session.id)),
  });
}
