import { NextResponse } from 'next/server';
import { processUserTurn } from '@/lib/engine/engine';
import { getSession } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_CHARS = 4000; // input length cap (hardened further in Phase 7)

export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
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

  const result = await processUserTurn(params.sessionId, { seq: seqNum, content: text });
  return NextResponse.json(result);
}
