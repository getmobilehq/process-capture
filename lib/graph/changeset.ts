/**
 * To-be change-set generation (delta v1.1 R5.4).
 *
 * The to-be diagram is not a second hand-built graph. It is the as-is graph plus a
 * machine-generated set of changes, and every change must reference the bottleneck
 * annotation it resolves. A change that resolves nothing is rejected at validation
 * — a to-be process is a set of answers to evidenced problems, not a wishlist.
 *
 * Everything here is `proposed` and `verified: false`. Approval is a human act
 * (R5.4's locked verification gate); the generator cannot mark its own work
 * verified, and the schema default enforces that even if a prompt tried.
 */
import { config } from '@/lib/config';
import { getClient } from '@/lib/engine/model';
import { validateChangeSet } from './validate';
import type { ChangeSet, ProcessGraph } from './schema';

const MAX_ATTEMPTS = 2;

export class ChangeSetGenerationError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'ChangeSetGenerationError';
  }
}

const SYSTEM = `You propose changes to a process, given its as-is graph and the bottlenecks evidenced in it. You are not redesigning the process and you are not free to improve whatever you like.

The hard constraint: EVERY change must reference, by id, the bottleneck annotation it resolves. If you cannot point at an evidenced bottleneck that a change addresses, that change does not belong in the set — however sensible it seems. The server rejects a change that resolves nothing.

Rules:
1. Work only from the annotations on the graph. Those are the evidenced problems. Do not invent a bottleneck to justify a change you would like to make; if you find yourself wanting to, stop and leave the change out.
2. Say what changes, concretely, in terms of the process as described: which activity is inserted, replaced, removed or reordered, and where in the flow it sits. "Improve scheduling" is not a change; "replace the FIFO appointment queue with priority-based scheduling on severity and SLA risk" is.
3. Every change carries a rationale that cites the facets the evidence came from, and is honest about its limits. If a change relieves a symptom rather than the cause — a backlog that is really a supply-and-demand mismatch, say — the rationale must say so. An overclaimed benefit is worse than a modest one.
4. Prefer few, load-bearing changes over many small ones. Three changes that each resolve a real bottleneck is a better answer than ten that gesture at one.
5. You may target an existing node id, or name a new one you are proposing to add (activity:some-new-step). Use the same id style as the graph.
6. For an add or a reorder, give placement.after or placement.before naming an existing node, plus placement.laneId and a short placement.name. A description alone cannot be applied to a diagram — "between diagnostics and the decision" is a sentence, not a position.

Return the set through the emit_change_set tool. Do not write prose.`;

const TOOL = {
  name: 'emit_change_set',
  description:
    'Emit the proposed change-set. The server validates that every change resolves an annotation that actually exists on the base graph, and rejects the set otherwise.',
  input_schema: {
    type: 'object' as const,
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'modify', 'reorder'] },
            target: {
              type: 'string',
              description:
                'An existing node id, or a new id you are proposing to add, in the graph’s id style.',
            },
            description: {
              type: 'string',
              description: 'What changes, concretely, and where in the flow it sits.',
            },
            resolvesAnnotationId: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Ids of the bottleneck annotations this change resolves. At least one, and each must exist on the base graph.',
            },
            rationale: {
              type: 'string',
              description:
                'Why this follows from the evidence, citing facets — and honest about what it does not fix.',
            },
            placement: {
              type: 'object',
              description:
                'Where the change goes. Required for add and reorder — a description alone cannot be applied mechanically.',
              properties: {
                after: { type: 'string', description: 'Existing node id this sits immediately after.' },
                before: { type: 'string', description: 'Existing node id this sits immediately before.' },
                laneId: { type: 'string', description: 'Lane the node belongs in.' },
                name: { type: 'string', description: 'Short display name for an added node.' },
              },
            },
          },
          required: ['op', 'target', 'description', 'resolvesAnnotationId', 'rationale'],
        },
      },
    },
    required: ['changes'],
  },
};

/** The evidenced problems, rendered for the prompt. Nothing else is offered. */
function annotationBlock(graph: ProcessGraph): string {
  if (graph.annotations.length === 0) return '(none — this graph carries no evidenced bottlenecks)';
  return graph.annotations
    .map((a) => {
      const target =
        graph.activities.find((x) => x.id === a.targetId)?.name ??
        graph.gateways.find((x) => x.id === a.targetId)?.name ??
        graph.events.find((x) => x.id === a.targetId)?.name ??
        a.targetId;
      const quote = a.evidence.quote ? ` Quote: “${a.evidence.quote}”.` : '';
      return `- ${a.id} [${a.kind}] on "${target}" (${a.targetId}) — ${a.text} (facet ${a.evidence.facet}).${quote}`;
    })
    .join('\n');
}

function flowBlock(graph: ProcessGraph): string {
  const name = (id: string) =>
    [...graph.activities, ...graph.gateways, ...graph.events].find((n) => n.id === id)?.name ?? id;
  return graph.flows
    .map((f) => `- ${f.from} (${name(f.from)}) → ${f.to} (${name(f.to)})${f.condition ? ` [${f.condition}]` : ''}`)
    .join('\n');
}

export async function generateChangeSet(graph: ProcessGraph): Promise<ChangeSet> {
  // Nothing evidenced means nothing to propose. Returning an empty set is the
  // honest outcome — better than inviting the model to invent a problem.
  if (graph.annotations.length === 0) {
    return { baseGraph: graph.processId, provenance: 'proposed', verified: false, changes: [] };
  }

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: `Process: ${graph.name}

Evidenced bottlenecks — these, and only these, are what a change may resolve:
${annotationBlock(graph)}

The as-is flow:
${flowBlock(graph)}

Propose the change-set.`,
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

    // Provenance is the server's to assert, not the model's (P4). `verified` is
    // false by construction — only a human reviewer may change it (R5.4 gate).
    const candidate = {
      ...(call.input as Record<string, unknown>),
      baseGraph: graph.processId,
      provenance: 'proposed' as const,
      verified: false,
    };

    const result = validateChangeSet(candidate, graph);
    if (result.ok) return candidate as ChangeSet;

    lastErrors = result.errors;
    if (attempt < MAX_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(call.input) },
        {
          role: 'user',
          content: `That change-set failed validation:
${result.errors.map((e) => `- ${e}`).join('\n')}

Fix exactly these problems. Do not invent a bottleneck to make a change valid, and do not attach a change to an unrelated annotation to get it through — if a change cannot honestly point at an evidenced problem, drop it from the set. Returning fewer changes is a correct answer.`,
        },
      );
    }
  }

  throw new ChangeSetGenerationError(
    `Could not generate a valid change-set after ${MAX_ATTEMPTS} attempts.`,
    lastErrors,
  );
}
