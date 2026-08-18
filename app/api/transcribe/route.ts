import { NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { transcribe, transcriptionAvailable, TranscribeError } from '@/lib/transcribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whisper's hard limit is 25 MB and Vertex's inline-data limit is lower still;
// cap below both. A recording this long is a sign the chunking failed, not a
// legitimate reply.
const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

/**
 * Transcribe an audio blob (optional voice input, V1.1).
 *
 * Provider-agnostic since August 2026: `TRANSCRIBE_PROVIDER` selects Gemini via
 * Vertex AI or OpenAI Whisper, and neither credential ever reaches the browser.
 * The response names the provider that answered, so a fallback is visible rather
 * than inferred.
 *
 * Every failure here is recoverable by the informant typing instead, which is why
 * the interview does not depend on any of this working.
 */
export async function POST(req: Request) {
  if (!transcriptionAvailable()) {
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

  // Re-buffer the incoming blob — the File from req.formData() does not re-stream
  // reliably when handed to an outbound fetch in Node.
  const bytes = Buffer.from(await audio.arrayBuffer());
  const filename = typeof (audio as Blob & { name?: string }).name === 'string'
    ? (audio as Blob & { name?: string }).name
    : undefined;

  try {
    const result = await transcribe({
      bytes,
      mimeType: audio.type || 'audio/webm',
      filename,
    });
    return NextResponse.json({ text: result.text, provider: result.provider });
  } catch (err) {
    if (err instanceof TranscribeError) {
      console.error(`transcribe: ${err.provider} failed —`, err.message);
      // The informant is told it did not work, not which vendor let us down.
      return NextResponse.json({ error: 'Transcription failed.' }, { status: 502 });
    }
    console.error('transcribe: unexpected failure', err);
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 502 });
  }
}
