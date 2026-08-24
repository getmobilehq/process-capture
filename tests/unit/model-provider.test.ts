import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The provider switch (P5 — models are configuration).
 *
 * `config` reads the environment once at module scope, so each case has to reset
 * the module registry rather than just set a variable. That is the same trap the
 * transcription probe hit: setting the provider after the import has already
 * frozen it changes nothing.
 */
const env = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...env };
});

async function clientFor(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  const { getClient, resetClient } = await import('@/lib/engine/model');
  resetClient();
  return getClient();
}

describe('interview model provider', () => {
  it('defaults to the direct Anthropic API, so an existing deployment is untouched', async () => {
    delete process.env.MODEL_PROVIDER;
    const { config } = await import('@/lib/config');
    expect(config.modelProvider).toBe('anthropic');

    const c = await clientFor({ ANTHROPIC_API_KEY: 'sk-test' });
    expect(c.constructor.name).toBe('Anthropic');
  });

  it('uses Vertex when asked, with no API key involved', async () => {
    const c = await clientFor({
      MODEL_PROVIDER: 'vertex',
      VERTEX_PROJECT: 'vmo2-magpie-prod',
      ANTHROPIC_API_KEY: '',
    });
    expect(c.constructor.name).toBe('AnthropicVertex');
  });

  it('refuses Vertex without a project rather than failing at the first interview', async () => {
    process.env.MODEL_PROVIDER = 'vertex';
    delete process.env.VERTEX_PROJECT;
    const { getClient, resetClient } = await import('@/lib/engine/model');
    resetClient();
    expect(() => getClient()).toThrow(/VERTEX_PROJECT/);
  });

  it('defaults the model region to one that actually serves Claude', async () => {
    // europe-west2 runs transcription but serves no Anthropic model at all, so
    // inheriting VERTEX_REGION here would 404 every interview turn.
    process.env.MODEL_PROVIDER = 'vertex';
    process.env.VERTEX_REGION = 'europe-west2';
    delete process.env.VERTEX_MODEL_REGION;
    const { config } = await import('@/lib/config');
    expect(config.vertexModelRegion).toBe('europe-west1');
    expect(config.vertexModelRegion).not.toBe(config.vertexRegion);
  });

  it('keeps transcription and the interview model independently regioned', async () => {
    process.env.VERTEX_REGION = 'europe-west2';
    process.env.VERTEX_MODEL_REGION = 'us-east5';
    const { config } = await import('@/lib/config');
    expect(config.vertexRegion).toBe('europe-west2');
    expect(config.vertexModelRegion).toBe('us-east5');
  });

  it('caches the client, and releases it when the provider changes', async () => {
    const a = await clientFor({ ANTHROPIC_API_KEY: 'sk-test' });
    const { getClient, resetClient } = await import('@/lib/engine/model');
    expect(getClient()).toBe(a);
    resetClient();
    expect(getClient()).not.toBe(a);
  });
});
