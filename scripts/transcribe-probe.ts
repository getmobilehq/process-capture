/**
 * Prove voice-to-text works against the real provider, with real audio.
 *
 * Unit tests mock the network, so they prove the plumbing and none of the
 * behaviour that matters here: whether Vertex accepts our audio format, whether
 * the model transcribes rather than answers, and whether the credentials resolve.
 * This calls the provider for real.
 *
 * Usage:
 *   npm run transcribe:probe -- --file recording.mp4 [--provider gemini|whisper]
 *
 * Needs `gcloud auth application-default login` for Gemini, or OPENAI_API_KEY for
 * Whisper. Costs a fraction of a penny per run.
 */
import './load-env';
import { readFileSync } from 'node:fs';
import { transcribe, primaryProvider } from '@/lib/transcribe';
import { config } from '@/lib/config';

function parseArgs() {
  const args = process.argv.slice(2);
  let file: string | null = null;
  let provider: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--file') file = args[++i];
    else if (args[i] === '--provider') provider = args[++i];
  }
  return { file, provider };
}

const MIME: Record<string, string> = {
  webm: 'audio/webm',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

async function main() {
  const { file, provider } = parseArgs();
  if (!file) {
    console.error('Usage: npm run transcribe:probe -- --file <audio> [--provider gemini|whisper]');
    process.exit(2);
  }
  if (provider) process.env.TRANSCRIBE_PROVIDER = provider;

  const bytes = readFileSync(file);
  const ext = file.split('.').pop()?.toLowerCase() ?? 'webm';
  const mimeType = MIME[ext] ?? 'audio/webm';

  console.log(
    `Provider : ${config.transcribeProvider} (${primaryProvider().isConfigured() ? 'configured' : 'NOT configured'})`,
  );
  if (config.transcribeProvider === 'gemini') {
    console.log(
      `Vertex   : ${config.vertexProject || '(unset)'} · ${config.vertexRegion} · ${config.geminiTranscribeModel}`,
    );
  }
  console.log(`Audio    : ${file} · ${mimeType} · ${(bytes.length / 1024).toFixed(1)} kB`);
  console.log(`Fallback : ${config.transcribeFallback ? 'on' : 'off'}\n`);

  const started = Date.now();
  const result = await transcribe({ bytes, mimeType, filename: file.split('/').pop() });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Answered by: ${result.provider} in ${secs}s\n`);
  console.log(result.text || '(nothing transcribed)');
}

main().catch((err: unknown) => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
