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
import type { CoverageState, Session } from '@/lib/db/schema';
import {
  appendTurn,
  getCoverage,
  getInterviewee,
  getSession,
  listTurns,
  raiseFinding,
  recordStatement,
  setCoverage,
  updateSession,
} from '@/lib/db/queries';
import { allResolved, IllegalCoverageTransitionError, type CoverageStateValue } from './coverage';
import { getFacet } from '@/lib/facets/facets';
import { buildSystemPrompt, OPENING_INSTRUCTION } from './prompt';
import { callModel, type ModelToolCall } from './model';
import { OPENING_MOCK } from './mock';
import { violatesOneQuestion } from './one-question';
import {
  endInterviewSchema,
  raiseFindingSchema,
  recordStatementSchema,
  setCoverageSchema,
} from './tools';

const MAX_TOOL_HOPS = 10;

export interface TurnResult {
  agentTurn: { seq: number; content: string };
  coverage: { facetId: number; state: CoverageStateValue }[];
  status: Session['status'];
  /** True when this turn produced the end-of-interview playback (FR-4.1). */
  review: boolean;
  warnings: string[];
}

function coverageView(rows: CoverageState[]): { facetId: number; state: CoverageStateValue }[] {
  return rows.map((r) => ({ facetId: r.facetId, state: r.state }));
}

function turnAt(sessionId: string, seq: number, db: DB) {
  return listTurns(sessionId, db).find((t) => t.seq === seq);
}

/** Map the persisted transcript to Anthropic messages (agent/user only). */
function buildMessages(sessionId: string, db: DB): Anthropic.MessageParam[] {
  return listTurns(sessionId, db)
    .filter((t) => t.speaker === 'agent' || t.speaker === 'user')
    .map((t) => ({
      role: t.speaker === 'agent' ? ('assistant' as const) : ('user' as const),
      content: t.content,
    }));
}

// ── Opening (FR-2.3) ─────────────────────────────────────────────────────────
/** Ensure the opening agent turn exists. Idempotent — safe to call on every load. */
export async function openInterview(sessionId: string, db: DB = getDb()): Promise<void> {
  const session = getSession(sessionId, db);
  if (!session) throw new Error(`No session ${sessionId}`);
  const existing = listTurns(sessionId, db);
  if (existing.some((t) => t.speaker === 'agent')) return; // already opened

  let text: string;
  if (config.mockModel) {
    text = OPENING_MOCK;
  } else {
    const interviewee = getInterviewee(session.intervieweeId, db)!;
    const system = buildSystemPrompt({
      role: interviewee.role,
      processName: session.processName,
      coverage: coverageView(getCoverage(sessionId, db)),
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

  appendTurn({ sessionId, seq: 1, speaker: 'agent', content: text }, db);
}

// ── Tool application (P1) ────────────────────────────────────────────────────
interface ApplyResult {
  content: string;
  isError: boolean;
  appliedName?: string;
  ended?: boolean;
}

export function applyTool(session: Session, call: ModelToolCall, db: DB): ApplyResult {
  try {
    switch (call.name) {
      case 'record_statement': {
        const input = recordStatementSchema.parse(call.input);
        recordStatement(
          { sessionId: session.id, facetId: input.facetId, kind: input.kind, content: input.content, verbatim: input.verbatim },
          db,
        );
        return { content: 'recorded', isError: false, appliedName: call.name };
      }
      case 'set_coverage': {
        const input = setCoverageSchema.parse(call.input);
        try {
          setCoverage(session.id, input.facetId, input.state, db);
          return { content: 'coverage updated', isError: false, appliedName: call.name };
        } catch (err) {
          if (err instanceof IllegalCoverageTransitionError) {
            return {
              content: `Illegal transition ${err.from} → ${err.to} for facet ${input.facetId}. Terminal states are immutable; from pending you may go to partial/answered/unknown_to_informant/not_applicable, from partial only to answered/unknown_to_informant.`,
              isError: true,
            };
          }
          throw err;
        }
      }
      case 'raise_finding': {
        const input = raiseFindingSchema.parse(call.input);
        raiseFinding(
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
        return { content: 'finding raised', isError: false, appliedName: call.name };
      }
      case 'end_interview': {
        endInterviewSchema.parse(call.input);
        const rows = getCoverage(session.id, db);
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

function moveToReview(session: Session, db: DB): void {
  const startedAt = session.startedAt ?? new Date();
  const durationSec = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
  updateSession(session.id, { status: 'review', durationSec }, db);
}

// ── Hard stop (FR-3.7) ───────────────────────────────────────────────────────
function forceReview(session: Session, db: DB): void {
  for (const row of getCoverage(session.id, db)) {
    if (row.state === 'pending' || row.state === 'partial') {
      setCoverage(session.id, row.facetId, 'unknown_to_informant', db);
      raiseFinding(
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
export async function processUserTurn(
  sessionId: string,
  input: { seq: number; content: string },
  db: DB = getDb(),
  opts: { maxTurns?: number } = {},
): Promise<TurnResult> {
  const maxTurns = opts.maxTurns ?? config.sessionMaxTurns;
  const session = getSession(sessionId, db);
  if (!session) throw new Error(`No session ${sessionId}`);

  const result = (review: boolean, warnings: string[], agentSeq: number, agentText: string): TurnResult => ({
    agentTurn: { seq: agentSeq, content: agentText },
    coverage: coverageView(getCoverage(sessionId, db)),
    status: getSession(sessionId, db)!.status,
    review,
    warnings,
  });

  // Only an open session accepts new turns.
  if (session.status !== 'open') {
    const lastAgent = [...listTurns(sessionId, db)].reverse().find((t) => t.speaker === 'agent');
    return result(session.status === 'review', [], lastAgent?.seq ?? 0, lastAgent?.content ?? '');
  }

  // Idempotency (FR-3.9): dedupe the user turn; if its agent reply already exists,
  // return it without re-running the model.
  appendTurn({ sessionId, seq: input.seq, speaker: 'user', content: input.content }, db);
  const cachedReply = turnAt(sessionId, input.seq + 1, db);
  if (cachedReply && cachedReply.speaker === 'agent') {
    return result(getSession(sessionId, db)!.status === 'review', [], cachedReply.seq, cachedReply.content);
  }

  const userTurnCount = listTurns(sessionId, db).filter((t) => t.speaker === 'user').length;

  // Hard stop before spending a model call.
  if (userTurnCount >= maxTurns) {
    forceReview(session, db);
    const agentSeq = nextAgentSeq(sessionId, input.seq, db);
    appendTurn({ sessionId, seq: agentSeq, speaker: 'agent', content: TRUNCATION_MESSAGE }, db);
    return result(true, ['hard-stop: reached SESSION_MAX_TURNS'], agentSeq, TRUNCATION_MESSAGE);
  }

  const interviewee = getInterviewee(session.intervieweeId, db)!;
  const messages = buildMessages(sessionId, db);
  const warnings: string[] = [];
  let lastAppliedTool: string | null = null;
  let agentText = '';

  for (let hop = 0; hop < MAX_TOOL_HOPS; hop += 1) {
    const system = buildSystemPrompt({
      role: interviewee.role,
      processName: session.processName,
      coverage: coverageView(getCoverage(sessionId, db)),
    });
    const resp = await callModel({ sessionId, system, messages, lastAppliedTool, db });

    if (resp.stopReason !== 'tool_use' || resp.toolCalls.length === 0) {
      agentText = resp.text;
      break;
    }

    messages.push({ role: 'assistant', content: resp.assistantContent });
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
    messages.push({ role: 'user', content: toolResults });
  }

  const nowReview = getSession(sessionId, db)!.status === 'review';

  // One-question rule (FR-3.3) — closing/review turns excepted. Reprompt once.
  if (!nowReview && agentText && violatesOneQuestion(agentText)) {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: agentText }] });
    messages.push({ role: 'user', content: 'Please ask exactly one question in your next message.' });
    const retry = await callModel({ sessionId, system: buildSystemPrompt({ role: interviewee.role, processName: session.processName, coverage: coverageView(getCoverage(sessionId, db)) }), messages, lastAppliedTool, db });
    if (retry.stopReason !== 'tool_use' && retry.text) {
      agentText = retry.text;
      if (violatesOneQuestion(agentText)) warnings.push('one-question rule still violated after reprompt');
    }
  }

  if (!agentText) agentText = 'Thank you.';

  const agentSeq = nextAgentSeq(sessionId, input.seq, db);
  appendTurn({ sessionId, seq: agentSeq, speaker: 'agent', content: agentText }, db);

  const finalUserCount = listTurns(sessionId, db).filter((t) => t.speaker === 'user').length;
  const startedAt = session.startedAt ?? new Date();
  updateSession(
    session.id,
    { turnCount: finalUserCount, durationSec: Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)) },
    db,
  );

  return result(getSession(sessionId, db)!.status === 'review', warnings, agentSeq, agentText);
}

/** The agent reply seq: userSeq+1 unless taken, else next free seq. */
function nextAgentSeq(sessionId: string, userSeq: number, db: DB): number {
  const desired = userSeq + 1;
  const taken = turnAt(sessionId, desired, db);
  if (!taken) return desired;
  const max = listTurns(sessionId, db).reduce((m, t) => Math.max(m, t.seq), 0);
  return max + 1;
}
