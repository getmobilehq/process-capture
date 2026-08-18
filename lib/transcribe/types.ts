/**
 * Voice-to-text providers (V1.1 enhancement; provider abstraction August 2026).
 *
 * Transcription is optional throughout — an informant who cannot use the
 * microphone types instead and loses nothing. That is what makes it safe to have
 * more than one provider and to let a deployment refuse to fall back: the worst
 * outcome of a provider being unavailable is a typed answer.
 */
export interface Transcript {
  text: string;
  /** Which provider produced this. Recorded so a switch is never silent. */
  provider: TranscribeProviderName;
}

export type TranscribeProviderName = 'whisper' | 'gemini';

export interface AudioInput {
  bytes: Buffer;
  /** MIME type as recorded by the browser, e.g. audio/webm or audio/mp4. */
  mimeType: string;
  /** Original upload filename, where the browser gave one. */
  filename?: string;
}

export interface TranscribeProvider {
  readonly name: TranscribeProviderName;
  /** True when this provider has the configuration it needs to be called. */
  isConfigured(): boolean;
  transcribe(audio: AudioInput): Promise<Transcript>;
}

/** A provider failed in a way worth reporting, and possibly worth falling back from. */
export class TranscribeError extends Error {
  constructor(
    message: string,
    readonly provider: TranscribeProviderName,
    /** True for timeouts, resets, 429s and 5xx — the kind another provider might survive. */
    readonly transient: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TranscribeError';
  }
}

export const TRANSCRIBE_ATTEMPTS = 3;
export const TRANSCRIBE_TIMEOUT_MS = 60_000;
const RETRY_BACKOFF_MS = [400, 1200];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const backoffFor = (attempt: number) => RETRY_BACKOFF_MS[attempt - 1] ?? 1200;

/** 429 and 5xx are the provider's problem, not the request's. */
export const isTransientStatus = (status: number) => status === 429 || status >= 500;
