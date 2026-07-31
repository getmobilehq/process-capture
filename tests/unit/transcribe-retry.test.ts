import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The route reads the OpenAI key through lib/config at module scope, so stub the
// module rather than the environment — voice input is optional and the pilot .env
// may not carry a key.
vi.mock('@/lib/config', () => ({
  config: { openaiApiKey: 'sk-test', transcribeModel: 'whisper-1' },
}));

import { POST } from '@/app/api/transcribe/route';

function audioRequest(): Request {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(2048)], { type: 'audio/webm' }), 'reply.webm');
  // A distinct IP per request keeps the shared rate-limit buckets out of the way.
  return new Request('http://localhost/api/transcribe', {
    method: 'POST',
    body: form,
    headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
  });
}

const ok = () => new Response(JSON.stringify({ text: 'a spoken reply' }), { status: 200 });

describe('transcribe retries (transient connection blips)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rides out a connect timeout and returns the transcript', async () => {
    const timeout = Object.assign(new Error('fetch failed'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(audioRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: 'a spoken reply' });
  });

  it('retries a 429 and a 5xx from OpenAI', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(audioRequest());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
  });

  it('does not retry a 400 — a bad payload will not fix itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad audio', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(audioRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
  });

  it('gives up after three attempts and reports the service unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(audioRequest());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'Transcription service unreachable.' });
  });
});
