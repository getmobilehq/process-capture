/**
 * Simulated informant (BUILD-REQUIREMENTS §9). A second model call plays the
 * persona from its fixture, answering the interview agent's questions from the
 * fixture facts only, in the persona's style, and honestly declining the
 * known-unknown facet. Runs against the real engine exactly as production would.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';
import { addUsage } from '@/lib/usage';
import type { Persona } from './types';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

const STYLE_RULES: Record<Persona['style'], string> = {
  cooperative: 'Answer helpfully and clearly, in one to three sentences. Give the relevant detail.',
  terse:
    'Answer in as few words as possible — often a short phrase or a single clause. Do not volunteer anything beyond exactly what was asked; make the interviewer probe for more.',
  rambling:
    'Answer at length and wander into related tangents and other bits of your job, but always include the relevant fact somewhere in the answer.',
};

function factsBlock(persona: Persona): string {
  return Object.entries(persona.facts)
    .filter(([, list]) => list.length > 0)
    .map(([, list]) => list.map((f) => `- ${f}`).join('\n'))
    .join('\n');
}

export async function informantReply(persona: Persona, agentQuestion: string): Promise<string> {
  const system = `You are a ${persona.role} at Virgin Media O2, being interviewed about the process you run: "${persona.processName}". You are the informant, not the interviewer.

How to answer:
- ${STYLE_RULES[persona.style]}
- Use ONLY the facts below. Never invent anything not listed. Describe colleagues by role, not name.
- If the interviewer asks about risk, controls, compliance, audits, regulatory checks, or who assures the process (these are not your area), say honestly and plainly that you genuinely do not know — do not guess or make something up.
- Answer as a real person would in conversation. Do not mention "facts" or that you are following a script.

The facts you know:
${factsBlock(persona)}`;

  const resp = await getClient().messages.create({
    model: config.model,
    max_tokens: 512,
    temperature: config.modelTemperature,
    system,
    messages: [
      { role: 'user', content: `The interviewer asks: "${agentQuestion}"\n\nGive your answer.` },
    ],
  });
  addUsage(resp.usage);

  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}
