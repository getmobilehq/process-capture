import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = {
  provider: 'whisper' as 'whisper' | 'gemini',
  fallback: false,
  openaiApiKey: 'sk-test',
  vertexProject: 'proj',
  vertexRegion: 'europe-west2',
  geminiTranscribeModel: 'gemini-2.5-flash',
  transcribeModel: 'whisper-1',
};

vi.mock('@/lib/config', () => ({
  config: {
    get transcribeProvider() { return state.provider; },
    get transcribeFallback() { return state.fallback; },
    get openaiApiKey() { return state.openaiApiKey; },
    get vertexProject() { return state.vertexProject; },
    get vertexRegion() { return state.vertexRegion; },
    get geminiTranscribeModel() { return state.geminiTranscribeModel; },
    get transcribeModel() { return state.transcribeModel; },
  },
}));

const getAccessToken = vi.fn(async () => 'ya29.token');
vi.mock('google-auth-library', () => ({
  GoogleAuth: class { getAccessToken = getAccessToken; },
}));

import { transcribe, transcriptionAvailable, whisperExt, TranscribeError } from '@/lib/transcribe';

const audio = (mimeType = 'audio/webm', filename?: string) => ({
  bytes: Buffer.from('fake-audio'),
  mimeType,
  filename,
});

const whisperOk = (text: string) =>
  new Response(JSON.stringify({ text }), { status: 200, headers: { 'content-type': 'application/json' } });

const geminiOk = (text: string) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.provider = 'whisper';
  state.fallback = false;
  state.openaiApiKey = 'sk-test';
  state.vertexProject = 'proj';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('provider selection', () => {
  it('uses Whisper when that is the configured provider', async () => {
    fetchMock.mockResolvedValueOnce(whisperOk('  spoken words  '));
    const r = await transcribe(audio());
    expect(r).toEqual({ text: 'spoken words', provider: 'whisper' });
    expect(fetchMock.mock.calls[0][0]).toContain('api.openai.com');
  });

  it('uses Gemini via Vertex when that is the configured provider', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValueOnce(geminiOk('spoken words'));
    const r = await transcribe(audio());
    expect(r).toEqual({ text: 'spoken words', provider: 'gemini' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('europe-west2-aiplatform.googleapis.com');
    expect(url).toContain('/projects/proj/locations/europe-west2/');
    expect(url).toContain('gemini-2.5-flash:generateContent');
  });

  it('authenticates to Vertex with the service account, never an API key', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValueOnce(geminiOk('x'));
    await transcribe(audio());
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.Authorization).toBe('Bearer ya29.token');
    expect(JSON.stringify(init)).not.toContain('sk-test');
  });

  it('tells Gemini to transcribe rather than answer', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValueOnce(geminiOk('x'));
    await transcribe(audio());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    const instruction = body.contents[0].parts[0].text as string;
    expect(instruction).toMatch(/Do not answer it/i);
    expect(instruction).toMatch(/British English/i);
    expect(body.generationConfig.temperature).toBe(0);
  });
});

describe('fallback policy', () => {
  // The rule the whole change turns on.
  it('does NOT fall back by default — a Gemini policy is not met by quietly using OpenAI', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValue(new Response('upstream boom', { status: 503 }));
    await expect(transcribe(audio())).rejects.toThrow(TranscribeError);
    expect(fetchMock.mock.calls.every(([u]) => String(u).includes('aiplatform'))).toBe(true);
  });

  it('falls back on a transient failure when fallback is switched on', async () => {
    state.provider = 'gemini';
    state.fallback = true;
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(whisperOk('rescued'));
    const r = await transcribe(audio());
    expect(r).toEqual({ text: 'rescued', provider: 'whisper' });
  });

  it('does not fall back on a non-transient failure — it would fail the same way', async () => {
    state.provider = 'gemini';
    state.fallback = true;
    fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }));
    await expect(transcribe(audio())).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses rather than silently switching when the chosen provider is unconfigured', async () => {
    state.provider = 'gemini';
    state.vertexProject = '';
    await expect(transcribe(audio())).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports availability from whichever providers are actually usable', () => {
    state.provider = 'gemini';
    state.vertexProject = '';
    state.fallback = false;
    expect(transcriptionAvailable()).toBe(false);
    state.fallback = true;
    expect(transcriptionAvailable()).toBe(true);
  });
});

describe('gemini result handling', () => {
  it('surfaces a safety block instead of returning an empty transcript', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }),
    );
    await expect(transcribe(audio())).rejects.toThrow(/declined to transcribe/);
  });

  it('reports a truncated transcript rather than passing off half an answer', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'half' }] }, finishReason: 'MAX_TOKENS' }] }),
        { status: 200 },
      ),
    );
    await expect(transcribe(audio())).rejects.toThrow(/too long/);
  });

  it('normalises an unrecognised MIME type rather than sending it on', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValueOnce(geminiOk('x'));
    await transcribe(audio('audio/x-weird-codec'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/webm');
  });

  it('passes a supported MIME type through untouched', async () => {
    state.provider = 'gemini';
    fetchMock.mockResolvedValueOnce(geminiOk('x'));
    await transcribe(audio('audio/mp4'));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/mp4');
  });
});

describe('whisper extension detection (unchanged behaviour)', () => {
  it('prefers the filename extension', () => {
    expect(whisperExt({ bytes: Buffer.alloc(0), mimeType: 'audio/webm', filename: 'reply.mp4' })).toBe('mp4');
  });
  it('falls back to the MIME type', () => {
    expect(whisperExt({ bytes: Buffer.alloc(0), mimeType: 'audio/mpeg' })).toBe('mp3');
  });
  it('defaults to webm', () => {
    expect(whisperExt({ bytes: Buffer.alloc(0), mimeType: 'audio/unknown' })).toBe('webm');
  });
});
