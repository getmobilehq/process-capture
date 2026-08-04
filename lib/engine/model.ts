/**
 * Model call boundary. The engine talks to the model only through `callModel`.
 * When MOCK_MODEL=1 it routes to a deterministic scripted responder (lib/engine/
 * mock.ts) so every gate below the live-model phase runs offline and reproducibly.
 */
import Anthropic from '@anthropic-ai/sdk';
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

let client: Anthropic | null = null;
/** Shared client, so extraction passes inherit the same retry posture (R5.1). */
export function getClient(): Anthropic {
  // Extra retries + a generous timeout ride out transient connection blips
  // (EHOSTUNREACH / fetch failed), which otherwise abort a turn or an eval run.
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 4, timeout: 60_000 });
  }
  return client;
}

export async function callModel(params: CallParams): Promise<ModelResponse> {
  if (config.mockModel) {
    return mockRespond(params);
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
