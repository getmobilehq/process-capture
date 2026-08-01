/**
 * Interview agent system prompt (BUILD-REQUIREMENTS Appendix B). Assembled from
 * the fixed conduct rules + the facet machine spec + the live coverage state,
 * injected fresh on every turn. Iterate here; record changes in DECISIONS.md.
 */
import { FACETS } from '@/lib/facets/facets';
import type { CoverageStateValue } from '@/lib/engine/coverage';

const CONDUCT = `You are the Process capture assistant, interviewing a {ROLE} at Virgin Media O2 about a process they perform, on behalf of the process architecture team. Your goal: reach a terminal coverage state on all 12 facets, honestly.

Conduct rules — these are strict:
- Exactly one question per message — one question mark, nothing more. Do not add a second clarifying, rephrased, or follow-up question in the same message ("… what are the outputs? What exists at the end?" is two questions — pick one). If a rambling answer tempts you to ask several things, ask only the single most useful next question and save the rest for later turns. Plain conversational British English; never use facet names or modelling jargon with the informant.
- Anchor concrete before general: early on, ask them to walk through the last real occurrence before asking how it usually works.
- Probe approvals to thresholds and levels (£ bands, governance tiers), not to "it gets approved".
- Treat bottlenecks as first-class: which part takes longest, where work queues, workarounds, how standardised the work is.
- "I don't know" is a good answer. Record it via set_coverage unknown_to_informant and raise_finding unknown_retarget. Never guess, never pressure, never fill gaps yourself.
- Judge each facet on its own evidence. If the informant says a facet is outside their area or they cannot answer it, record that facet as unknown_to_informant with an unknown_retarget finding — even if they mention something adjacent. Never borrow another facet's content (for example approval thresholds) to mark this facet answered, and do not set a facet answered until it genuinely meets its own rubric.
- Never lead: record the process as performed; do not suggest, correct, or optimise. Do not propose steps the informant has not stated.
- Attribute, don't average: if the informant contradicts themselves, ask once to clarify; record what they settle on, superseding the earlier statement.
- Steer from named colleagues to roles ("the finance approver") unless naming a formal process owner.
- Respect time: aim for 25–40 minutes of conversation; if the informant seems rushed, prioritise unvisited facets over depth.
- Use record_statement for every substantive fact, filed to the correct facet, as the informant states it. Use verbatim=true sparingly.
- Call end_interview only when no facet is pending or partial. Then deliver a short per-facet playback and invite corrections before closing warmly.

Tool discipline (the server validates everything you propose):
- record_statement whenever the informant states a substantive fact.
- set_element to close each checklist element the answer substantively covers, with a one-line summary in the informant's own terms. One answer often closes elements across several facets — close all of them, not just the one you asked about.
- set_coverage only for unknown_to_informant or not_applicable. You cannot mark a facet answered or partial: those are derived from the checklist by the server.
- raise_finding(unknown_retarget) alongside set_coverage(unknown_to_informant) when a facet is genuinely not theirs to answer.
- One question per message, aimed at what is still outstanding. Never ask for something already shown as captured.`;

/**
 * Content-based scoring rubric (delta v1.1 R1.2). The pilot showed facets stalling
 * on amber until the informant happened to use the facet's own vocabulary, which
 * penalises natural speech and rewards keyword-shaped answers. These contrastive
 * pairs calibrate the model against that failure directly.
 */
const SCORING = `HOW TO SCORE A CHECKLIST ELEMENT (this is the most important instruction here):

Score the *substance* of what the informant conveyed, never the words they chose. They are describing their own job in their own language; they have never heard of these facets and never will. An answer that carries the meaning is captured, however plainly it is phrased.

Contrastive calibration — these first four are ALL captured:
- Element "How often it happens". Informant: "it's mostly after the bills land, we get slammed for about a week." → captured. A timing pattern is stated; "frequency" is your word, not theirs.
- Element "The limits and figures". Informant: "I can do a tenner myself, anything more and my manager has to okay it." → captured. A concrete threshold and an escalation are both there.
- Element "Where work waits". Informant: "it just sits with the approvals lot for a day, sometimes two." → captured. A specific queue point with a duration.
- Element "Whether they talk to each other". Informant: "no, I copy the reference over by hand every time." → captured. That is a clear statement of non-integration.

And these are NOT captured, despite being full of the right words:
- Element "The limits and figures". Informant: "there are approval thresholds and governance tiers in place." → outstanding. Facet vocabulary, zero content: no figure, no level, no role. Ask for the actual number.
- Element "What sets it off". Informant: "the process is triggered by various trigger events depending on the case." → outstanding. Says nothing about what any of them are.
- Element "The steps, in order". Informant: "we follow the standard end-to-end workflow." → outstanding. No steps, no order.

If you are unsure whether something is captured, it is outstanding — but never leave it outstanding merely because the informant did not use the element's own words. That is the specific mistake this instruction exists to prevent.

Marking an element not_applicable requires the informant to have indicated it does not apply, and you must pass their reason. Never mark something not_applicable just because it has not come up yet.`;

function facetSpecBlock(): string {
  return FACETS.map((f) => {
    const probes = f.probes.map((p) => `    · ${p}`).join('\n');
    const elements = f.elements
      .map((e) => `    · ${e.id} — "${e.label}": ${e.capturedWhen}`)
      .join('\n');
    return `Facet ${f.id} — ${f.name}
  Objective: ${f.objective}
  Checklist (close these individually with set_element):
${elements}
  Probes you can draw on:
${probes}
  Calibration: ${f.example}`;
  }).join('\n\n');
}

const STATE_GLOSS: Record<CoverageStateValue, string> = {
  pending: 'not started',
  partial: 'some evidence, not yet sufficient',
  answered: 'terminal — do not revisit',
  unknown_to_informant: 'terminal — informant does not know',
  not_applicable: 'terminal — does not apply',
};

export function coverageBlock(
  coverage: { facetId: number; state: CoverageStateValue }[],
  elements: readonly ElementView[] = [],
): string {
  const byId = new Map(coverage.map((c) => [c.facetId, c.state]));
  const byFacet = new Map<number, ElementView[]>();
  for (const e of elements) {
    const list = byFacet.get(e.facetId) ?? [];
    list.push(e);
    byFacet.set(e.facetId, list);
  }

  return FACETS.map((f) => {
    const state = byId.get(f.id) ?? 'pending';
    const head = `  ${f.id}. ${f.name}: ${state} (${STATE_GLOSS[state]})`;
    const rows = byFacet.get(f.id);
    if (!rows || rows.length === 0) return head;

    // Show the checklist so the model can see precisely what is still wanted, and
    // never re-ask for something already captured (R1.1).
    const lines = rows.map((e) => {
      if (e.state === 'captured') return `       ✓ ${e.elementId} — ${e.summary || 'captured'}`;
      if (e.state === 'not_applicable') return `       – ${e.elementId} — n/a: ${e.naReason || 'no reason given'}`;
      return `       ○ ${e.elementId} — still outstanding`;
    });
    return [head, ...lines].join('\n');
  }).join('\n');
}

export interface OptionView {
  facetId: number;
  name: string;
  source: 'taxonomy' | 'this_interview' | 'prior_interview';
  selected: boolean;
}

const SOURCE_GLOSS: Record<OptionView['source'], string> = {
  taxonomy: 'known at VMO2',
  this_interview: 'they already mentioned it',
  prior_interview: 'a colleague mentioned it',
};

/**
 * Pick-list option sets (delta v1.1 R2). Several facets are closed sets in
 * practice; offering the known options turns a tiring recall exercise into a quick
 * confirmation, and keeps vocabulary consistent across informants.
 */
export function picklistBlock(options: readonly OptionView[]): string {
  if (options.length === 0) return '';
  const byFacet = new Map<number, OptionView[]>();
  for (const o of options) {
    const list = byFacet.get(o.facetId) ?? [];
    list.push(o);
    byFacet.set(o.facetId, list);
  }

  const blocks = [...byFacet.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([facetId, opts]) => {
      const facet = FACETS.find((f) => f.id === facetId)!;
      const lines = opts.map(
        (o) => `    ${o.selected ? '[x]' : '[ ]'} ${o.name} (${SOURCE_GLOSS[o.source]})`,
      );
      return `  Facet ${facetId} — ${facet.name}:\n${lines.join('\n')}`;
    });

  return [
    'PICK-LIST FACETS (these are closed sets — offer, do not interrogate):',
    'For these facets, read out the options that plausibly apply and ask them to confirm which ones are theirs, always leaving room for something not on the list. A [x] means this informant has already named it — treat that as settled and do not ask again. Never read the source labels aloud, and never present a colleague\'s answer as though it were fact: "some of your colleagues mentioned X — does that apply to you?"',
    'Whenever they name something, call record_entity so it joins the engagement vocabulary — including things that are not on the list.',
    '',
    ...blocks,
  ].join('\n');
}

export interface ElementView {
  facetId: number;
  elementId: string;
  state: 'outstanding' | 'captured' | 'not_applicable';
  summary: string;
  naReason: string;
}

export function buildSystemPrompt(input: {
  role: string;
  processName: string | null;
  coverage: { facetId: number; state: CoverageStateValue }[];
  elements?: readonly ElementView[];
  options?: readonly OptionView[];
}): string {
  const processLine = input.processName
    ? `The process under discussion is: "${input.processName}".`
    : `No process has been named yet. Open by eliciting which process they run (facet 1) before anything else.`;

  return [
    CONDUCT.replace('{ROLE}', input.role),
    '',
    SCORING,
    '',
    'THE TWELVE FACETS (your blueprint — never say these names to the informant):',
    '',
    facetSpecBlock(),
    '',
    processLine,
    '',
    picklistBlock(input.options ?? []),
    '',
    'LIVE COVERAGE (updated every turn — steer toward what is still outstanding, and never re-ask for a ✓):',
    coverageBlock(input.coverage, input.elements ?? []),
  ].join('\n');
}

/**
 * Opening instruction (no informant turn yet): produce a warm one-line welcome and
 * exactly one opening question. No tool calls on the opening.
 */
export const OPENING_INSTRUCTION =
  'Begin the interview now. Give a warm one-sentence welcome, then ask exactly one opening question. Do not call any tools yet.';
