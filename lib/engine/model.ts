/**
 * Model call boundary. The engine talks to the model only through `callModel`.
 * When MOCK_MODEL=1 it routes to a deterministic scripted responder (lib/engine/
 * mock.ts) so every gate below the live-model phase runs offline and reproducibly.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { config } from '@/lib/config';
import type { DB } from '@/lib/db';
import { TOOL_DEFINITIONS } from './tools';
import { mockRespond } from './mock';
import { addUsage } from '@/lib/usage';

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelResponse {
  stopReason: 'end_turn' | 'tool_use' | 'other';
  /** Concatenated text blocks (the agent's message to the informant). */
  text: string;
  toolCalls: ModelToolCall[];
  /** Assistant content blocks to append to the transcript for the next call. */
  assistantContent: Anthropic.MessageParam['content'];
}

export interface CallParams {
  sessionId: string;
  system: string;
  messages: Anthropic.MessageParam[];
  /** Name of the last tool applied in this turn's loop (drives the mock only). */
  lastAppliedTool: string | null;
  /** Omit tool definitions (used for the opening / question phase, no tools). */
  noTools?: boolean;
  /** Force the model to call at least one tool this call (extraction phase). */
  toolChoice?: 'auto' | 'any';
  db: DB;
}

/**
 * What the engine actually needs from a client: the messages resource, nothing
 * else. Narrower than either concrete class, which is the point — the two clients
 * share no base that carries `messages`, and this states the real contract rather
 * than casting one into a pretence of being the other.
 */
export interface ModelClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number; maxRetries?: number },
    ): Promise<Anthropic.Message>;
  };
}

let client: ModelClient | null = null;
/**
 * Shared client, so extraction passes inherit the same retry posture (R5.1).
 *
 * Two ways to reach the same models. The direct API takes a key; Vertex takes the
 * ambient Google credentials — on Cloud Run that is the service account, so there
 * is no key to issue, rotate or govern, and interview content never leaves the
 * project. Both clients extend `BaseAnthropic` and expose the identical
 * `messages.create`, which is what lets this be a branch here and nothing at all
 * anywhere else: the engine, the six analysis call sites and every tool
 * definition are unchanged.
 */
export function getClient(): ModelClient {
  if (client) return client;

  // Extra retries + a generous timeout ride out transient connection blips
  // (EHOSTUNREACH / fetch failed), which otherwise abort a turn or an eval run.
  const shared = { maxRetries: 4, timeout: 60_000 };

  if (config.modelProvider === 'vertex') {
    if (!config.vertexProject) {
      throw new Error('MODEL_PROVIDER=vertex needs VERTEX_PROJECT set to the GCP project id.');
    }
    client = new AnthropicVertex({
      projectId: config.vertexProject,
      region: config.vertexModelRegion,
      ...shared,
    });
  } else {
    client = new Anthropic({ apiKey: config.anthropicApiKey, ...shared });
  }
  return client;
}

/** Test seam: forget the cached client so a changed provider takes effect. */
export function resetClient(): void {
  client = null;
}

/**
 * Per-request options for the analysis calls (R5).
 *
 * The client defaults — 60 seconds, four retries — are tuned for an interview
 * turn, where an informant is watching a cursor blink and a fast failure beats a
 * long wait. They are actively wrong for analysis: a change-set call is handed a
 * whole specification and a whole graph, and reasoning over that takes longer than
 * a minute. Every attempt then hit the timeout and burned the full retry budget,
 * so the request failed after five minutes having never once been given long
 * enough to succeed. It looked like a hang; it was an impatient client.
 *
 * Longer per attempt, fewer attempts, so the worst case is bounded at roughly the
 * same place while a single attempt now has room to finish.
 */
export const ANALYSIS_REQUEST = { timeout: 180_000, maxRetries: 1 } as const;

export async function callModel(params: CallParams): Promise<ModelResponse> {
  if (config.mockModel) {
    return await mockRespond(params);
  }

  const resp = await getClient().messages.create({
    model: config.model,
    max_tokens: config.modelMaxTokens,
    temperature: config.modelTemperature,
    system: params.system,
    ...(params.noTools
      ? {}
      : {
          tools: TOOL_DEFINITIONS as unknown as Anthropic.Tool[],
          ...(params.toolChoice === 'any' ? { tool_choice: { type: 'any' as const } } : {}),
        }),
    messages: params.messages,
  });
  addUsage(resp.usage);

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const toolCalls: ModelToolCall[] = resp.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  const stopReason: ModelResponse['stopReason'] =
    resp.stop_reason === 'tool_use' ? 'tool_use' : resp.stop_reason === 'end_turn' ? 'end_turn' : 'other';

  return { stopReason, text, toolCalls, assistantContent: resp.content };
}
