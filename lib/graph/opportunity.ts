/**
 * Technical-opportunity classification (delta v1.1 R5.5).
 *
 * One label per as-is activity: automatable, assistable, human-required — or
 * `unclassified` when the evidence will not carry a judgement.
 *
 * The hard rule is the same one that governs the rest of R5: **no classification
 * without cited evidence**. Calling a step automatable is a claim about VMO2's
 * systems and about someone's job, and it has to point at the facet that supports
 * it. Where it cannot, `unclassified` is the honest answer and must say why —
 * that is a better outcome than a confident label a modeller cannot check.
 */
import { config } from '@/lib/config';
import { getClient } from '@/lib/engine/model';
import { validateOpportunities } from './validate';
import type { OpportunitySet, ProcessGraph } from './schema';

const MAX_ATTEMPTS = 2;

export class OpportunityGenerationError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'OpportunityGenerationError';
  }
}

const SYSTEM = `You classify the activities of a process by how far they could be automated. You are reading evidence, not imagining a future system.

Give exactly one label to each activity:

- automatable — the inputs and outputs are deterministic, a system already holds the data or exposes it, and no judgement or approval authority is required. Copying values between two systems by hand is the clearest case.
- assistable — a system could do most of it but a person keeps the decision. Suggesting a next best action, drafting something for approval, pre-filling a form someone checks.
- human-required — approval authority, physical presence, or a regulatory obligation. A manager signing off a credit above their limit, an engineer at a customer's home, a check a regulator requires a person to make.
- unclassified — the specification does not tell you enough. Say what is missing.

Rules:
1. EVERY label cites the facets that support it, by number. Facet 8 (systems), 6 (rules and approvals), 7 (data and records) and 5 (workflow) are where the evidence usually is. A label with no citation is rejected by the server.
2. Do not classify from the activity's name. "Review case" could be any of the three; what decides it is whether the specification says a judgement or an approval is involved.
3. An approval threshold makes something human-required at or above that threshold, however routine the work is otherwise. Authority is not automatable.
4. Prefer unclassified to a guess. A modeller can act on "we do not know whether this system has an API"; they cannot act on a confident label that turns out to be wrong.
5. The rationale is one or two plain sentences a process architect can check against the specification.

Return through the emit_opportunities tool. Do not write prose.`;

const TOOL = {
  name: 'emit_opportunities',
  description:
    'Emit one classification per activity. The server rejects any confident label with no cited evidence.',
  input_schema: {
    type: 'object' as const,
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            activityId: { type: 'string', description: 'An activity id from the list given to you.' },
            label: {
              type: 'string',
              enum: ['automatable', 'assistable', 'human-required', 'unclassified'],
            },
            evidence: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Facet numbers supporting this label. Required unless unclassified.',
            },
            rationale: {
              type: 'string',
              description: 'One or two sentences a process architect can check against the spec.',
            },
          },
          required: ['activityId', 'label', 'evidence', 'rationale'],
        },
      },
    },
    required: ['classifications'],
  },
};

function activityBlock(graph: ProcessGraph): string {
  const laneName = (id: string) => graph.lanes.find((l) => l.id === id)?.name ?? id;
  return graph.activities
    .map((a) => {
      const systems = a.systems.length ? ` [systems: ${a.systems.join(', ')}]` : '';
      const notes = graph.annotations
        .filter((n) => n.targetId === a.id)
        .map((n) => ` (${n.kind}: ${n.text})`)
        .join('');
      return `- ${a.id} — "${a.name}", performed by ${laneName(a.laneId)} (from facet ${a.sourceFacet})${systems}${notes}`;
    })
    .join('\n');
}

export async function classifyOpportunities(
  graph: ProcessGraph,
  markdown: string,
): Promise<OpportunitySet> {
  if (graph.activities.length === 0) {
    return { graphRef: graph.processId, provenance: 'proposed', verified: false, classifications: [] };
  }

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: `Activities to classify — one label each, using these ids:
${activityBlock(graph)}

The specification they came from:
---
${markdown}
---`,
    },
  ];

  let lastErrors: string[] = ['no proposal was returned'];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const resp = await getClient().messages.create({
      model: config.model,
      max_tokens: config.modelMaxTokens,
      temperature: config.modelTemperature,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages,
    });

    const call = resp.content.find(
      (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (!call) {
      lastErrors = ['the model returned no tool call'];
      continue;
    }

    // Provenance is the server's to assert (P4), and `verified` is false by
    // construction — the same human gate as R5.4 applies before this is shared.
    const candidate = {
      ...(call.input as Record<string, unknown>),
      graphRef: graph.processId,
      provenance: 'proposed' as const,
      verified: false,
    };

    const result = validateOpportunities(candidate, graph);
    if (result.ok) return candidate as OpportunitySet;

    lastErrors = result.errors;
    if (attempt < MAX_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(call.input) },
        {
          role: 'user',
          content: `That failed validation:
${result.errors.map((e) => `- ${e}`).join('\n')}

Fix exactly these. Do not invent a facet citation to make a label pass — if the specification does not support the label, change the label to unclassified and say what is missing. An honest unclassified is a correct answer.`,
        },
      );
    }
  }

  throw new OpportunityGenerationError(
    `Could not classify the activities after ${MAX_ATTEMPTS} attempts.`,
    lastErrors,
  );
}

// ── Reading the result ──────────────────────────────────────────────────────

export const OPPORTUNITY_LABELS = [
  'automatable',
  'assistable',
  'human-required',
  'unclassified',
] as const;

export interface OpportunitySummary {
  automatable: number;
  assistable: number;
  humanRequired: number;
  unclassified: number;
  total: number;
  /** Share of activities the classifier would not judge — a quality signal. */
  unclassifiedShare: number;
}

export function summariseOpportunities(set: OpportunitySet): OpportunitySummary {
  const c = set.classifications;
  const n = (l: string) => c.filter((x) => x.label === l).length;
  const total = c.length;
  return {
    automatable: n('automatable'),
    assistable: n('assistable'),
    humanRequired: n('human-required'),
    unclassified: n('unclassified'),
    total,
    unclassifiedShare: total === 0 ? 0 : n('unclassified') / total,
  };
}
