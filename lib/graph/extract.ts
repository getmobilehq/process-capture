/**
 * Spec → ProcessGraph extraction (delta v1.1 R5.1).
 *
 * The model-facing half of the canonical artefact. The model reads a completed
 * specification and *proposes* a graph via a single tool call; the server parses
 * it against the Zod schema and runs the structural validators. An invalid
 * proposal is handed back with its errors and retried once, then given up on.
 *
 * P1 in full: the model never writes BPMN and never writes a graph the server has
 * not checked. A planted-fault spec fails loudly here rather than producing an
 * authoritative-looking diagram from broken material (R5.7).
 */
import { config } from '@/lib/config';
import { getClient } from '@/lib/engine/model';
import { validateGraph } from './validate';
import type { ProcessGraph } from './schema';

const MAX_ATTEMPTS = 2;

export class GraphExtractionError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'GraphExtractionError';
  }
}

const SYSTEM = `You convert a completed process specification into a typed process graph. You are not writing BPMN and you are not designing a diagram — you are reading evidence and transcribing its structure.

Rules, in order of importance:
1. EVERY node and annotation carries sourceFacet: the facet number the evidence came from. A node you cannot trace to a facet does not belong in the graph. Lanes come from facet 2, events from facets 3 and 10, activities from facet 5, gateways from facet 6, annotations from facets 9, 11 and 12.
2. Transcribe, do not invent. If the specification does not describe a step, it is not in the graph — no matter how obviously it "should" be there. Gaps in the spec are gaps in the graph; someone else's job is to notice them.
3. Structural rules the server enforces, so build to them: exactly one start event; at least one end event; every flow references nodes that exist; every gateway has at least two outgoing flows; no orphan nodes; a boundary event names the activity it is attached to.
4. Ids are stable, readable and prefixed by kind: lane:agent, ev:start, act:run-diagnostics, gw:next-best-action, ann:booking-backlog, and plain f1, f2… for flows.
5. Return an empty annotations array. A separate pass reads the bottlenecks — your job here is the structure of the process, and nothing else.

Return the graph through the emit_process_graph tool. Do not write prose.`;

/**
 * Annotations are a second, dedicated pass.
 *
 * Asking one call for both structure and evidence produced valid graphs with zero
 * annotations against a specification whose facet 12 described four separate
 * bottlenecks — the model spent its attention satisfying the structural rules and
 * treated the annotations as an afterthought. Asked on its own, with the node list
 * already fixed, it finds them reliably. One concern per call.
 */
const ANNOTATION_SYSTEM = `You read a process specification and a list of the activities already extracted from it, and you record the problems the specification states.

You are not diagnosing the process. You are transcribing what the informant said was wrong with it.

Rules:
1. Look hardest at facet 12 (bottlenecks and issues), facet 11 (performance) and facet 9 (risk, controls and compliance). That is where stated problems live. Facet 5 and facet 8 often name the friction — rekeying between systems, manual copying, swivel chairing — without calling it a bottleneck; that still counts.
2. A problem is anything the informant described as slow, manual, repetitive, error-prone, queued, waiting, duplicated, or done by hand where a system could do it. A stated volume that strains the process is a metric worth recording. A control that could fail is a risk.
3. Attach each one to the specific activity it affects, using an id from the list given to you. If a problem spans several activities, attach it to the one where it bites hardest and say so in the text. Never invent an activity id.
4. Quote the specification wherever a phrase carries the point — the quote is what makes this evidence rather than opinion.
5. Do not invent problems, and do not soften them. If the specification says agents copy IMEI numbers by hand across three platforms, that is a bottleneck, not a nuance.
6. If the specification genuinely describes no problems, return an empty array. That is rare and should feel wrong before you do it.

Return through the emit_annotations tool. Do not write prose.`;

const ANNOTATION_TOOL = {
  name: 'emit_annotations',
  description: 'Emit the problems the specification states, each attached to an activity.',
  input_schema: {
    type: 'object' as const,
    properties: {
      annotations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable readable id, e.g. ann:manual-form-entry.' },
            targetId: { type: 'string', description: 'An id from the activity list given to you.' },
            kind: { type: 'string', enum: ['bottleneck', 'risk', 'metric'] },
            text: { type: 'string', description: 'The problem, in one or two plain sentences.' },
            evidence: {
              type: 'object',
              properties: {
                facet: { type: 'integer', description: 'The facet that establishes it.' },
                quote: { type: 'string', description: 'A short quote from the specification.' },
              },
              required: ['facet'],
            },
          },
          required: ['id', 'targetId', 'kind', 'text', 'evidence'],
        },
      },
    },
    required: ['annotations'],
  },
};

const TOOL = {
  name: 'emit_process_graph',
  description:
    'Emit the typed process graph extracted from the specification. The server validates it and will reject anything structurally invalid.',
  input_schema: {
    type: 'object' as const,
    properties: {
      processId: { type: 'string' },
      name: { type: 'string' },
      lanes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, sourceFacet: { type: 'integer' } },
          required: ['id', 'name', 'sourceFacet'],
        },
      },
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['start', 'end', 'boundary'] },
            name: { type: 'string' },
            laneId: { type: 'string' },
            sourceFacet: { type: 'integer' },
            attachedTo: { type: 'string' },
          },
          required: ['id', 'type', 'name', 'laneId', 'sourceFacet'],
        },
      },
      activities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            laneId: { type: 'string' },
            systems: { type: 'array', items: { type: 'string' } },
            sourceFacet: { type: 'integer' },
          },
          required: ['id', 'name', 'laneId', 'sourceFacet'],
        },
      },
      gateways: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['exclusive', 'parallel'] },
            name: { type: 'string' },
            condition: { type: 'string' },
            laneId: { type: 'string' },
            sourceFacet: { type: 'integer' },
          },
          required: ['id', 'type', 'name', 'laneId', 'sourceFacet'],
        },
      },
      flows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            condition: { type: 'string' },
          },
          required: ['id', 'from', 'to'],
        },
      },
      annotations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            targetId: { type: 'string' },
            kind: { type: 'string', enum: ['bottleneck', 'risk', 'metric'] },
            text: { type: 'string' },
            evidence: {
              type: 'object',
              properties: { facet: { type: 'integer' }, quote: { type: 'string' } },
              required: ['facet'],
            },
          },
          required: ['id', 'targetId', 'kind', 'text', 'evidence'],
        },
      },
    },
    // annotations is required: an omitted array was silently accepted as "no
    // problems found", which is how a spec full of stated bottlenecks produced a
    // clean diagram and an empty change-set.
    required: [
      'processId',
      'name',
      'lanes',
      'events',
      'activities',
      'gateways',
      'flows',
      'annotations',
    ],
  },
};

/**
 * Extract a graph from a spec's markdown. `now` is injected rather than read from
 * the clock so the result is reproducible in tests and evals.
 */
/**
 * Second pass: the problems the specification states, attached to the activities
 * already extracted. Failure here is not fatal — a diagram without annotations is
 * still a useful diagram, whereas losing the structure because the evidence pass
 * stumbled would not be.
 */
export async function extractAnnotations(
  markdown: string,
  graph: ProcessGraph,
): Promise<ProcessGraph['annotations']> {
  const nodeList = [...graph.activities, ...graph.gateways]
    .map((n) => `- ${n.id} — ${n.name}`)
    .join('\n');

  try {
    const resp = await getClient().messages.create({
      model: config.model,
      max_tokens: config.modelMaxTokens,
      temperature: config.modelTemperature,
      system: ANNOTATION_SYSTEM,
      tools: [ANNOTATION_TOOL],
      tool_choice: { type: 'tool', name: ANNOTATION_TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Activities and decisions already extracted — attach each problem to one of these ids:
${nodeList}

The specification:
---
${markdown}
---`,
        },
      ],
    });

    const call = resp.content.find(
      (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    const proposed = (call?.input as { annotations?: unknown[] })?.annotations ?? [];
    return proposed as ProcessGraph['annotations'];
  } catch {
    return [];
  }
}

export async function extractProcessGraph(input: {
  markdown: string;
  specRef: string;
  now?: string;
}): Promise<ProcessGraph> {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: `Here is the completed process specification. Extract its process graph.\n\n---\n${input.markdown}\n---`,
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

    // The server supplies the provenance fields — the model does not get to
    // assert what spec a graph came from, or when (P4).
    const candidate = {
      ...(call.input as Record<string, unknown>),
      specRef: input.specRef,
      generatedAt: input.now ?? new Date().toISOString(),
      annotations: (call.input as { annotations?: unknown[] }).annotations ?? [],
    };

    const result = validateGraph(candidate);
    if (result.ok) {
      const graph = candidate as ProcessGraph;
      graph.annotations = await extractAnnotations(input.markdown, graph);
      // Re-validate: an annotation pointing at a node that is not there would
      // dangle on the diagram, so it is caught here rather than at render time.
      const withNotes = validateGraph(graph);
      if (!withNotes.ok) {
        // Drop the offending annotations rather than lose the whole graph — the
        // structure is sound and is the more valuable artefact.
        const ids = new Set([
          ...graph.events.map((n) => n.id),
          ...graph.activities.map((n) => n.id),
          ...graph.gateways.map((n) => n.id),
        ]);
        graph.annotations = graph.annotations.filter((a) => ids.has(a.targetId));
      }
      return graph;
    }

    lastErrors = result.errors;
    if (attempt < MAX_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(call.input) },
        {
          role: 'user',
          content: `That graph failed validation:\n${result.errors
            .map((e) => `- ${e}`)
            .join('\n')}\n\nFix exactly these problems and emit the graph again. Do not invent steps to satisfy a rule — if the specification genuinely lacks an end state or a second branch, say so by leaving the structure as the evidence supports and accept the failure.`,
        },
      );
    }
  }

  throw new GraphExtractionError(
    `Could not extract a valid process graph after ${MAX_ATTEMPTS} attempts.`,
    lastErrors,
  );
}
