/**
 * Autonomy levels (R5.9).
 *
 * A four-level scale for how far a step could run without a person:
 *
 *   L3  the agent runs it autonomously
 *   L2  the agent executes, a human verifies
 *   L1  the agent assists, a human executes
 *   L0  human only — by nature or by design
 *
 * This is a finer instrument than R5.5's automatable / assistable /
 * human-required, and it is deliberately not derived from it. "Automatable" does
 * not say whether anyone checks the result afterwards, and that is the whole
 * difference between L3 and L2 — the distinction a stakeholder actually needs,
 * because it decides whether a control disappears or merely moves.
 *
 * The rules from R5.5 carry over unchanged, because they are what make the output
 * worth reading: no confident level without cited facet evidence, `unassessed`
 * must explain itself, and the server refuses a level the model cannot support
 * rather than accepting a plausible one.
 *
 * L0 is not a failure state. "By design" is in the label because some work is
 * human by choice — an apology, a judgement about a person, a conversation
 * someone would want to have with a person — and a scale that treats that as a
 * gap to be closed is one nobody in the business will trust.
 */
import { config } from '@/lib/config';
import { getClient, ANALYSIS_REQUEST } from '@/lib/engine/model';
import type { ProcessGraph } from './schema';
import {
  AUTONOMY_LEVELS,
  LEVEL_META,
  type ActivityAutonomy,
  type AutonomyLevel,
  type AutonomySet,
  type AutonomySummary,
  type LaneBreakdown,
} from './autonomy-levels';

// Re-exported so callers have one place to import the scale from.
export {
  AUTONOMY_LEVELS,
  LEVEL_META,
  type ActivityAutonomy,
  type AutonomyLevel,
  type AutonomySet,
  type AutonomySummary,
  type LaneBreakdown,
};

const MAX_ATTEMPTS = 2;

export class AutonomyError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'AutonomyError';
  }
}

export function validateAutonomy(
  candidate: unknown,
  graph: ProcessGraph,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const set = candidate as Partial<AutonomySet>;
  const ids = new Set(graph.activities.map((a) => a.id));

  if (!Array.isArray(set?.levels)) return { ok: false, errors: ['levels must be an array'] };

  const seen = new Set<string>();
  for (const l of set.levels) {
    if (!ids.has(l.activityId)) {
      errors.push(`"${l.activityId}" is not an activity in this process`);
      continue;
    }
    if (seen.has(l.activityId)) errors.push(`"${l.activityId}" appears twice`);
    seen.add(l.activityId);

    if (!AUTONOMY_LEVELS.includes(l.level)) {
      errors.push(`"${l.activityId}" has level "${l.level}" — must be one of ${AUTONOMY_LEVELS.join(', ')}`);
    }
    if (!l.rationale?.trim()) errors.push(`"${l.activityId}" has no rationale`);

    // The rule the whole feature rests on: a confident level cites evidence.
    if (l.level !== 'unassessed' && (l.evidence ?? []).length === 0) {
      errors.push(
        `"${l.activityId}" is placed at ${l.level} with no cited facet. Cite the evidence or use "unassessed" and say what is missing.`,
      );
    }
  }

  for (const a of graph.activities) {
    if (!seen.has(a.id)) errors.push(`"${a.id}" was not assessed — every activity needs a level`);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

const SYSTEM = `You place each step of a business process on a four-level autonomy scale. You are reading evidence about how the work is done today, not imagining a future system.

The levels:

- L3 — the agent runs it autonomously. Deterministic, the data is already held or exposed, no approval authority, and nobody needs to check the output before it takes effect.
- L2 — the agent executes, a human verifies. The work itself can be done by a system, but someone confirms the result before it stands. Use this wherever a mistake would reach a customer, a payment, or a record of consequence.
- L1 — the agent assists, a human executes. Drafting, pre-filling, suggesting, retrieving. The person still does the thing and still decides.
- L0 — human only, by nature or by design. Approval authority, physical presence, a regulatory obligation, or work that should stay human because it involves judgement about a person.
- unassessed — the specification does not say enough. State exactly what is missing.

Rules:
1. EVERY level except unassessed cites the facets that support it, by number. Facet 8 (systems), 6 (rules and approvals), 7 (data), 9 (risk and controls) and 5 (workflow) are where the evidence usually is. A level with no citation is rejected by the server.
2. The difference between L3 and L2 is whether anyone checks the result. Do not place a step at L3 because it is mechanical — place it at L3 only when the evidence says no verification is required.
3. Approval authority is L0 whatever the paperwork looks like. Authority does not delegate to software.
4. L0 is a legitimate destination, not a failure. Some work should stay human, and saying so is useful.
5. Prefer unassessed to a guess. A modeller can act on "the spec does not say whether this system has an API"; they cannot act on a confident level that turns out to be wrong.
6. For every step below L3, say in one short sentence what would have to change to reach the next level. That sentence is the recommendation, so make it specific — an integration, a data source, a policy decision, a control that could move.

Return through the emit_levels tool. Do not write prose outside it.`;

const TOOL = {
  name: 'emit_levels',
  description: 'Place every activity on the autonomy scale, with cited evidence.',
  input_schema: {
    type: 'object' as const,
    properties: {
      levels: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            activityId: { type: 'string', description: 'An activity id from the list given to you.' },
            level: { type: 'string', enum: [...AUTONOMY_LEVELS] },
            evidence: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Facet numbers supporting this level. Required unless unassessed.',
            },
            rationale: { type: 'string' },
            toAdvance: {
              type: 'string',
              description: 'What would have to change to reach the next level. Empty at L3.',
            },
          },
          required: ['activityId', 'level', 'evidence', 'rationale', 'toAdvance'],
        },
      },
    },
    required: ['levels'],
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
      return `- ${a.id} — "${a.name}", performed by ${laneName(a.laneId)} (facet ${a.sourceFacet})${systems}${notes}`;
    })
    .join('\n');
}

export async function assessAutonomy(
  graph: ProcessGraph,
  markdown: string,
): Promise<AutonomySet> {
  if (graph.activities.length === 0) {
    return { graphRef: graph.processId, levels: [], provenance: 'proposed', verified: false };
  }

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: `Steps to place — every one needs a level, using these ids:
${activityBlock(graph)}

The specification they came from:
---
${markdown}
---`,
    },
  ];

  let lastErrors: string[] = ['no levels were returned'];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const resp = await getClient().messages.create({
      model: config.model,
      max_tokens: config.modelMaxTokens,
      temperature: config.modelTemperature,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages,
    }, ANALYSIS_REQUEST);

    const call = resp.content.find(
      (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (!call) {
      lastErrors = ['the model returned no tool call'];
      continue;
    }

    // Provenance is the server's (P4), and unverified by construction — the R5.4
    // gate applies before any of this reaches a handover report.
    const candidate = {
      ...(call.input as Record<string, unknown>),
      graphRef: graph.processId,
      provenance: 'proposed' as const,
      verified: false as const,
    };

    const result = validateAutonomy(candidate, graph);
    if (result.ok) return candidate as unknown as AutonomySet;

    lastErrors = result.errors;
    if (attempt < MAX_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(call.input) },
        {
          role: 'user',
          content: `That failed validation:
${result.errors.map((e) => `- ${e}`).join('\n')}

Fix exactly these. Do not invent a facet citation to make a level stand up — if the specification does not support it, use "unassessed" and say what is missing. And do not raise a level to look decisive: an honest L0 or L1 is a correct answer.`,
        },
      );
    }
  }

  throw new AutonomyError(`Could not place the steps after ${MAX_ATTEMPTS} attempts.`, lastErrors);
}

// ── Reading the result ──────────────────────────────────────────────────────

const emptyCounts = (): Record<AutonomyLevel, number> => ({
  L0: 0,
  L1: 0,
  L2: 0,
  L3: 0,
  unassessed: 0,
});

export function summariseAutonomy(graph: ProcessGraph, set: AutonomySet): AutonomySummary {
  const levelOf = new Map(set.levels.map((l) => [l.activityId, l.level]));
  const counts = emptyCounts();
  const byLane = new Map<string, LaneBreakdown>();

  for (const a of graph.activities) {
    const level = levelOf.get(a.id) ?? 'unassessed';
    counts[level] += 1;

    const laneName = graph.lanes.find((l) => l.id === a.laneId)?.name ?? a.laneId;
    const lane =
      byLane.get(a.laneId) ??
      { laneId: a.laneId, laneName, counts: emptyCounts(), total: 0 };
    lane.counts[level] += 1;
    lane.total += 1;
    byLane.set(a.laneId, lane);
  }

  const total = graph.activities.length;
  return {
    counts,
    total,
    systemCanDo: counts.L2 + counts.L3,
    unassessedShare: total === 0 ? 0 : counts.unassessed / total,
    // Busiest lane first — that is where a reader looks.
    byLane: [...byLane.values()].sort((a, b) => b.total - a.total || a.laneName.localeCompare(b.laneName)),
  };
}
