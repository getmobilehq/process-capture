/**
 * Query module — the only sanctioned way to read and write the data model.
 *
 * Invariants enforced here (not by the model, not by callers):
 *  - Turns and Statements are append-only. There is no update/delete for them;
 *    a correction is a new Statement carrying supersedesId (P2, §5).
 *  - Coverage transitions are validated against the state machine (P1, P3).
 *  - Every Session seeds exactly 12 CoverageState rows as `pending` (FR-2.2, P3).
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb, type DB } from './index';
import {
  answerDrafts,
  changeReviews,
  coverageStates,
  elementStates,
  entities,
  entityMentions,
  findings,
  interviewees,
  processGraphs,
  projects,
  sessions,
  specs,
  statements,
  turns,
  type Finding,
  type NewFinding,
  type NewProject,
  type Project,
  type Entity,
  type Session,
  type Statement,
} from './schema';
import {
  ALL_ELEMENTS,
  FACET_IDS,
  canonicalKey,
  elementBelongsToFacet,
  entityKindFor,
  getElement,
  type EntityKind,
} from '@/lib/facets/facets';
import { TAXONOMY_SEED } from '@/lib/facets/taxonomy';
import {
  assertTransition,
  deriveFacetState,
  isTerminal,
  type CoverageStateValue,
  type ElementStateValue,
} from '@/lib/engine/coverage';

// Invite tokens: unguessable, ≥ 24 chars (§5). nanoid(32) → 32-char url-safe.
export async function generateInviteToken(): Promise<string> {
  return nanoid(32);
}

// ── Projects ─────────────────────────────────────────────────────────────────
export async function createProject(
  input: Pick<NewProject, 'name' | 'department'> &
    Partial<Pick<NewProject, 'description' | 'targetProcesses'>>,
  db: DB = getDb(),
) {
  const row = await db
    .insert(projects)
    .values({
      name: input.name,
      department: input.department,
      description: input.description ?? '',
      targetProcesses: input.targetProcesses ?? [],
    })
    .returning().then((r) => r[0]);
  // Every engagement starts with the house vocabulary (R2.2).
  await seedTaxonomy(row.id, db);
  return row;
}

export async function getProject(id: string, db: DB = getDb()) {
  return db.select().from(projects).where(eq(projects.id, id)).then((r) => r[0]);
}

export async function listProjects(db: DB = getDb()) {
  return db.select().from(projects).orderBy(desc(projects.createdAt));
}

/**
 * Retire a target process (console request, August 2026). The name moves from
 * the live list to the archived one — it is never deleted, because sessions
 * already recorded against it are a named person's account of their job and must
 * stay readable. Archiving only withdraws the *offer*: no new interview can be
 * started against it.
 *
 * Both moves are idempotent and run in one transaction, so a name can never end
 * up in both lists or neither.
 */
export async function archiveTargetProcess(
  projectId: string,
  name: string,
  db: DB = getDb(),
): Promise<Project | undefined> {
  return moveTargetProcess(projectId, name, 'archive', db);
}

/** Return an archived process to the live list. The inverse of the above. */
export async function restoreTargetProcess(
  projectId: string,
  name: string,
  db: DB = getDb(),
): Promise<Project | undefined> {
  return moveTargetProcess(projectId, name, 'restore', db);
}

async function moveTargetProcess(
  projectId: string,
  name: string,
  direction: 'archive' | 'restore',
  db: DB = getDb(),
): Promise<Project | undefined> {
  const wanted = name.trim();
  if (!wanted) return undefined;

  return db.transaction(async (tx) => {
    const project = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .then((r) => r[0]);
    if (!project) return undefined;

    const from = direction === 'archive' ? project.targetProcesses : project.archivedProcesses;
    if (!from.includes(wanted)) return project; // already where it was asked to go

    const live =
      direction === 'archive'
        ? project.targetProcesses.filter((p) => p !== wanted)
        : [...project.targetProcesses.filter((p) => p !== wanted), wanted];
    const archived =
      direction === 'archive'
        ? [...project.archivedProcesses.filter((p) => p !== wanted), wanted]
        : project.archivedProcesses.filter((p) => p !== wanted);

    return tx
      .update(projects)
      .set({ targetProcesses: live, archivedProcesses: archived })
      .where(eq(projects.id, projectId))
      .returning()
      .then((r) => r[0]);
  });
}

/**
 * How many sessions were recorded against each process name in this project.
 * Shown beside an archive control so the architect can see what sits underneath
 * a process before retiring it — and see that archiving did not remove it.
 */
export async function countSessionsByProcess(
  projectId: string,
  db: DB = getDb(),
): Promise<Map<string, number>> {
  const rows = await db
    .select({ processName: sessions.processName })
    .from(sessions)
    .where(eq(sessions.projectId, projectId));
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.processName) continue;
    counts.set(r.processName, (counts.get(r.processName) ?? 0) + 1);
  }
  return counts;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<NewProject, 'name' | 'department' | 'description' | 'status' | 'targetProcesses' | 'archivedProcesses'>>,
  db: DB = getDb(),
) {
  const row = await db
.update(projects).set(patch).where(eq(projects.id, id)).returning().then((r) => r[0]);
  return row;
}

// ── Interviewees ─────────────────────────────────────────────────────────────
export async function addInterviewee(
  input: { projectId: string; fullName: string; email: string; role: string },
  db: DB = getDb(),
) {
  const row = await db
    .insert(interviewees)
    .values({
      projectId: input.projectId,
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      inviteToken: await generateInviteToken(),
    })
    .returning().then((r) => r[0]);
  return row;
}

export async function getInterviewee(id: string, db: DB = getDb()) {
  return db.select().from(interviewees).where(eq(interviewees.id, id)).then((r) => r[0]);
}

export async function getIntervieweeByToken(token: string, db: DB = getDb()) {
  return db.select().from(interviewees).where(eq(interviewees.inviteToken, token)).then((r) => r[0]);
}

export async function listInterviewees(projectId: string, db: DB = getDb()) {
  return db
    .select()
    .from(interviewees)
    .where(eq(interviewees.projectId, projectId))
    .orderBy(asc(interviewees.createdAt))
    ;
}

export async function updateInterviewee(
  id: string,
  patch: Partial<{ fullName: string; email: string; role: string }>,
  db: DB = getDb(),
) {
  const row = await db
.update(interviewees).set(patch).where(eq(interviewees.id, id)).returning().then((r) => r[0]);
  return row;
}

export async function setIntervieweeStatus(
  id: string,
  status: 'invited' | 'in_progress' | 'complete',
  db: DB = getDb(),
) {
  const row = await db
    .update(interviewees)
    .set({ status })
    .where(eq(interviewees.id, id))
    .returning().then((r) => r[0]);
  return row;
}

// ── Sessions ─────────────────────────────────────────────────────────────────
/**
 * Create a session and seed its 12 coverage rows as `pending`, atomically.
 * Sets startedAt; caller is responsible for interviewee status transitions.
 */
export async function createSession(
  input: { intervieweeId: string; projectId: string; processName?: string | null },
  db: DB = getDb(),
): Promise<Session> {
  return db.transaction(async (tx) => {
    const session = await tx
      .insert(sessions)
      .values({
        intervieweeId: input.intervieweeId,
        projectId: input.projectId,
        processName: input.processName ?? null,
        status: 'open',
        startedAt: new Date(),
      })
      .returning().then((r) => r[0]);

    await tx.insert(coverageStates)
      .values(FACET_IDS.map((facetId) => ({ sessionId: session.id, facetId, state: 'pending' as const })))
      ;

    // Seed the checklist too (R1.1) — every element starts outstanding, so the
    // interviewee can see the full shape of what is wanted from turn one.
    await tx.insert(elementStates)
      .values(
        ALL_ELEMENTS.map((e) => ({
          sessionId: session.id,
          facetId: e.facetId,
          elementId: e.id,
          state: 'outstanding' as const,
        })),
      )
      ;

    return session;
  });
}

export async function getSession(id: string, db: DB = getDb()) {
  return db.select().from(sessions).where(eq(sessions.id, id)).then((r) => r[0]);
}

/** The most recent session for an interviewee, whatever its status. */
export async function getLatestSession(intervieweeId: string, db: DB = getDb()) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.intervieweeId, intervieweeId))
    .orderBy(desc(sessions.createdAt))
    .then((r) => r[0]);
}

/** The open (resumable) session for an interviewee, if any (FR-3.8). */
export async function getResumableSession(intervieweeId: string, db: DB = getDb()) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.intervieweeId, intervieweeId), eq(sessions.status, 'open')))
    .orderBy(desc(sessions.createdAt))
    .then((r) => r[0]);
}

export async function listSessionsForProject(projectId: string, db: DB = getDb()) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(asc(sessions.createdAt))
    ;
}

export async function updateSession(
  id: string,
  patch: Partial<
    Pick<Session, 'processName' | 'status' | 'completedAt' | 'durationSec' | 'turnCount'>
  >,
  db: DB = getDb(),
) {
  const row = await db
.update(sessions).set(patch).where(eq(sessions.id, id)).returning().then((r) => r[0]);
  return row;
}

// ── Turns (append-only, idempotent) ──────────────────────────────────────────
export async function nextTurnSeq(sessionId: string, db: DB = getDb()): Promise<number> {
  const last = await db
    .select({ seq: turns.seq })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(desc(turns.seq))
    .then((r) => r[0]);
  return (last?.seq ?? 0) + 1;
}

/**
 * Append a turn. Idempotent on (sessionId, seq): a duplicate submit (network
 * retry) returns the existing row instead of inserting a second (FR-3.9).
 */
export async function appendTurn(
  input: { sessionId: string; seq: number; speaker: 'agent' | 'user' | 'system'; content: string },
  db: DB = getDb(),
) {
  const existing = await db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, input.sessionId), eq(turns.seq, input.seq)))
    .then((r) => r[0]);
  if (existing) return existing;

  const row = await db
    .insert(turns)
    .values({
      sessionId: input.sessionId,
      seq: input.seq,
      speaker: input.speaker,
      content: input.content,
    })
    .returning().then((r) => r[0]);
  return row;
}

export async function listTurns(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(asc(turns.seq))
    ;
}

// ── Statements (append-only) ─────────────────────────────────────────────────
export async function recordStatement(
  input: {
    sessionId: string;
    facetId: number;
    kind: Statement['kind'];
    content: string;
    verbatim?: boolean;
    supersedesId?: string | null;
  },
  db: DB = getDb(),
): Promise<Statement> {
  const row = await db
    .insert(statements)
    .values({
      sessionId: input.sessionId,
      facetId: input.facetId,
      kind: input.kind,
      content: input.content,
      verbatim: input.verbatim ?? false,
      supersedesId: input.supersedesId ?? null,
    })
    .returning().then((r) => r[0]);
  return row;
}

/**
 * Record a correction that supersedes an earlier statement. The earlier row is
 * never mutated — this is the only correction path (P2, §5).
 */
export async function supersedeStatement(
  input: {
    supersedesId: string;
    sessionId: string;
    facetId: number;
    kind: Statement['kind'];
    content: string;
    verbatim?: boolean;
  },
  db: DB = getDb(),
): Promise<Statement> {
  return await recordStatement({ ...input, supersedesId: input.supersedesId }, db);
}

export async function listStatements(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(statements)
    .where(eq(statements.sessionId, sessionId))
    .orderBy(asc(statements.createdAt))
    ;
}

export async function listStatementsForFacet(sessionId: string, facetId: number, db: DB = getDb()) {
  return db
    .select()
    .from(statements)
    .where(and(eq(statements.sessionId, sessionId), eq(statements.facetId, facetId)))
    .orderBy(asc(statements.createdAt))
    ;
}

/** Only statements that have not themselves been superseded (the live set). */
export async function listLiveStatements(sessionId: string, db: DB = getDb()) {
  const all = await listStatements(sessionId, db);
  const supersededIds = new Set(all.map((s) => s.supersedesId).filter(Boolean) as string[]);
  return all.filter((s) => !supersededIds.has(s.id));
}

// ── Coverage ─────────────────────────────────────────────────────────────────
export async function getCoverage(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(coverageStates)
    .where(eq(coverageStates.sessionId, sessionId))
    .orderBy(asc(coverageStates.facetId))
    ;
}

export async function getCoverageState(sessionId: string, facetId: number, db: DB = getDb()) {
  return db
    .select()
    .from(coverageStates)
    .where(and(eq(coverageStates.sessionId, sessionId), eq(coverageStates.facetId, facetId)))
    .then((r) => r[0]);
}

/**
 * Apply a coverage transition. Reads the current state, validates the transition
 * against the state machine (throws IllegalCoverageTransitionError if illegal),
 * then persists. This is the server disposing of a model proposal (P1).
 */
export async function setCoverage(
  sessionId: string,
  facetId: number,
  toState: CoverageStateValue,
  db: DB = getDb(),
) {
  const current = await getCoverageState(sessionId, facetId, db);
  if (!current) throw new Error(`No coverage row for session ${sessionId} facet ${facetId}`);
  assertTransition(current.state, toState);
  const row = await db
    .update(coverageStates)
    .set({ state: toState })
    .where(and(eq(coverageStates.sessionId, sessionId), eq(coverageStates.facetId, facetId)))
    .returning().then((r) => r[0]);
  return row;
}

// ── Checklist elements (delta v1.1 R1) ───────────────────────────────────────
export async function getElements(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(elementStates)
    .where(eq(elementStates.sessionId, sessionId))
    .orderBy(asc(elementStates.facetId))
    ;
}

export async function getElementsForFacet(sessionId: string, facetId: number, db: DB = getDb()) {
  return db
    .select()
    .from(elementStates)
    .where(and(eq(elementStates.sessionId, sessionId), eq(elementStates.facetId, facetId)))
    ;
}

/**
 * Recompute a facet's coverage row from its checklist (R1.1). The meter is
 * derived, never authored — so it can never claim more than the elements show.
 *
 * A facet already in a terminal state is left alone: `unknown_to_informant` and a
 * facet-level `not_applicable` are honest human judgements (P3) that outrank the
 * checklist, and `answered` is immutable by the state machine.
 */
export async function reconcileFacetCoverage(sessionId: string, facetId: number, db: DB = getDb()) {
  const current = await getCoverageState(sessionId, facetId, db);
  if (!current) throw new Error(`No coverage row for session ${sessionId} facet ${facetId}`);
  // Terminal states outrank the checklist. In particular an honest unknown must
  // survive later element captures — otherwise a facet the informant disclaimed
  // creeps back to `answered` as adjacent material lands.
  if (isTerminal(current.state)) return current;

  const derived = deriveFacetState(
    await (await getElementsForFacet(sessionId, facetId, db)).map((r) => ({
      elementId: r.elementId,
      state: r.state,
    })),
  );
  if (derived === current.state) return current;

  return db
    .update(coverageStates)
    .set({ state: derived })
    .where(and(eq(coverageStates.sessionId, sessionId), eq(coverageStates.facetId, facetId)))
    .returning().then((r) => r[0]);
}

/**
 * Close a checklist element and re-derive its facet's meter, atomically. This is
 * the server disposing of a model proposal (P1): the element id is validated
 * against the facets spec, and evidence is never walked backwards — a closed
 * element may be refined but never returned to outstanding.
 */
export async function setElement(
  input: {
    sessionId: string;
    facetId: number;
    elementId: string;
    state: Exclude<ElementStateValue, 'outstanding'>;
    summary?: string;
    naReason?: string;
  },
  db: DB = getDb(),
) {
  if (!elementBelongsToFacet(input.elementId, input.facetId)) {
    throw new Error(`Element ${input.elementId} does not belong to facet ${input.facetId}`);
  }

  return db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(elementStates)
      .where(
        and(
          eq(elementStates.sessionId, input.sessionId),
          eq(elementStates.elementId, input.elementId),
        ),
      )
      .then((r) => r[0]);
    if (!current) {
      throw new Error(`No element row for session ${input.sessionId} element ${input.elementId}`);
    }

    const row = await tx
      .update(elementStates)
      .set({
        state: input.state,
        // Keep the prior summary if a refinement arrives without one.
        summary: input.summary ?? current.summary,
        naReason: input.state === 'not_applicable' ? (input.naReason ?? current.naReason) : '',
      })
      .where(
        and(
          eq(elementStates.sessionId, input.sessionId),
          eq(elementStates.elementId, input.elementId),
        ),
      )
      .returning().then((r) => r[0]);

    await reconcileFacetCoverage(input.sessionId, input.facetId, tx as DB);
    return row;
  });
}

/** Outstanding elements, in plain language — what the interview still wants (R1.1). */
export async function outstandingElements(sessionId: string, db: DB = getDb()) {
  return (await getElements(sessionId, db))
    .filter((r) => r.state === 'outstanding')
    .map((r) => ({
      facetId: r.facetId,
      elementId: r.elementId,
      label: getElement(r.elementId)?.label ?? r.elementId,
    }));
}

// ── Answer drafts (delta v1.1 R10.3 — data-loss protection) ──────────────────
// Nothing here hard-deletes. Discard is reversible for the rest of the session and
// a re-record archives the prior take, so no sequence of two taps can destroy a
// transcription.

/** The live (active) draft for a session, if any. */
export async function getActiveDraft(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.status, 'active')))
    .orderBy(desc(answerDrafts.updatedAt))
    .then((r) => r[0]);
}

/** The most recently discarded draft — what Undo restores (R10.3). */
export async function getUndoableDraft(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.status, 'discarded')))
    .orderBy(desc(answerDrafts.updatedAt))
    .then((r) => r[0]);
}

/**
 * Continuous autosave (R10.3). Upserts the live draft for a seq, so a crash, tab
 * close or dropped connection loses seconds rather than the answer.
 */
export async function saveDraft(
  input: {
    sessionId: string;
    seq: number;
    content: string;
    origin?: 'typed' | 'voice' | 'mixed';
  },
  db: DB = getDb(),
) {
  const active = await getActiveDraft(input.sessionId, db);
  if (active && active.seq === input.seq) {
    return db
      .update(answerDrafts)
      .set({ content: input.content, origin: input.origin ?? active.origin })
      .where(eq(answerDrafts.id, active.id))
      .returning().then((r) => r[0]);
  }

  // A draft for a different seq means the previous answer was submitted; retire it.
  if (active) {
    await db.update(answerDrafts).set({ status: 'submitted' }).where(eq(answerDrafts.id, active.id));
  }

  const lastTake = await db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, input.sessionId), eq(answerDrafts.seq, input.seq)))
    .orderBy(desc(answerDrafts.take))
    .then((r) => r[0]);

  return db
    .insert(answerDrafts)
    .values({
      sessionId: input.sessionId,
      seq: input.seq,
      take: (lastTake?.take ?? 0) + 1,
      content: input.content,
      origin: input.origin ?? 'typed',
      status: 'active',
    })
    .returning().then((r) => r[0]);
}

/** Soft-delete: recoverable by Undo for the rest of the session (R10.3). */
export async function discardDraft(sessionId: string, db: DB = getDb()) {
  const active = await getActiveDraft(sessionId, db);
  if (!active) return undefined;
  return db
    .update(answerDrafts)
    .set({ status: 'discarded' })
    .where(eq(answerDrafts.id, active.id))
    .returning().then((r) => r[0]);
}

/** Restore the most recently discarded draft byte-identically (R10.3). */
export async function undoDiscard(sessionId: string, db: DB = getDb()) {
  const discarded = await getUndoableDraft(sessionId, db);
  if (!discarded) return undefined;
  // Retire anything currently live so there is exactly one active draft.
  const active = await getActiveDraft(sessionId, db);
  if (active) {
    await db.update(answerDrafts).set({ status: 'archived' }).where(eq(answerDrafts.id, active.id));
  }
  return db
    .update(answerDrafts)
    .set({ status: 'active' })
    .where(eq(answerDrafts.id, discarded.id))
    .returning().then((r) => r[0]);
}

/**
 * Start a fresh take, archiving the prior one rather than overwriting it (R10.3).
 * The prior take stays recoverable until the replacement is submitted.
 */
export async function startNewTake(sessionId: string, seq: number, db: DB = getDb()) {
  const active = await getActiveDraft(sessionId, db);
  if (active) {
    await db.update(answerDrafts).set({ status: 'archived' }).where(eq(answerDrafts.id, active.id));
  }
  const lastTake = await db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.seq, seq)))
    .orderBy(desc(answerDrafts.take))
    .then((r) => r[0]);

  return db
    .insert(answerDrafts)
    .values({
      sessionId,
      seq,
      take: (lastTake?.take ?? 0) + 1,
      content: '',
      status: 'active',
      origin: 'voice',
    })
    .returning().then((r) => r[0]);
}

/** The archived take a re-record replaced — recoverable until submission (R10.3). */
export async function getArchivedTakes(sessionId: string, seq: number, db: DB = getDb()) {
  return db
    .select()
    .from(answerDrafts)
    .where(
      and(
        eq(answerDrafts.sessionId, sessionId),
        eq(answerDrafts.seq, seq),
        eq(answerDrafts.status, 'archived'),
      ),
    )
    .orderBy(desc(answerDrafts.take))
    ;
}

/** Mark the live draft submitted once its turn is safely persisted. */
export async function markDraftSubmitted(sessionId: string, seq: number, db: DB = getDb()) {
  return db
    .update(answerDrafts)
    .set({ status: 'submitted' })
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.seq, seq)))
    ;
}

// ── Process graphs (delta v1.1 R5 — DL.38) ───────────────────────────────────
// A graph is extracted once per (session, spec version, kind) and reused. Model
// calls are not deterministic, so regenerating per view would leave two reviewers
// looking at different diagrams of the same specification.

export async function getProcessGraph(
  sessionId: string,
  specVersion: number,
  kind: 'asis' | 'tobe' | 'opportunity',
  db: DB = getDb(),
) {
  return db
    .select()
    .from(processGraphs)
    .where(
      and(
        eq(processGraphs.sessionId, sessionId),
        eq(processGraphs.specVersion, specVersion),
        eq(processGraphs.kind, kind),
      ),
    )
    .then((r) => r[0]);
}

/**
 * Store a graph, or return the one already stored. Deliberately not an upsert:
 * a graph is evidence tied to a spec version, and silently replacing one would
 * invalidate any change-set or review already keyed to it. A new spec version
 * gets a new row; regenerating an existing one is a separate, explicit act.
 */
export async function saveProcessGraph(
  input: {
    sessionId: string;
    specVersion: number;
    kind: 'asis' | 'tobe' | 'opportunity';
    graph: unknown;
    changeSet?: unknown;
  },
  db: DB = getDb(),
) {
  const existing = await getProcessGraph(input.sessionId, input.specVersion, input.kind, db);
  if (existing) return existing;

  return db
    .insert(processGraphs)
    .values({
      sessionId: input.sessionId,
      specVersion: input.specVersion,
      kind: input.kind,
      graph: input.graph,
      changeSet: input.changeSet ?? null,
    })
    .returning().then((r) => r[0]);
}

/** Discard a stored graph so the next request re-extracts it. */
export async function deleteProcessGraph(
  sessionId: string,
  specVersion: number,
  kind: 'asis' | 'tobe' | 'opportunity',
  db: DB = getDb(),
) {
  return db
    .delete(processGraphs)
    .where(
      and(
        eq(processGraphs.sessionId, sessionId),
        eq(processGraphs.specVersion, specVersion),
        eq(processGraphs.kind, kind),
      ),
    )
    ;
}

// ── Change reviews (delta v1.1 R5.4 — the verification gate) ─────────────────

export async function listChangeReviews(
  sessionId: string,
  specVersion: number,
  subject: 'change' | 'opportunity' = 'change',
  db: DB = getDb(),
) {
  return db
    .select()
    .from(changeReviews)
    .where(
      and(
        eq(changeReviews.sessionId, sessionId),
        eq(changeReviews.specVersion, specVersion),
        eq(changeReviews.subject, subject),
      ),
    )
    .orderBy(asc(changeReviews.changeIndex));
}

/**
 * Record a reviewer's verdict on one change. Re-reviewing replaces the verdict —
 * a reviewer changing their mind is normal — but the timestamp moves with it, so
 * the record always reflects the decision that currently stands.
 *
 * An edit keeps the reviewer's wording alongside the original rather than
 * replacing it: R5.4 calls human edits eval signal, and the generator learns
 * nothing from a correction that overwrote what it proposed.
 */
export async function recordChangeReview(
  input: {
    sessionId: string;
    specVersion: number;
    changeIndex: number;
    subject?: 'change' | 'opportunity';
    verdict: 'approved' | 'edited' | 'rejected';
    editedDescription?: string | null;
    editedRationale?: string | null;
    note?: string;
    reviewer: string;
  },
  db: DB = getDb(),
) {
  const existing = await db
    .select()
    .from(changeReviews)
    .where(
      and(
        eq(changeReviews.sessionId, input.sessionId),
        eq(changeReviews.specVersion, input.specVersion),
        eq(changeReviews.subject, input.subject ?? 'change'),
        eq(changeReviews.changeIndex, input.changeIndex),
      ),
    )
    .then((r) => r[0]);

  const values = {
    verdict: input.verdict,
    editedDescription: input.editedDescription ?? null,
    editedRationale: input.editedRationale ?? null,
    note: input.note ?? '',
    reviewer: input.reviewer,
    reviewedAt: new Date(),
  };

  if (existing) {
    return db
      .update(changeReviews)
      .set(values)
      .where(eq(changeReviews.id, existing.id))
      .returning().then((r) => r[0]);
  }

  return db
    .insert(changeReviews)
    .values({
      sessionId: input.sessionId,
      specVersion: input.specVersion,
      subject: input.subject ?? 'change',
      changeIndex: input.changeIndex,
      ...values,
    })
    .returning().then((r) => r[0]);
}

// ── Entities and pick-list options (delta v1.1 R2) ───────────────────────────

/**
 * Find or create a canonical entity for a project (R2.3). Matching is on the
 * canonical key, so "Remedy/Helix", "remedy helix" and "Remedy / Helix" all land
 * on one entity rather than three. A name first seen in an interview is created
 * `pending` — it is a candidate for the taxonomy, not yet part of it.
 */
export async function upsertEntity(
  input: {
    projectId: string;
    kind: EntityKind;
    name: string;
    status?: 'confirmed' | 'pending';
    origin?: 'taxonomy' | 'interview';
  },
  db: DB = getDb(),
): Promise<Entity> {
  const key = canonicalKey(input.name);
  if (key === '') throw new Error(`Entity name has no canonical form: "${input.name}"`);

  const existing = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.projectId, input.projectId),
        eq(entities.kind, input.kind),
        eq(entities.canonicalKey, key),
      ),
    )
    .then((r) => r[0]);
  if (existing) return existing;

  return db
    .insert(entities)
    .values({
      projectId: input.projectId,
      kind: input.kind,
      name: input.name.trim(),
      canonicalKey: key,
      status: input.status ?? 'pending',
      origin: input.origin ?? 'interview',
    })
    .returning().then((r) => r[0]);
}

/**
 * Seed a project's taxonomy with the house vocabulary (R2.2). Idempotent — safe on
 * every project creation and re-runnable after the seed list grows.
 */
export async function seedTaxonomy(projectId: string, db: DB = getDb()): Promise<number> {
  let created = 0;
  for (const group of TAXONOMY_SEED) {
    for (const name of group.names) {
      const before = (await listEntities(projectId, group.kind, db)).length;
      await upsertEntity(
        { projectId, kind: group.kind, name, status: 'confirmed', origin: 'taxonomy' },
        db,
      );
      if ((await listEntities(projectId, group.kind, db)).length > before) created += 1;
    }
  }
  return created;
}

export async function listEntities(
  projectId: string,
  kind: EntityKind | null = null,
  db: DB = getDb(),
): Promise<Entity[]> {
  const where = kind
    ? and(eq(entities.projectId, projectId), eq(entities.kind, kind))
    : eq(entities.projectId, projectId);
  return db.select().from(entities).where(where).orderBy(asc(entities.name));
}

/** Record that a session named or ticked an entity on a facet. Idempotent. */
export async function recordEntityMention(
  input: {
    sessionId: string;
    entityId: string;
    facetId: number;
    source?: 'taxonomy' | 'this_interview' | 'prior_interview' | 'other';
  },
  db: DB = getDb(),
) {
  const existing = await db
    .select()
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.sessionId, input.sessionId),
        eq(entityMentions.entityId, input.entityId),
        eq(entityMentions.facetId, input.facetId),
      ),
    )
    .then((r) => r[0]);
  if (existing) return existing;

  return db
    .insert(entityMentions)
    .values({
      sessionId: input.sessionId,
      entityId: input.entityId,
      facetId: input.facetId,
      source: input.source ?? 'other',
    })
    .returning().then((r) => r[0]);
}

export async function listEntityMentions(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(entityMentions)
    .where(eq(entityMentions.sessionId, sessionId))
    ;
}

export interface PicklistOption {
  entityId: string;
  name: string;
  /** Where this option came from — every seeded option carries its source (R2.2). */
  source: 'taxonomy' | 'this_interview' | 'prior_interview';
  /** True when this session has already named it — shown pre-ticked (R2 acceptance). */
  selected: boolean;
  status: 'confirmed' | 'pending';
}

/**
 * The option set for a pick-list facet (R2.2), seeded in priority order:
 *   (a) the org-level taxonomy, (b) entities already named earlier in *this*
 *   interview, (c) entities from prior interviews in the same engagement.
 *
 * Anything this session has already mentioned comes back pre-ticked, so reaching
 * facet 8 after systems were named at facet 4 is a confirmation, not a re-list.
 */
export async function picklistOptions(
  sessionId: string,
  facetId: number,
  db: DB = getDb(),
): Promise<PicklistOption[]> {
  const kind = entityKindFor(facetId);
  if (!kind) return [];
  const session = await getSession(sessionId, db);
  if (!session) return [];

  const all = await listEntities(session.projectId, kind, db);
  const mentions = await db
    .select()
    .from(entityMentions)
    .innerJoin(sessions, eq(entityMentions.sessionId, sessions.id))
    .where(eq(sessions.projectId, session.projectId))
    ;

  const thisSession = new Set(
    mentions.filter((m) => m.entity_mentions.sessionId === sessionId).map((m) => m.entity_mentions.entityId),
  );
  const priorSessions = new Set(
    mentions.filter((m) => m.entity_mentions.sessionId !== sessionId).map((m) => m.entity_mentions.entityId),
  );

  return all
    .map((e): PicklistOption => {
      // Priority order matters: the taxonomy is the strongest provenance, then
      // what this informant already said, then what colleagues said.
      const source: PicklistOption['source'] =
        e.origin === 'taxonomy'
          ? 'taxonomy'
          : thisSession.has(e.id)
            ? 'this_interview'
            : priorSessions.has(e.id)
              ? 'prior_interview'
              : 'prior_interview';
      return {
        entityId: e.id,
        name: e.name,
        source,
        selected: thisSession.has(e.id),
        status: e.status,
      };
    })
    .sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
}

export async function coverageSummary(sessionId: string, db: DB = getDb()) {
  const rows = await getCoverage(sessionId, db);
  return {
    answered: rows.filter((r) => r.state === 'answered').length,
    unknown: rows.filter((r) => r.state === 'unknown_to_informant').length,
    not_applicable: rows.filter((r) => r.state === 'not_applicable').length,
    partial: rows.filter((r) => r.state === 'partial').length,
    pending: rows.filter((r) => r.state === 'pending').length,
    total: rows.length,
  };
}

// ── Findings ─────────────────────────────────────────────────────────────────
export async function raiseFinding(input: Omit<NewFinding, 'id' | 'createdAt' | 'updatedAt'>, db: DB = getDb()): Promise<Finding> {
  const row = await db
.insert(findings).values(input).returning().then((r) => r[0]);
  return row;
}

export async function listFindings(projectId: string, db: DB = getDb()) {
  return db
    .select()
    .from(findings)
    .where(eq(findings.projectId, projectId))
    .orderBy(desc(findings.createdAt))
    ;
}

export async function listFindingsForSession(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(findings)
    .where(eq(findings.sessionId, sessionId))
    .orderBy(desc(findings.createdAt))
    ;
}

export async function updateFinding(
  id: string,
  patch: Partial<Pick<Finding, 'status' | 'routedTo' | 'title' | 'detail'>>,
  db: DB = getDb(),
) {
  const row = await db
.update(findings).set(patch).where(eq(findings.id, id)).returning().then((r) => r[0]);
  return row;
}

// ── Specs (versioned) ────────────────────────────────────────────────────────
export async function nextSpecVersion(sessionId: string, db: DB = getDb()): Promise<number> {
  const last = await db
    .select({ version: specs.version })
    .from(specs)
    .where(eq(specs.sessionId, sessionId))
    .orderBy(desc(specs.version))
    .then((r) => r[0]);
  return (last?.version ?? 0) + 1;
}

export async function saveSpec(
  input: {
    sessionId: string;
    markdown: string;
    coverageSummary: { answered: number; unknown: number; not_applicable: number };
    openItems: string[];
  },
  db: DB = getDb(),
) {
  const version = await nextSpecVersion(input.sessionId, db);
  const row = await db
    .insert(specs)
    .values({
      sessionId: input.sessionId,
      version,
      markdown: input.markdown,
      coverageSummary: input.coverageSummary,
      openItems: input.openItems,
    })
    .returning().then((r) => r[0]);
  return row;
}

export async function getLatestSpec(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(specs)
    .where(eq(specs.sessionId, sessionId))
    .orderBy(desc(specs.version))
    .then((r) => r[0]);
}

export async function getSpec(sessionId: string, version: number, db: DB = getDb()) {
  return db
    .select()
    .from(specs)
    .where(and(eq(specs.sessionId, sessionId), eq(specs.version, version)))
    .then((r) => r[0]);
}
