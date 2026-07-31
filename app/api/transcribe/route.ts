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

// Transient-blip posture, mirroring the Anthropic client in lib/engine/model.ts
// (maxRetries 4, 60s). A cold connection to api.openai.com can exceed undici's
// default 10s connect budget and fail the informant's first voice reply.
const TRANSCRIBE_ATTEMPTS = 3;
const TRANSCRIBE_TIMEOUT_MS = 60_000;
const RETRY_BACKOFF_MS = [400, 1200];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const filename = `reply.${whisperExt(audio)}`;

  // A FormData body is consumed on send, so rebuild it per attempt.
  function outbound(): FormData {
    const fd = new FormData();
    fd.append('file', fresh, filename);
    fd.append('model', config.transcribeModel);
    fd.append('response_format', 'json');
    return fd;
  }

  let resp: Response | null = null;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= TRANSCRIBE_ATTEMPTS; attempt++) {
    try {
      resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openaiApiKey}` },
        body: outbound(),
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });
    } catch (err) {
      // Connect timeouts and resets are worth another go; anything else is not.
      lastErr = err;
      resp = null;
    }

    // 429 and 5xx are transient on OpenAI's side — retry those too.
    if (resp && !(resp.status === 429 || resp.status >= 500)) break;

    if (attempt < TRANSCRIBE_ATTEMPTS) {
      console.warn(
        `transcribe: attempt ${attempt} failed (${resp ? `HTTP ${resp.status}` : String(lastErr)}) — retrying`,
      );
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 1200);
    }
  }

  if (!resp) {
    console.error('transcribe: fetch failed after retries', lastErr);
    return NextResponse.json({ error: 'Transcription service unreachable.' }, { status: 502 });
  }

  if (!resp.ok) {
    console.error('transcribe: OpenAI error', resp.status, await resp.text().catch(() => ''));
    return NextResponse.json({ error: 'Transcription failed.' }, { status: 502 });
  }

  const data = (await resp.json()) as { text?: string };
  return NextResponse.json({ text: (data.text ?? '').trim() });
}
