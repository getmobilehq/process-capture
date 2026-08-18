/**
 * OpenAI Whisper provider.
 *
 * Unchanged in behaviour from the original route — the retry posture, the
 * extension detection and the size cap all moved here rather than being rewritten,
 * because they were arrived at by fixing real failures (DV.3) and none of that
 * knowledge should be lost to a refactor.
 */
import { config } from '@/lib/config';
import {
  backoffFor,
  isTransientStatus,
  sleep,
  TRANSCRIBE_ATTEMPTS,
  TRANSCRIBE_TIMEOUT_MS,
  TranscribeError,
  type AudioInput,
  type TranscribeProvider,
  type Transcript,
} from './types';

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
 * Whisper detects format from the filename extension, so prefer the uploaded
 * name's extension (reliable — the client sends reply.webm), then the MIME type,
 * then webm.
 */
export function whisperExt(audio: AudioInput): string {
  const name = audio.filename ?? '';
  const nameExt = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (WHISPER_EXTS.has(nameExt)) return nameExt;
  const base = (audio.mimeType || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[base] ?? 'webm';
}

export const whisperProvider: TranscribeProvider = {
  name: 'whisper',

  isConfigured() {
    return Boolean(config.openaiApiKey);
  },

  async transcribe(audio: AudioInput): Promise<Transcript> {
    const blob = new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType || 'audio/webm' });
    const filename = `reply.${whisperExt(audio)}`;

    // A FormData body is consumed on send, so rebuild it per attempt.
    const outbound = () => {
      const fd = new FormData();
      fd.append('file', blob, filename);
      fd.append('model', config.transcribeModel);
      fd.append('response_format', 'json');
      return fd;
    };

    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= TRANSCRIBE_ATTEMPTS; attempt += 1) {
      let resp: Response | null = null;
      try {
        resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.openaiApiKey}` },
          body: outbound(),
          signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
        });
      } catch (err) {
        // A cold connection to api.openai.com can exceed undici's default connect
        // budget and fail an informant's first voice reply. Worth another go.
        lastErr = err;
      }

      if (resp && !isTransientStatus(resp.status)) {
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          throw new TranscribeError(
            `Whisper returned ${resp.status}: ${body.slice(0, 200)}`,
            'whisper',
            false,
            resp.status,
          );
        }
        const data = (await resp.json()) as { text?: string };
        return { text: (data.text ?? '').trim(), provider: 'whisper' };
      }

      if (attempt < TRANSCRIBE_ATTEMPTS) {
        console.warn(
          `transcribe/whisper: attempt ${attempt} failed (${
            resp ? `HTTP ${resp.status}` : String(lastErr)
          }) — retrying`,
        );
        await sleep(backoffFor(attempt));
      } else if (resp) {
        throw new TranscribeError(`Whisper returned ${resp.status}`, 'whisper', true, resp.status);
      }
    }

    throw new TranscribeError(
      `Whisper unreachable: ${String(lastErr)}`,
      'whisper',
      true,
    );
  },
};
