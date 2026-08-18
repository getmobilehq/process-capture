/**
 * Provider selection and the optional fallback.
 *
 * `TRANSCRIBE_PROVIDER` chooses. `TRANSCRIBE_FALLBACK` decides whether a failure
 * may be answered by the other provider — off by default, because a policy that
 * says "use Gemini" is not satisfied by a system that quietly uses OpenAI whenever
 * Gemini has a bad minute. When it is on, only *transient* failures fall back: a
 * safety block or a malformed request would fail identically on the other side,
 * and retrying it there just sends the audio somewhere else for no reason.
 *
 * Every result names the provider that produced it, so a switch is never silent
 * and a run of fallbacks is visible in the logs rather than inferred later.
 */
import { config } from '@/lib/config';
import { geminiProvider } from './gemini';
import { whisperProvider } from './whisper';
import { TranscribeError, type AudioInput, type TranscribeProvider, type Transcript } from './types';

export * from './types';
export { whisperExt } from './whisper';

const PROVIDERS: Record<string, TranscribeProvider> = {
  whisper: whisperProvider,
  gemini: geminiProvider,
};

export function primaryProvider(): TranscribeProvider {
  return PROVIDERS[config.transcribeProvider] ?? whisperProvider;
}

export function secondaryProvider(): TranscribeProvider {
  return config.transcribeProvider === 'gemini' ? whisperProvider : geminiProvider;
}

/** True when voice input can be served at all. */
export function transcriptionAvailable(): boolean {
  if (primaryProvider().isConfigured()) return true;
  return config.transcribeFallback && secondaryProvider().isConfigured();
}

export async function transcribe(audio: AudioInput): Promise<Transcript> {
  const primary = primaryProvider();
  const secondary = secondaryProvider();
  const mayFall = config.transcribeFallback && secondary.isConfigured();

  if (!primary.isConfigured()) {
    // The configured provider is not set up. Falling back here is legitimate only
    // if fallback is on — otherwise this is a misconfiguration to surface, not to
    // paper over.
    if (!mayFall) {
      throw new TranscribeError(
        `Voice input is set to ${primary.name}, which is not configured.`,
        primary.name,
        false,
      );
    }
    console.warn(`transcribe: ${primary.name} is not configured — using ${secondary.name}`);
    return secondary.transcribe(audio);
  }

  try {
    return await primary.transcribe(audio);
  } catch (err) {
    const e = err instanceof TranscribeError ? err : null;
    if (!mayFall || !e?.transient) throw err;

    console.warn(
      `transcribe: ${primary.name} failed transiently (${e.message}) — falling back to ${secondary.name}`,
    );
    return secondary.transcribe(audio);
  }
}
