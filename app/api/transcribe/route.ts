import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whisper's hard limit is 25 MB; cap below that.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

const WHISPER_EXTS = new Set([
  'flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm',
]);

const MIME_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

/**
 * Pick a Whisper-recognised extension, preferring the uploaded filename's
 * extension (reliable — the client sends reply.webm), falling back to the MIME
 * type, then webm.
 */
function whisperExt(audio: Blob & { name?: string }): string {
  const name = typeof audio.name === 'string' ? audio.name : '';
  const nameExt = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (WHISPER_EXTS.has(nameExt)) return nameExt;
  const base = (audio.type || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[base] ?? 'webm';
}

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

  // Re-buffer the incoming blob into a fresh one — the File from req.formData()
  // does not re-stream reliably when handed to an outbound fetch in Node.
  const buffer = Buffer.from(await audio.arrayBuffer());
  // Whisper detects format from the filename extension, so derive it from the
  // recorded MIME type (Chrome/Firefox → webm, Safari → mp4, etc.).
  const fresh = new Blob([buffer], { type: audio.type || 'audio/webm' });

  const outbound = new FormData();
  outbound.append('file', fresh, `reply.${whisperExt(audio)}`);
  outbound.append('model', config.transcribeModel);
  outbound.append('response_format', 'json');

  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: outbound,
    });
  } catch (err) {
    console.error('transcribe: fetch failed', err);
    return NextResponse.json({ error: 'Transcription service unreachable.' }, { status: 502 });
  }

  if (!resp.ok) {
    console.error('transcribe: OpenAI error', resp.status, await resp.text().catch(() => ''));
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 502 });
  }

  const data = (await resp.json()) as { text?: string };
  return NextResponse.json({ text: (data.text ?? '').trim() });
}
