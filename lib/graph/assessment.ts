/**
 * Automation assessment (R5.8).
 *
 * Answers one question for a stakeholder: would this process — or some part of it
 * — benefit from AI automation? It is an indication with its evidence, not a
 * design. Nothing here specifies an agent, a tool, a cost or a timeline, because
 * we have no data for any of those and a number invented here would be quoted back
 * as though it had been measured.
 *
 * The division of labour matters. Segments and signals are computed in code
 * (`segments.ts`); the model writes the verdict and the prose. Then the server
 * checks the verdict against the numbers and **refuses one the evidence will not
 * carry** — a model that has read a process is prone to finding an opportunity in
 * it, and a tool that always finds one is a tool nobody should believe.
 */
import { config } from '@/lib/config';
import { getClient, ANALYSIS_REQUEST } from '@/lib/engine/model';
import { deriveSegments, segmentSignals, type Segment, type SegmentSignals } from './segments';
import type { OpportunitySet, ProcessGraph } from './schema';

const MAX_ATTEMPTS = 2;

export const VERDICTS = [
  'strong-candidate',
  'partial-candidate',
  'poor-candidate',
  'insufficient-evidence',
] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Above this share of unjudged activities, no positive verdict is defensible. */
const INSUFFICIENT_AT = 0.4;
/** A strong candidate needs both a big opportunity and a contiguous one. */
const STRONG_RUN = 0.4;
const STRONG_SHARE = 0.5;
/** Below this, the opportunity is at the edges whatever the prose says. */
const POOR_BELOW = 0.2;

export interface SegmentAssessment {
  segmentId: string;
  /** Two sentences a stakeholder can check against the specification. */
  why: string;
  /** What must be true before this could be pursued. */
  precondition: string;
  /** What stays with a person, and why. */
  staysHuman: string;
}

export interface Assessment {
  verdict: Verdict;
  /** One sentence. What a stakeholder reads first and may only read. */
  headline: string;
  reasoning: string;
  segments: SegmentAssessment[];
  /** Named questions that would raise confidence. Required when evidence is thin. */
  openQuestions: string[];
  provenance: 'proposed';
  verified: false;
}

export interface AssessmentResult extends Assessment {
  derived: Segment[];
  signals: SegmentSignals;
}

export class AssessmentError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'AssessmentError';
  }
}

/**
 * The verdicts the numbers permit. The model picks from this, and the server
 * checks it picked from it — the same shape as every other R5 gate.
 */
export function permittedVerdicts(s: SegmentSignals): Verdict[] {
  if (s.totalActivities === 0 || s.classified === 0) return ['insufficient-evidence'];
  if (s.unclassifiedShare >= INSUFFICIENT_AT) return ['insufficient-evidence'];

  // The gate exists to stop over-claiming, never under-claiming. The two weakest
  // answers are always available: a reader is never harmed by being told the
  // opportunity is smaller than the arithmetic would allow, and a model that has
  // read the process and concluded "not much here" should not have to argue for it.
  const allowed: Verdict[] = ['insufficient-evidence', 'poor-candidate'];
  if (s.automationShare >= POOR_BELOW) allowed.push('partial-candidate');
  if (s.automationShare >= STRONG_SHARE && s.largestRunCoverage >= STRONG_RUN) {
    allowed.push('strong-candidate');
  }
  return allowed;
}

export function validateAssessment(
  candidate: unknown,
  segments: Segment[],
  signals: SegmentSignals,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const a = candidate as Partial<Assessment>;
  const ids = new Set(segments.map((s) => s.id));

  if (!a || typeof a !== 'object') return { ok: false, errors: ['not an object'] };
  if (!VERDICTS.includes(a.verdict as Verdict)) errors.push(`verdict must be one of ${VERDICTS.join(', ')}`);
  if (!a.headline?.trim()) errors.push('headline is required');
  if (!a.reasoning?.trim()) errors.push('reasoning is required');

  const allowed = permittedVerdicts(signals);
  if (a.verdict && VERDICTS.includes(a.verdict) && !allowed.includes(a.verdict)) {
    errors.push(
      `the evidence does not support "${a.verdict}". With ${Math.round(
        signals.automationShare * 100,
      )}% of steps automatable or assistable, a largest run covering ${Math.round(
        signals.largestRunCoverage * 100,
      )}%, and ${Math.round(signals.unclassifiedShare * 100)}% unjudged, the permitted verdicts are: ${allowed.join(', ')}`,
    );
  }

  for (const s of a.segments ?? []) {
    if (!ids.has(s.segmentId)) {
      errors.push(`segment "${s.segmentId}" does not exist — describe only the segments given`);
    }
    if (!s.why?.trim()) errors.push(`segment "${s.segmentId}" has no reasoning`);
  }

  // Thin evidence has to come with the questions that would thicken it, or the
  // reader is told "we do not know" and given nothing to do about it.
  if (a.verdict === 'insufficient-evidence' && (a.openQuestions ?? []).length === 0) {
    errors.push('insufficient-evidence must list the questions that would close the gap');
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

const SYSTEM = `You assess whether a captured business process would benefit from AI automation. Your reader is a senior stakeholder deciding where to look next — not an engineer, and not someone commissioning a build.

You are given the process, the segments already derived from it, and the numbers. The segments are fixed: describe them, do not invent, merge or split them.

Choose one verdict:

- strong-candidate — a large, contiguous share of the work is deterministic system work on data the organisation already holds.
- partial-candidate — specific segments are worth pursuing; the process as a whole is not.
- poor-candidate — judgement, approval authority or physical presence dominate. Automation would touch the edges.
- insufficient-evidence — the capture does not support a judgement. Say what is missing and who would know.

Rules:
1. You will be told which verdicts the numbers permit. Choosing outside that list is rejected by the server.
2. Cite facets. Every claim traces to what someone said.
3. Never state a cost, a saving, a headcount, a timeline, a vendor or a tool. There is no data for any of them.
4. Never imply the work is approved or recommended. This is an indication for a decision, not the decision.
5. "insufficient-evidence" is a legitimate and useful answer. Prefer it to a confident verdict the evidence will not carry.
6. The headline is one sentence in plain British English. A stakeholder may read only that.

Return through the emit_assessment tool. Do not write prose outside it.`;

const TOOL = {
  name: 'emit_assessment',
  description: 'Emit the process verdict and a description of each derived segment.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      headline: { type: 'string', description: 'One sentence. The thing read first.' },
      reasoning: { type: 'string', description: 'Two to four sentences, citing facets.' },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            segmentId: { type: 'string', description: 'An id from the list given to you.' },
            why: { type: 'string' },
            precondition: { type: 'string', description: 'What must be true first.' },
            staysHuman: { type: 'string', description: 'What a person keeps, and why.' },
          },
          required: ['segmentId', 'why', 'precondition', 'staysHuman'],
        },
      },
      openQuestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Questions that would raise confidence. Required if evidence is thin.',
      },
    },
    required: ['verdict', 'headline', 'reasoning', 'segments', 'openQuestions'],
  },
};

function brief(graph: ProcessGraph, segments: Segment[], signals: SegmentSignals): string {
  const laneName = (id: string) => graph.lanes.find((l) => l.id === id)?.name ?? id;
  const lines = segments.map((s) => {
    const lanes = s.laneIds.map(laneName).join(' → ');
    const systems = s.systems.length ? ` · systems: ${s.systems.join(', ')}` : '';
    const gates = s.gatewayIds.length ? ` · contains ${s.gatewayIds.length} decision point(s)` : '';
    return [
      `${s.id} — ${s.label}, ${s.activityIds.length} step(s), ${Math.round(s.coverage * 100)}% of the process`,
      `   steps: ${s.activityNames.join(' → ')}`,
      `   performed by: ${lanes}${s.crossesLanes ? ' (crosses a hand-off)' : ''}${systems}${gates}`,
      `   evidence: facet ${s.evidence.join(', ') || 'none cited'}`,
    ].join('\n');
  });

  return `Process: ${graph.name}

Numbers:
- ${signals.totalActivities} activities, ${signals.classified} classified
- automatable or assistable: ${Math.round(signals.automationShare * 100)}%
- largest contiguous run: ${Math.round(signals.largestRunCoverage * 100)}% of the process
- unjudged: ${Math.round(signals.unclassifiedShare * 100)}%

Segments (fixed — describe these, invent none):
${lines.join('\n')}`;
}

export async function assessAutomation(
  graph: ProcessGraph,
  opportunities: OpportunitySet,
): Promise<AssessmentResult> {
  const derived = deriveSegments(graph, opportunities);
  const signals = segmentSignals(graph, derived);
  const allowed = permittedVerdicts(signals);

  // Nothing classified means nothing to assess, and no model call to make.
  if (signals.classified === 0) {
    return {
      verdict: 'insufficient-evidence',
      headline: 'This process has not been classified, so no automation judgement can be made.',
      reasoning:
        'No activity carries an automation label, so there is nothing to assess. Run the opportunity overlay first.',
      segments: [],
      openQuestions: ['Has the opportunity overlay been run for this specification?'],
      provenance: 'proposed',
      verified: false,
      derived,
      signals,
    };
  }

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: `${brief(graph, derived, signals)}

Verdicts the numbers permit: ${allowed.join(', ')}. Choosing anything else is rejected.`,
    },
  ];

  let lastErrors: string[] = ['no assessment was returned'];

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

    // Provenance is the server's to assert (P4), and this is unverified by
    // construction — the R5.4 gate applies before it reaches a report.
    const candidate = {
      ...(call.input as Record<string, unknown>),
      provenance: 'proposed' as const,
      verified: false as const,
    };

    const result = validateAssessment(candidate, derived, signals);
    if (result.ok) return { ...(candidate as unknown as Assessment), derived, signals };

    lastErrors = result.errors;
    if (attempt < MAX_ATTEMPTS) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(call.input) },
        {
          role: 'user',
          content: `That failed validation:
${result.errors.map((e) => `- ${e}`).join('\n')}

Fix exactly these. Do not argue the numbers up: if the evidence only supports a weaker verdict, give the weaker verdict. An honest "insufficient-evidence" is a correct answer and is more useful than a confident one that does not hold.`,
        },
      );
    }
  }

  throw new AssessmentError(`Could not assess the process after ${MAX_ATTEMPTS} attempts.`, lastErrors);
}
