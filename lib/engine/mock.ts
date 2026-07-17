/**
 * Deterministic scripted model, used when MOCK_MODEL=1. It reads live coverage
 * from the database and drives the golden path: resolve the lowest unresolved
 * facet each user turn (facet 9 → unknown_to_informant + unknown_retarget, the
 * rest → answered), then end the interview. This lets the Phase 3–5 gates run
 * offline and reproducibly (11 answered + 1 unknown at review).
 */
import { getCoverage, getSession } from '@/lib/db/queries';
import { FACETS, getFacet } from '@/lib/facets/facets';
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

const RESOLUTION_TOOLS = new Set(['record_statement', 'set_coverage', 'raise_finding']);

function questionFor(facetId: number): string {
  const facet = getFacet(facetId);
  return facet.probes[0];
}

function resolveFacet(facetId: number): { name: string; input: unknown }[] {
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
  const facet = getFacet(facetId);
  return [
    {
      name: 'record_statement',
      input: {
        facetId,
        kind: 'fact',
        content: `Captured from the informant for ${facet.name.toLowerCase()}.`,
      },
    },
    { name: 'set_coverage', input: { facetId, state: 'answered', rationale: 'Rubric met.' } },
  ];
}

const PLAYBACK =
  'Thank you — that is really helpful. Here is a quick playback of what I captured, facet by facet. ' +
  'I recorded the main path, the approval thresholds, and the bottleneck you mentioned; I have noted the ' +
  'controls as something for the compliance team, since that is not your area. Does that all sound right, ' +
  'or is there anything you would change before I close?';

export function mockRespond(params: CallParams): ModelResponse {
  const { sessionId, lastAppliedTool, db } = params;
  const session = getSession(sessionId, db)!;
  const coverage = getCoverage(sessionId, db);
  const lowest = coverage.find((c) => c.state === 'pending' || c.state === 'partial')?.facetId ?? null;

  // After end_interview has been accepted, deliver the playback (FR-4.1).
  if (lastAppliedTool === 'end_interview' || session.status === 'review') {
    return textResponse(PLAYBACK);
  }

  // Just applied a resolution tool: either ask the next facet's question, or (if
  // everything is terminal) call end_interview.
  if (lastAppliedTool && RESOLUTION_TOOLS.has(lastAppliedTool)) {
    if (lowest === null) return toolResponse([{ name: 'end_interview', input: {} }]);
    return textResponse(questionFor(lowest));
  }

  // Fresh informant answer (or the very first user turn): resolve the lowest facet,
  // or end the interview if all are terminal.
  if (lowest === null) return toolResponse([{ name: 'end_interview', input: {} }]);
  return toolResponse(resolveFacet(lowest));
}

/** Opening message for the mock: warm welcome + one question on the first facet. */
export const OPENING_MOCK = `Thanks for making the time — this should take about half an hour, and there are no wrong answers. ${questionFor(
  FACETS[0].id,
)}`;
