import { NextResponse } from 'next/server';
import { processUserTurn } from '@/lib/engine/engine';
import { getSession } from '@/lib/db/queries';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_CHARS = 4000; // input length cap

export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  // Rate limit the public write path: 40 turns/min per IP.
  const rl = rateLimit(`turn:${clientIp(req)}`, { limit: 40, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many messages — please slow down.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const session = getSession(params.sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { seq, content } = body as { seq?: unknown; content?: unknown };
  const seqNum = Number(seq);
  const text = typeof content === 'string' ? content.trim() : '';

  if (!Number.isInteger(seqNum) || seqNum < 1) {
    return NextResponse.json({ error: 'Invalid seq' }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }
  if (text.length > MAX_CONTENT_CHARS) {
    return NextResponse.json({ error: 'Message too long' }, { status: 413 });
  }

  try {
    const result = await processUserTurn(params.sessionId, { seq: seqNum, content: text });
    return NextResponse.json(result);
  } catch (err) {
    // A model call failed (rate limit, overload, timeout, network). The user's
    // message is preserved server-side (the turn is appended before the model
    // runs), so retrying the same seq is safe and idempotent.
    console.error('turn: processUserTurn failed', err);
    return NextResponse.json(
      { error: 'The assistant is briefly unavailable — please send that again.' },
      { status: 502 },
    );
  }
}
