/**
 * Deterministic scripted model, used when MOCK_MODEL=1. It reads live coverage
 * from the database and drives the golden path: resolve the lowest unresolved
 * facet each user turn (facet 9 → unknown_to_informant + unknown_retarget, the
 * rest → every checklist element captured, which derives to answered), then end
 * the interview. This lets the Phase 3–5 gates run
 * offline and reproducibly (11 answered + 1 unknown at review).
 */
import { getCoverage, getInterviewee, getSession } from '@/lib/db/queries';
import { FACETS, elementsFor, getFacet } from '@/lib/facets/facets';
import type { CallParams, ModelResponse, ModelToolCall } from './model';

let mockToolSeq = 0;
function toolId(): string {
  mockToolSeq += 1;
  return `mock_tool_${mockToolSeq}`;
}

function textResponse(text: string): ModelResponse {
  return { stopReason: 'end_turn', text, toolCalls: [], assistantContent: [{ type: 'text', text }] };
}

function toolResponse(calls: { name: string; input: unknown }[]): ModelResponse {
  const toolCalls: ModelToolCall[] = calls.map((c) => ({ id: toolId(), name: c.name, input: c.input }));
  return {
    stopReason: 'tool_use',
    text: '',
    toolCalls,
    assistantContent: toolCalls.map((c) => ({
      type: 'tool_use',
      id: c.id,
      name: c.name,
      input: c.input as Record<string, unknown>,
    })),
  };
}

const RESOLUTION_TOOLS = new Set(['record_statement', 'set_coverage', 'set_element', 'raise_finding']);

function questionFor(facetId: number): string {
  const facet = getFacet(facetId);
  return facet.probes[0];
}

/** A £ approval band that varies by role, so two informants differ on facet 6. */
function approvalBand(role: string): string {
  const r = role.toLowerCase();
  if (r.includes('leader') || r.includes('manager')) return '£100';
  if (r.includes('analyst')) return '£50';
  return '£25';
}

function resolveFacet(facetId: number, role: string): { name: string; input: unknown }[] {
  // Facet 9 (risk, controls & compliance) is the persona's genuine unknown.
  if (facetId === 9) {
    return [
      {
        name: 'set_coverage',
        input: { facetId: 9, state: 'unknown_to_informant', rationale: 'Informant does not own controls.' },
      },
      {
        name: 'raise_finding',
        input: {
          facetId: 9,
          type: 'unknown_retarget',
          title: 'Risk, controls & compliance owner',
          detail: 'Informant does not know the controls for this process — retarget to QA / compliance.',
        },
      },
    ];
  }

  // Facet 6 (business rules) records a rule with a role-specific threshold, and
  // facet 11 (performance) a metric — so the console can surface cross-informant
  // candidate conflicts (FR-1.6).
  let kind = 'fact';
  let content = `Captured from the informant for ${getFacet(facetId).name.toLowerCase()}.`;
  if (facetId === 6) {
    kind = 'rule';
    content = `A ${role} can authorise credits up to ${approvalBand(role)} without escalation.`;
  } else if (facetId === 11) {
    kind = 'metric';
    content = 'Volume is roughly forty cases a day, with a five-working-day SLA.';
  }

  // Delta v1.1 R1: a facet is closed by closing its checklist, not by declaring it
  // answered. The mock must do the same work the real model does, so the golden
  // path exercises the derivation rather than side-stepping it.
  return [
    { name: 'record_statement', input: { facetId, kind, content } },
    ...elementsFor(facetId).map((e) => ({
      name: 'set_element',
      input: {
        facetId,
        elementId: e.id,
        state: 'captured',
        summary: `${e.label} — captured from the informant.`,
      },
    })),
  ];
}

const PLAYBACK =
  'Thank you — that is really helpful. Here is a quick playback of what I captured, facet by facet. ' +
  'I recorded the main path, the approval thresholds, and the bottleneck you mentioned; I have noted the ' +
  'controls as something for the compliance team, since that is not your area. Does that all sound right, ' +
  'or is there anything you would change before I close?';

export function mockRespond(params: CallParams): ModelResponse {
  const { sessionId, lastAppliedTool, noTools, db } = params;
  const session = getSession(sessionId, db)!;
  const coverage = getCoverage(sessionId, db);
  const lowest = coverage.find((c) => c.state === 'pending' || c.state === 'partial')?.facetId ?? null;

  // ── Question phase (no tools): produce the agent's next message. ───────────
  if (noTools) {
    if (session.status === 'review') return textResponse(PLAYBACK); // per-facet playback (FR-4.1)
    if (lowest === null) return textResponse(PLAYBACK);
    return textResponse(questionFor(lowest));
  }

  // ── Extraction phase (tools): record + advance coverage, then stop. ────────
  // A correction sent during review — acknowledge, record nothing.
  if (session.status === 'review') {
    return textResponse(REVIEW_ACK);
  }
  // Already resolved a facet this turn → stop extracting (end_turn, no text).
  if (lastAppliedTool && RESOLUTION_TOOLS.has(lastAppliedTool)) {
    if (lowest === null) return toolResponse([{ name: 'end_interview', input: {} }]);
    return textResponse('');
  }
  // Fresh answer: resolve the lowest facet, or end if everything is terminal.
  if (lowest === null) return toolResponse([{ name: 'end_interview', input: {} }]);
  const role = getInterviewee(session.intervieweeId, db)?.role ?? 'process user';
  return toolResponse(resolveFacet(lowest, role));
}

const REVIEW_ACK =
  'Thank you — I have noted that. Is there anything else you would like to change before I close?';

/** Opening message for the mock: warm welcome + one question on the first facet. */
export const OPENING_MOCK = `Thanks for making the time — this should take about half an hour, and there are no wrong answers. ${questionFor(
  FACETS[0].id,
)}`;
