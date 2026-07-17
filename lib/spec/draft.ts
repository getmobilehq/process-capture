/**
 * Per-facet prose drafting (BUILD-REQUIREMENTS FR-5.1). One model call per facet,
 * drafting from *that facet's statements only* — the model never writes frontmatter
 * or invents content. Facet 5 renders as an ordered list. Under MOCK_MODEL the
 * drafting is deterministic so the Phase 4 gate runs offline.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';
import type { Facet } from '@/lib/facets/facets';

export interface DraftStatement {
  content: string;
  kind: string;
  verbatim: boolean;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

function mockDraft(facet: Facet, statements: DraftStatement[]): string {
  if (statements.length === 0) {
    return '_No detail was captured for this facet._';
  }
  if (facet.id === 5) {
    // Ordered list of steps (FR-5.1). Actor/system carried where the statement holds it.
    return statements.map((s, i) => `${i + 1}. ${s.content}`).join('\n');
  }
  return statements.map((s) => s.content).join(' ');
}

const DRAFT_SYSTEM = `You are drafting one section of a process specification for the Virgin Media O2 process architecture team, from stated facts only.
Rules:
- Use plain, non-conversational British English. Sentence case, spaced en-dashes, £.
- Be faithful to the statements only. Add nothing, infer nothing, optimise nothing.
- Do not include any names of people, and never include email addresses.
- Do not write a heading — only the section body.
- For the workflow facet, render the steps as an ordered Markdown list (1., 2., 3.), naming the actor and the system for each step where the statements say so.
Return only the section body.`;

export async function draftFacet(input: {
  facet: Facet;
  statements: DraftStatement[];
  processName: string | null;
}): Promise<string> {
  const { facet, statements } = input;

  if (config.mockModel) {
    return mockDraft(facet, statements);
  }
  if (statements.length === 0) {
    return '_No detail was captured for this facet._';
  }

  const bulletined = statements
    .map((s) => `- (${s.kind}${s.verbatim ? ', verbatim' : ''}) ${s.content}`)
    .join('\n');

  const resp = await getClient().messages.create({
    model: config.model,
    max_tokens: 1024,
    temperature: config.modelTemperature,
    system: DRAFT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Facet: ${facet.name}\nObjective: ${facet.objective}\nProcess: ${
          input.processName ?? 'unnamed'
        }\n\nStated facts for this facet:\n${bulletined}\n\nDraft the section body now.`,
      },
    ],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return text || mockDraft(facet, statements);
}
