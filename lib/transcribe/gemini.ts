/**
 * Gemini provider, via Vertex AI in our own GCP project.
 *
 * Vertex rather than the Gemini API on purpose, and for the same reason Bedrock
 * and Vertex were the right answer for the base model: access is the platform's
 * own identity, so there is no third-party API key to issue, rotate or govern, and
 * the audio does not leave the project. On Cloud Run the credentials are the
 * service account's, resolved through Application Default Credentials — locally,
 * `gcloud auth application-default login` supplies the same.
 *
 * Gemini has no dedicated transcription endpoint. Audio is sent inline to
 * generateContent with an instruction to transcribe, which means two things worth
 * stating plainly: the model could in principle answer rather than transcribe, and
 * it could refuse. The prompt is written to make transcription the only reasonable
 * response, and an empty result is reported rather than passed off as silence.
 */
import { GoogleAuth } from 'google-auth-library';
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

/**
 * The instruction is deliberately narrow. Anything conversational invites the
 * model to answer the informant's words instead of writing them down, which
 * produces a plausible transcript of a conversation that never happened.
 */
const INSTRUCTION = `Transcribe this audio to text, exactly as spoken, in British English.

Rules:
- Write only what was said. Do not answer it, summarise it, translate it or comment on it.
- Keep hesitations and false starts out; keep the meaning and the wording in.
- Use standard punctuation and sentence case. Numbers and currency as spoken — "twenty-five pounds" if that is what you hear, "£25" if they said "pound sign twenty five".
- Do not add a preamble, a heading, quotation marks, or any note about the audio.
- If the audio contains no discernible speech, return nothing at all.`;

/** Vertex accepts these directly; anything else is transcoded-by-hope, so reject it. */
const SUPPORTED = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/aac',
]);

function normaliseMime(mime: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  if (SUPPORTED.has(base)) return base;
  // Chrome and Firefox record webm; Safari records mp4. Anything unrecognised is
  // most likely webm from a browser that under-reported it.
  return 'audio/webm';
}

let auth: GoogleAuth | null = null;
function googleAuth(): GoogleAuth {
  if (!auth) {
    auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return auth;
}

function endpoint(): string {
  const region = config.vertexRegion;
  const host =
    region === 'global'
      ? 'aiplatform.googleapis.com'
      : `${region}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config.vertexProject}/locations/${region}/publishers/google/models/${config.geminiTranscribeModel}:generateContent`;
}

export const geminiProvider: TranscribeProvider = {
  name: 'gemini',

  isConfigured() {
    return Boolean(config.vertexProject);
  },

  async transcribe(audio: AudioInput): Promise<Transcript> {
    if (!config.vertexProject) {
      throw new TranscribeError('Vertex project is not configured.', 'gemini', false);
    }

    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: INSTRUCTION },
            {
              inlineData: {
                mimeType: normaliseMime(audio.mimeType),
                data: audio.bytes.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        // Transcription is not a creative task; the same audio should give the
        // same words.
        temperature: 0,
        maxOutputTokens: 4096,
      },
    });

    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= TRANSCRIBE_ATTEMPTS; attempt += 1) {
      let resp: Response | null = null;
      try {
        // Fetched per attempt: a token can expire between retries, and the client
        // caches internally so this is cheap after the first call.
        const token = await googleAuth().getAccessToken();
        if (!token) {
          throw new TranscribeError(
            'No Google credentials available. On Cloud Run this is the service account; locally, run `gcloud auth application-default login`.',
            'gemini',
            false,
          );
        }

        resp = await fetch(endpoint(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
        });
      } catch (err) {
        if (err instanceof TranscribeError) throw err;
        lastErr = err;
      }

      if (resp && !isTransientStatus(resp.status)) {
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new TranscribeError(
            `Vertex returned ${resp.status}: ${text.slice(0, 200)}`,
            'gemini',
            false,
            resp.status,
          );
        }

        const data = (await resp.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
          promptFeedback?: { blockReason?: string };
        };

        const blocked = data.promptFeedback?.blockReason;
        if (blocked) {
          // A safety block on someone describing their own job is a false
          // positive, but it is not ours to override — say so plainly.
          throw new TranscribeError(
            `Vertex declined to transcribe this audio (${blocked}).`,
            'gemini',
            false,
          );
        }

        const candidate = data.candidates?.[0];
        const text = (candidate?.content?.parts ?? [])
          .map((p) => p.text ?? '')
          .join('')
          .trim();

        if (candidate?.finishReason === 'MAX_TOKENS') {
          throw new TranscribeError(
            'The recording was too long to transcribe in one piece.',
            'gemini',
            false,
          );
        }

        return { text, provider: 'gemini' };
      }

      if (attempt < TRANSCRIBE_ATTEMPTS) {
        console.warn(
          `transcribe/gemini: attempt ${attempt} failed (${
            resp ? `HTTP ${resp.status}` : String(lastErr)
          }) — retrying`,
        );
        await sleep(backoffFor(attempt));
      } else if (resp) {
        throw new TranscribeError(`Vertex returned ${resp.status}`, 'gemini', true, resp.status);
      }
    }

    throw new TranscribeError(`Vertex unreachable: ${String(lastErr)}`, 'gemini', true);
  },
};
