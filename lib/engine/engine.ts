/**
 * Interview engine (BUILD-REQUIREMENTS FR-3). A server-side loop that:
 *  - assembles context (system prompt + facet spec + transcript + live coverage),
 *  - calls the model with tools,
 *  - validates and applies each tool call (P1 — server disposes),
 *  - enforces one question per agent turn,
 *  - persists every turn (resume by replay; no in-memory session store, FR-3.8),
 *  - dedupes user turns on (sessionId, seq) (FR-3.9),
 *  - hard-stops at SESSION_MAX_TURNS (FR-3.7).
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';
import { getDb, type DB } from '@/lib/db';
import type { CoverageState, ElementState, Session } from '@/lib/db/schema';
import {
  appendTurn,
  getCoverage,
  getInterviewee,
  getLatestSpec,
  getSession,
  listFindingsForSession,
  listTurns,
  picklistOptions,
  raiseFinding,
  getElements,
  recordEntityMention,
  recordStatement,
  setCoverage,
  setElement,
  setIntervieweeStatus,
  upsertEntity,
  updateSession,
} from '@/lib/db/queries';
import { generateAndSaveSpec } from '@/lib/spec/generate';
import { allResolved, IllegalCoverageTransitionError, type CoverageStateValue } from './coverage';
import { budgetState, selectFollowUps } from './priority';
import { buildLedger, ledgerBlock } from './ledger';
import {
  PICKLIST_FACETS,
  elementBelongsToFacet,
  elementsFor,
  getFacet,
} from '@/lib/facets/facets';
import {
  buildSystemPrompt,
  OPENING_INSTRUCTION,
  type ElementView,
  type OptionView,
} from './prompt';
import { callModel, type ModelToolCall } from './model';
import { OPENING_MOCK } from './mock';
import { violatesOneQuestion } from './one-question';
import {
  endInterviewSchema,
  raiseFindingSchema,
  recordEntitySchema,
  recordStatementSchema,
  setCoverageSchema,
  setElementSchema,
} from './tools';

const MAX_TOOL_HOPS = 10;

// Per-turn phase directives (the informant never sees these).
const EXTRACTION_DIRECTIVE =
  '[Internal bookkeeping step — the informant does not see this and you are not talking to them here.] ' +
  "Capture the informant's most recent answer now. Call record_statement for every distinct substantive fact they stated, each filed to the correct facet (identity/purpose/boundaries → 1; roles and hand-offs → 2; triggers/timing → 3; inputs/outputs → 4; ordered steps with actor and system → 5; rules/approval thresholds → 6; records → 7; systems/tools → 8; controls/compliance → 9; exceptions → 10; volumes/durations/targets → 11; bottlenecks/queues/workarounds → 12). " +
  'Then call set_element for every checklist element this answer substantively closes, across any facet — one answer often closes elements in several. Judge the content, not the words used: if the informant conveyed the substance in their own plain language, it is captured. Give each a one-line summary in their terms. ' +
  'Use set_coverage only for an honest whole-facet judgement the checklist cannot reach: unknown_to_informant, or not_applicable. You cannot mark a facet answered — that is derived from its elements. If every facet is already terminal, call end_interview. ' +
  'Make only tool calls in this step — do not write any message to the informant. When there is nothing left to record for this answer, stop.';

/**
 * Delta v1.1 R4.2 — the question phase is handed the ranked shortlist rather than
 * left to choose for itself. Interviewees want to talk freely and be asked one or
 * two sharp clarifiers, not walked through a questionnaire.
 */
function questionDirective(shortlist: readonly { label: string; because: string }[]): string {
  const base =
    '[Internal step.] Recording is done. Now write your single next message to the informant: exactly one question, anchoring on a concrete last-real-occurrence before general practice. Warm, plain British English, one question mark, and do not call any tools.';
  if (shortlist.length === 0) return base;

  const lines = shortlist.map((c) => `  · ${c.label} — because ${c.because}`).join('\n');
  return (
    base +
    '\n\nThe highest-value things still missing, in order:\n' +
    lines +
    '\n\nAsk about the first one unless the conversation makes the second more natural. Never ask about anything already captured — let them talk, and clarify sparingly.'
  );
}

// R9.1 — framed as a natural end, never as a failure to finish.
const BUDGET_MESSAGE =
  'That is everything I wanted to ask — thank you, that was really useful. ' +
  'Have a look at what I captured on the right, and tell me if anything is wrong or missing before we close.';

const PLAYBACK_DIRECTIVE =
  '[Internal step.] Every facet is now covered. Write a short, warm per-facet playback of what you captured, then invite the informant to confirm or correct anything before you close. Do not call any tools.';

export interface TurnResult {
  agentTurn: { seq: number; content: string };
  coverage: { facetId: number; state: CoverageStateValue }[];
  /** Live checklist, so the rail can show what is still wanted (R1.1). */
  elements: ElementView[];
  /** The felt horizon — shown to the informant as "question N of ~M" (R9.1). */
  budget: { asked: number; globalCap: number; remaining: number; exhausted: boolean };
  status: Session['status'];
  /** True when this turn produced the end-of-interview playback (FR-4.1). */
  review: boolean;
  warnings: string[];
}

function coverageView(rows: CoverageState[]): { facetId: number; state: CoverageStateValue }[] {
  return rows.map((r) => ({ facetId: r.facetId, state: r.state }));
}

/** Pick-list options for the prompt, across every pick-list facet (R2). */
async function optionView(sessionId: string, db: DB): OptionView[] {
  return PICKLIST_FACETS.flatMap((f) =>
    (await picklistOptions(sessionId, f.id, db)).map((o) => ({
      facetId: f.id,
      name: o.name,
      source: o.source,
      selected: o.selected,
    })),
  );
}

/** Checklist state for the prompt's live coverage block (R1.1). */
function elementView(rows: ElementState[]): ElementView[] {
  return rows.map((r) => ({
    facetId: r.facetId,
    elementId: r.elementId,
    state: r.state,
    summary: r.summary,
    naReason: r.naReason,
  }));
}

/** How many questions the agent has actually put to the informant (R9.1). */
async function agentQuestionsAsked(sessionId: string, db: DB): number {
  return (await listTurns(sessionId, db)).filter((t) => t.speaker === 'agent').length;
}

async function turnAt(sessionId: string, seq: number, db: DB) {
  return (await listTurns(sessionId, db)).find((t) => t.seq === seq);
}

/** Map the persisted transcript to Anthropic messages (agent/user only). */
async function buildMessages(sessionId: string, db: DB): Anthropic.MessageParam[] {
  return await listTurns(sessionId, db)
    .filter((t) => t.speaker === 'agent' || t.speaker === 'user')
    .map((t) => ({
      role: t.speaker === 'agent' ? ('assistant' as const) : ('user' as const),
      content: t.content,
    }));
}

// ── Opening (FR-2.3) ─────────────────────────────────────────────────────────
/** Ensure the opening agent turn exists. Idempotent — safe to call on every load. */
export async function openInterview(sessionId: string, db: DB = getDb()): Promise<void> {
  const session = await getSession(sessionId, db);
  if (!session) throw new Error(`No session ${sessionId}`);
  const existing = await listTurns(sessionId, db);
  if (existing.some((t) => t.speaker === 'agent')) return; // already opened

  let text: string;
  if (config.mockModel) {
    text = OPENING_MOCK;
  } else {
    const interviewee = await getInterviewee(session.intervieweeId, db)!;
    const system = buildSystemPrompt({
      role: interviewee.role,
      processName: session.processName,
      coverage: coverageView(await getCoverage(sessionId, db)),
      elements: elementView(await getElements(sessionId, db)),
      options: optionView(sessionId, db),
    });
    const resp = await callModel({
      sessionId,
      system,
      messages: [{ role: 'user', content: OPENING_INSTRUCTION }],
      lastAppliedTool: null,
      db,
      noTools: true,
    });
    text = resp.text || 'Thanks for making the time. To start, which process shall we talk about?';
  }

  await appendTurn({ sessionId, seq: 1, speaker: 'agent', content: text }, db);
}

// ── Tool application (P1) ────────────────────────────────────────────────────
interface ApplyResult {
  content: string;
  isError: boolean;
  appliedName?: string;
  ended?: boolean;
}

export async function applyTool(session: Session, call: ModelToolCall, db: DB): ApplyResult {
  try {
    switch (call.name) {
      case 'record_statement': {
        const input = recordStatementSchema.parse(call.input);
        await recordStatement(
          { sessionId: session.id, facetId: input.facetId, kind: input.kind, content: input.content, verbatim: input.verbatim },
          db,
        );
        return { content: 'recorded', isError: false, appliedName: call.name };
      }
      case 'set_coverage': {
        const input = setCoverageSchema.parse(call.input);
        try {
          await setCoverage(session.id, input.facetId, input.state, db);
          // An honest unknown is always surfaced for a human (P2/P3): if the model
          // moved a facet to unknown_to_informant without raising the paired
          // retarget finding, the server creates it. No silent gaps.
          if (input.state === 'unknown_to_informant') {
            ensureRetargetFinding(
              session,
              input.facetId,
              'Flagged for retargeting — the informant could not answer this facet; route to someone who owns it.',
              db,
            );
          }
          return { content: 'coverage updated', isError: false, appliedName: call.name };
        } catch (err) {
          if (err instanceof IllegalCoverageTransitionError) {
            return {
              content: `Illegal transition ${err.from} → ${err.to} for facet ${input.facetId}. Terminal states are immutable. answered and partial are derived from the checklist — close elements with set_element instead of setting coverage directly.`,
              isError: true,
            };
          }
          throw err;
        }
      }
      case 'set_element': {
        const input = setElementSchema.parse(call.input);
        if (!elementBelongsToFacet(input.elementId, input.facetId)) {
          const valid = elementsFor(input.facetId)
            .map((e) => e.id)
            .join(', ');
          return {
            content: `Unknown element "${input.elementId}" for facet ${input.facetId}. Valid ids: ${valid}.`,
            isError: true,
          };
        }
        // A captured element with no summary would leave the interviewee unable to
        // check what the system heard — R1.1 requires the readback.
        if (input.state === 'captured' && input.summary.trim() === '') {
          return {
            content:
              'A captured element needs a one-line summary of what the informant actually said. Call again with summary set.',
            isError: true,
          };
        }
        await setElement(
          {
            sessionId: session.id,
            facetId: input.facetId,
            elementId: input.elementId,
            state: input.state,
            summary: input.summary.trim(),
            naReason: input.reason.trim(),
          },
          db,
        );
        return { content: `element ${input.elementId} ${input.state}`, isError: false, appliedName: call.name };
      }
      case 'record_entity': {
        const input = recordEntitySchema.parse(call.input);
        // The server canonicalises and de-duplicates (P1, R2.3). A name first heard
        // in an interview is pending — a candidate for the taxonomy, not yet in it.
        const entity = await upsertEntity(
          { projectId: session.projectId, kind: input.kind, name: input.name },
          db,
        );
        await recordEntityMention(
          {
            sessionId: session.id,
            entityId: entity.id,
            facetId: input.facetId,
            source: entity.origin === 'taxonomy' ? 'taxonomy' : 'this_interview',
          },
          db,
        );
        return {
          content: `entity ${entity.canonicalKey} (${entity.status})`,
          isError: false,
          appliedName: call.name,
        };
      }
      case 'raise_finding': {
        const input = raiseFindingSchema.parse(call.input);
        // unknown_retarget is deduped per facet (the server may already have paired
        // one on set_coverage); other finding types may recur.
        if (input.type === 'unknown_retarget') {
          ensureRetargetFinding(session, input.facetId, input.detail || input.title, db);
        } else {
          await raiseFinding(
            {
              projectId: session.projectId,
              sessionId: session.id,
              facetId: input.facetId,
              type: input.type,
              title: input.title,
              detail: input.detail,
              status: 'open',
              routedTo: '',
            },
            db,
          );
        }
        return { content: 'finding raised', isError: false, appliedName: call.name };
      }
      case 'end_interview': {
        endInterviewSchema.parse(call.input);
        const rows = await getCoverage(session.id, db);
        const unresolved = rows.filter((r) => r.state === 'pending' || r.state === 'partial');
        if (unresolved.length > 0) {
          const names = unresolved.map((r) => `${r.facetId}. ${getFacet(r.facetId).name} (${r.state})`);
          return {
            content: `Cannot end yet — these facets are not terminal: ${names.join('; ')}. Resolve each before ending.`,
            isError: true,
          };
        }
        moveToReview(session, db);
        return { content: 'interview ended', isError: false, appliedName: call.name, ended: true };
      }
      default:
        return { content: `Unknown tool: ${call.name}`, isError: true };
    }
  } catch {
    return { content: `Invalid arguments for ${call.name}.`, isError: true };
  }
}

/** Create the unknown_retarget finding for a facet if one does not already exist. */
async function ensureRetargetFinding(session: Session, facetId: number, detail: string, db: DB): void {
  const already = (await listFindingsForSession(session.id, db)).some(
    (f) => f.facetId === facetId && f.type === 'unknown_retarget',
  );
  if (already) return;
  await raiseFinding(
    {
      projectId: session.projectId,
      sessionId: session.id,
      facetId,
      type: 'unknown_retarget',
      title: `Facet ${facetId} not known to this informant`,
      detail,
      status: 'open',
      routedTo: '',
    },
    db,
  );
}

async function moveToReview(session: Session, db: DB): void {
  const startedAt = session.startedAt ?? new Date();
  const durationSec = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
  await updateSession(session.id, { status: 'review', durationSec }, db);
}

// ── Hard stop (FR-3.7) ───────────────────────────────────────────────────────
async function forceReview(session: Session, db: DB): void {
  for (const row of await getCoverage(session.id, db)) {
    if (row.state === 'pending' || row.state === 'partial') {
      await setCoverage(session.id, row.facetId, 'unknown_to_informant', db);
      await raiseFinding(
        {
          projectId: session.projectId,
          sessionId: session.id,
          facetId: row.facetId,
          type: 'informant_flag',
          title: `Facet ${row.facetId} truncated at max turns`,
          detail: 'The interview reached the maximum turn count before this facet was resolved.',
          status: 'open',
          routedTo: '',
        },
        db,
      );
    }
  }
  moveToReview(session, db);
}

const TRUNCATION_MESSAGE =
  'We have covered a lot of ground and reached the time limit for this session. ' +
  'I have marked anything we did not get to as not known, and flagged it for the team. ' +
  'Thank you for your time — does the summary so far look right to you?';

// ── Process a user turn ──────────────────────────────────────────────────────
export function processUserTurn(
  sessionId: string,
  input: { seq: number; content: string },
  db: DB = getDb(),
  opts: { maxTurns?: number } = {},
): Promise<TurnResult> {
  const maxTurns = opts.maxTurns ?? config.sessionMaxTurns;
  const session = await getSession(sessionId, db);
  if (!session) throw new Error(`No session ${sessionId}`);

  const result = (review: boolean, warnings: string[], agentSeq: number, agentText: string): TurnResult => ({
    agentTurn: { seq: agentSeq, content: agentText },
    coverage: coverageView(await getCoverage(sessionId, db)),
    elements: elementView(await getElements(sessionId, db)),
    budget: budgetState(agentQuestionsAsked(sessionId, db), config.questionBudget),
    status: await getSession(sessionId, db)!.status,
    review,
    warnings,
  });

  // Open and review sessions accept turns (review turns are corrections, FR-4.1).
  // Completed/abandoned sessions do not.
  if (session.status === 'complete' || session.status === 'abandoned') {
    const lastAgent = [...listTurns(sessionId, db)].reverse().find((t) => t.speaker === 'agent');
    return result(false, [], lastAgent?.seq ?? 0, lastAgent?.content ?? '');
  }

  // Idempotency (FR-3.9): dedupe the user turn; if its agent reply already exists,
  // return it without re-running the model.
  await appendTurn({ sessionId, seq: input.seq, speaker: 'user', content: input.content }, db);
  const cachedReply = turnAt(sessionId, input.seq + 1, db);
  if (cachedReply && cachedReply.speaker === 'agent') {
    return result(await getSession(sessionId, db)!.status === 'review', [], cachedReply.seq, cachedReply.content);
  }

  const userTurnCount = (await listTurns(sessionId, db)).filter((t) => t.speaker === 'user').length;

  // Delta v1.1 R9.1 — the question budget is spent. Move to the playback rather
  // than grinding on: budget exhaustion truncates from the least important end,
  // because R9.2's ranking asked the highest-value questions first.
  if (session.status === 'open' && agentQuestionsAsked(sessionId, db) >= config.questionBudget) {
    forceReview(session, db);
    const agentSeq = nextAgentSeq(sessionId, input.seq, db);
    await appendTurn({ sessionId, seq: agentSeq, speaker: 'agent', content: BUDGET_MESSAGE }, db);
    return result(true, ['budget: reached QUESTION_BUDGET'], agentSeq, BUDGET_MESSAGE);
  }

  // Hard stop before spending a model call (open interviews only).
  if (session.status === 'open' && userTurnCount >= maxTurns) {
    forceReview(session, db);
    const agentSeq = nextAgentSeq(sessionId, input.seq, db);
    await appendTurn({ sessionId, seq: agentSeq, speaker: 'agent', content: TRUNCATION_MESSAGE }, db);
    return result(true, ['hard-stop: reached SESSION_MAX_TURNS'], agentSeq, TRUNCATION_MESSAGE);
  }

  const interviewee = await getInterviewee(session.intervieweeId, db)!;
  const warnings: string[] = [];
  const systemNow = () =>
    buildSystemPrompt({
      role: interviewee.role,
      processName: session.processName,
      coverage: coverageView(await getCoverage(sessionId, db)),
      elements: elementView(await getElements(sessionId, db)),
      options: optionView(sessionId, db),
    });

  // ── Phase A — extraction (tools only). A dedicated bookkeeping step, so the
  //    model reliably records statements and advances coverage rather than
  //    treating it as optional during conversation (P1 — the server drives this).
  const exMessages = buildMessages(sessionId, db);
  exMessages.push({ role: 'user', content: EXTRACTION_DIRECTIVE });
  let lastAppliedTool: string | null = null;
  for (let hop = 0; hop < MAX_TOOL_HOPS; hop += 1) {
    const resp = await callModel({
      sessionId,
      system: systemNow(),
      messages: exMessages,
      lastAppliedTool,
      toolChoice: hop === 0 ? 'any' : 'auto',
      db,
    });
    if (resp.stopReason !== 'tool_use' || resp.toolCalls.length === 0) break;

    exMessages.push({ role: 'assistant', content: resp.assistantContent });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of resp.toolCalls) {
      const applied = applyTool(session, call, db);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: applied.content,
        is_error: applied.isError,
      });
      if (!applied.isError) lastAppliedTool = applied.appliedName ?? call.name;
      else warnings.push(`${call.name} rejected: ${applied.content}`);
    }
    exMessages.push({ role: 'user', content: toolResults });
  }

  const nowReview = await getSession(sessionId, db)!.status === 'review';

  // ── Phase B — the agent's message (no tools): one question, or the playback
  //    once every facet is terminal (FR-3.3, FR-4.1).
  const qMessages = buildMessages(sessionId, db);
  // R4.2 — hand the model the ranked shortlist, each item citing what prompted it.
  const shortlist = nowReview
    ? []
    : selectFollowUps({
        coverage: coverageView(await getCoverage(sessionId, db)),
        elements: (await getElements(sessionId, db)).map((e) => ({
          facetId: e.facetId,
          elementId: e.elementId,
          state: e.state,
        })),
      });
  // R4.3 — the ledger, not the raw transcript, is what guarantees no repeats.
  const ledger = nowReview ? '' : ledgerBlock(buildLedger(sessionId, db));
  qMessages.push({
    role: 'user',
    content: nowReview
      ? PLAYBACK_DIRECTIVE
      : [ledger, questionDirective(shortlist)].filter(Boolean).join('\n\n'),
  });
  const qResp = await callModel({
    sessionId,
    system: systemNow(),
    messages: qMessages,
    lastAppliedTool,
    noTools: true,
    db,
  });
  let agentText = qResp.text;

  // One-question rule (FR-3.3) — closing/review turns excepted. Reprompt on
  // violation (up to two attempts), then accept and log a warning.
  if (!nowReview && agentText) {
    for (let attempt = 0; attempt < 2 && violatesOneQuestion(agentText); attempt += 1) {
      qMessages.push({ role: 'assistant', content: [{ type: 'text', text: agentText }] });
      qMessages.push({
        role: 'user',
        content:
          'Your last message contained more than one question. Re-ask as a single question only — one question mark, no clarifying or rephrased second question. Keep the same warm tone.',
      });
      const retry = await callModel({
        sessionId,
        system: systemNow(),
        messages: qMessages,
        lastAppliedTool,
        noTools: true,
        db,
      });
      if (!retry.text) break;
      agentText = retry.text;
    }
    if (violatesOneQuestion(agentText)) warnings.push('one-question rule still violated after reprompt');
  }

  if (!agentText) {
    agentText = nowReview
      ? 'Thank you — that is everything captured. Does the summary look right to you?'
      : 'Thanks — could you tell me a little more about that?';
  }

  const agentSeq = nextAgentSeq(sessionId, input.seq, db);
  await appendTurn({ sessionId, seq: agentSeq, speaker: 'agent', content: agentText }, db);

  const finalUserCount = (await listTurns(sessionId, db)).filter((t) => t.speaker === 'user').length;
  const startedAt = session.startedAt ?? new Date();
  await updateSession(
    session.id,
    { turnCount: finalUserCount, durationSec: Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)) },
    db,
  );

  return result(await getSession(sessionId, db)!.status === 'review', warnings, agentSeq, agentText);
}

// ── Completion (FR-4.2, FR-5) ────────────────────────────────────────────────
/**
 * Confirm the review and complete the interview: generate + validate + save the
 * spec, then set session and interviewee to complete. An invalid spec throws and
 * blocks completion (FR-5.5). Idempotent once complete.
 */
export function completeInterview(
  sessionId: string,
  db: DB = getDb(),
): Promise<{ specVersion: number }> {
  const session = await getSession(sessionId, db);
  if (!session) throw new Error(`No session ${sessionId}`);
  if (session.status === 'complete') {
    return { specVersion: await getLatestSpec(sessionId, db)?.version ?? 0 };
  }
  // Delta v1.1 R9.3: an open session may be finished early. The informant is
  // never trapped by their own coverage — the spec is generated regardless of
  // state, and what is missing is written down rather than papered over (R9.4).
  if (session.status !== 'review' && session.status !== 'open') {
    throw new Error(`Cannot complete a session in status ${session.status}`);
  }

  const startedAt = session.startedAt ?? new Date();
  const durationSec = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
  // Persist timing first so the spec reflects completion, but keep status 'review'
  // until the spec validates — an invalid spec must block completion.
  await updateSession(sessionId, { completedAt: new Date(), durationSec }, db);

  const spec = await generateAndSaveSpec(sessionId, db); // throws on invalid → completion blocked

  await updateSession(sessionId, { status: 'complete' }, db);
  await setIntervieweeStatus(session.intervieweeId, 'complete', db);
  return { specVersion: spec.version };
}

/** The agent reply seq: userSeq+1 unless taken, else next free seq. */
async function nextAgentSeq(sessionId: string, userSeq: number, db: DB): number {
  const desired = userSeq + 1;
  const taken = turnAt(sessionId, desired, db);
  if (!taken) return desired;
  const max = (await listTurns(sessionId, db)).reduce((m, t) => Math.max(m, t.seq), 0);
  return max + 1;
}
