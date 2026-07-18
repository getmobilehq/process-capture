import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whisper's hard limit is 25 MB; cap below that.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/**
 * Transcribe an audio blob via OpenAI Whisper (optional voice input, V1.1). The
 * OpenAI key is read server-side and never exposed to the browser. Returns the
 * transcript text for the client to place in the reply box for review.
 */
export async function POST(req: Request) {
  if (!config.openaiApiKey) {
    return NextResponse.json({ error: 'Voice input is not configured.' }, { status: 503 });
  }

  const rl = rateLimit(`transcribe:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many voice requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: 'No audio provided.' }, { status: 400 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: 'Empty audio.' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Recording too long.' }, { status: 413 });
  }

  const outbound = new FormData();
  outbound.append('file', audio, 'reply.webm');
  outbound.append('model', config.transcribeModel);
  outbound.append('response_format', 'json');

  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: outbound,
    });
  } catch {
    return NextResponse.json({ error: 'Transcription service unreachable.' }, { status: 502 });
  }

  if (!resp.ok) {
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 502 });
  }

  const data = (await resp.json()) as { text?: string };
  return NextResponse.json({ text: (data.text ?? '').trim() });
}
