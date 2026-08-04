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
export function generateInviteToken(): string {
  return nanoid(32);
}

// ── Projects ─────────────────────────────────────────────────────────────────
export function createProject(
  input: Pick<NewProject, 'name' | 'department'> &
    Partial<Pick<NewProject, 'description' | 'targetProcesses'>>,
  db: DB = getDb(),
) {
  const row = db
    .insert(projects)
    .values({
      name: input.name,
      department: input.department,
      description: input.description ?? '',
      targetProcesses: input.targetProcesses ?? [],
    })
    .returning().get();
  // Every engagement starts with the house vocabulary (R2.2).
  seedTaxonomy(row.id, db);
  return row;
}

export function getProject(id: string, db: DB = getDb()) {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function listProjects(db: DB = getDb()) {
  return db.select().from(projects).orderBy(desc(projects.createdAt)).all();
}

export function updateProject(
  id: string,
  patch: Partial<Pick<NewProject, 'name' | 'department' | 'description' | 'status' | 'targetProcesses'>>,
  db: DB = getDb(),
) {
  const row = db.update(projects).set(patch).where(eq(projects.id, id)).returning().get();
  return row;
}

// ── Interviewees ─────────────────────────────────────────────────────────────
export function addInterviewee(
  input: { projectId: string; fullName: string; email: string; role: string },
  db: DB = getDb(),
) {
  const row = db
    .insert(interviewees)
    .values({
      projectId: input.projectId,
      fullName: input.fullName,
      email: input.email,
      role: input.role,
      inviteToken: generateInviteToken(),
    })
    .returning().get();
  return row;
}

export function getInterviewee(id: string, db: DB = getDb()) {
  return db.select().from(interviewees).where(eq(interviewees.id, id)).get();
}

export function getIntervieweeByToken(token: string, db: DB = getDb()) {
  return db.select().from(interviewees).where(eq(interviewees.inviteToken, token)).get();
}

export function listInterviewees(projectId: string, db: DB = getDb()) {
  return db
    .select()
    .from(interviewees)
    .where(eq(interviewees.projectId, projectId))
    .orderBy(asc(interviewees.createdAt))
    .all();
}

export function updateInterviewee(
  id: string,
  patch: Partial<{ fullName: string; email: string; role: string }>,
  db: DB = getDb(),
) {
  const row = db.update(interviewees).set(patch).where(eq(interviewees.id, id)).returning().get();
  return row;
}

export function setIntervieweeStatus(
  id: string,
  status: 'invited' | 'in_progress' | 'complete',
  db: DB = getDb(),
) {
  const row = db
    .update(interviewees)
    .set({ status })
    .where(eq(interviewees.id, id))
    .returning().get();
  return row;
}

// ── Sessions ─────────────────────────────────────────────────────────────────
/**
 * Create a session and seed its 12 coverage rows as `pending`, atomically.
 * Sets startedAt; caller is responsible for interviewee status transitions.
 */
export function createSession(
  input: { intervieweeId: string; projectId: string; processName?: string | null },
  db: DB = getDb(),
): Session {
  return db.transaction((tx) => {
    const session = tx
      .insert(sessions)
      .values({
        intervieweeId: input.intervieweeId,
        projectId: input.projectId,
        processName: input.processName ?? null,
        status: 'open',
        startedAt: new Date(),
      })
      .returning().get();

    tx.insert(coverageStates)
      .values(FACET_IDS.map((facetId) => ({ sessionId: session.id, facetId, state: 'pending' as const })))
      .run();

    // Seed the checklist too (R1.1) — every element starts outstanding, so the
    // interviewee can see the full shape of what is wanted from turn one.
    tx.insert(elementStates)
      .values(
        ALL_ELEMENTS.map((e) => ({
          sessionId: session.id,
          facetId: e.facetId,
          elementId: e.id,
          state: 'outstanding' as const,
        })),
      )
      .run();

    return session;
  });
}

export function getSession(id: string, db: DB = getDb()) {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

/** The most recent session for an interviewee, whatever its status. */
export function getLatestSession(intervieweeId: string, db: DB = getDb()) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.intervieweeId, intervieweeId))
    .orderBy(desc(sessions.createdAt))
    .get();
}

/** The open (resumable) session for an interviewee, if any (FR-3.8). */
export function getResumableSession(intervieweeId: string, db: DB = getDb()) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.intervieweeId, intervieweeId), eq(sessions.status, 'open')))
    .orderBy(desc(sessions.createdAt))
    .get();
}

export function listSessionsForProject(projectId: string, db: DB = getDb()) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(asc(sessions.createdAt))
    .all();
}

export function updateSession(
  id: string,
  patch: Partial<
    Pick<Session, 'processName' | 'status' | 'completedAt' | 'durationSec' | 'turnCount'>
  >,
  db: DB = getDb(),
) {
  const row = db.update(sessions).set(patch).where(eq(sessions.id, id)).returning().get();
  return row;
}

// ── Turns (append-only, idempotent) ──────────────────────────────────────────
export function nextTurnSeq(sessionId: string, db: DB = getDb()): number {
  const last = db
    .select({ seq: turns.seq })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(desc(turns.seq))
    .get();
  return (last?.seq ?? 0) + 1;
}

/**
 * Append a turn. Idempotent on (sessionId, seq): a duplicate submit (network
 * retry) returns the existing row instead of inserting a second (FR-3.9).
 */
export function appendTurn(
  input: { sessionId: string; seq: number; speaker: 'agent' | 'user' | 'system'; content: string },
  db: DB = getDb(),
) {
  const existing = db
    .select()
    .from(turns)
    .where(and(eq(turns.sessionId, input.sessionId), eq(turns.seq, input.seq)))
    .get();
  if (existing) return existing;

  const row = db
    .insert(turns)
    .values({
      sessionId: input.sessionId,
      seq: input.seq,
      speaker: input.speaker,
      content: input.content,
    })
    .returning().get();
  return row;
}

export function listTurns(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(asc(turns.seq))
    .all();
}

// ── Statements (append-only) ─────────────────────────────────────────────────
export function recordStatement(
  input: {
    sessionId: string;
    facetId: number;
    kind: Statement['kind'];
    content: string;
    verbatim?: boolean;
    supersedesId?: string | null;
  },
  db: DB = getDb(),
): Statement {
  const row = db
    .insert(statements)
    .values({
      sessionId: input.sessionId,
      facetId: input.facetId,
      kind: input.kind,
      content: input.content,
      verbatim: input.verbatim ?? false,
      supersedesId: input.supersedesId ?? null,
    })
    .returning().get();
  return row;
}

/**
 * Record a correction that supersedes an earlier statement. The earlier row is
 * never mutated — this is the only correction path (P2, §5).
 */
export function supersedeStatement(
  input: {
    supersedesId: string;
    sessionId: string;
    facetId: number;
    kind: Statement['kind'];
    content: string;
    verbatim?: boolean;
  },
  db: DB = getDb(),
): Statement {
  return recordStatement({ ...input, supersedesId: input.supersedesId }, db);
}

export function listStatements(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(statements)
    .where(eq(statements.sessionId, sessionId))
    .orderBy(asc(statements.createdAt))
    .all();
}

export function listStatementsForFacet(sessionId: string, facetId: number, db: DB = getDb()) {
  return db
    .select()
    .from(statements)
    .where(and(eq(statements.sessionId, sessionId), eq(statements.facetId, facetId)))
    .orderBy(asc(statements.createdAt))
    .all();
}

/** Only statements that have not themselves been superseded (the live set). */
export function listLiveStatements(sessionId: string, db: DB = getDb()) {
  const all = listStatements(sessionId, db);
  const supersededIds = new Set(all.map((s) => s.supersedesId).filter(Boolean) as string[]);
  return all.filter((s) => !supersededIds.has(s.id));
}

// ── Coverage ─────────────────────────────────────────────────────────────────
export function getCoverage(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(coverageStates)
    .where(eq(coverageStates.sessionId, sessionId))
    .orderBy(asc(coverageStates.facetId))
    .all();
}

export function getCoverageState(sessionId: string, facetId: number, db: DB = getDb()) {
  return db
    .select()
    .from(coverageStates)
    .where(and(eq(coverageStates.sessionId, sessionId), eq(coverageStates.facetId, facetId)))
    .get();
}

/**
 * Apply a coverage transition. Reads the current state, validates the transition
 * against the state machine (throws IllegalCoverageTransitionError if illegal),
 * then persists. This is the server disposing of a model proposal (P1).
 */
export function setCoverage(
  sessionId: string,
  facetId: number,
  toState: CoverageStateValue,
  db: DB = getDb(),
) {
  const current = getCoverageState(sessionId, facetId, db);
  if (!current) throw new Error(`No coverage row for session ${sessionId} facet ${facetId}`);
  assertTransition(current.state, toState);
  const row = db
    .update(coverageStates)
    .set({ state: toState })
    .where(and(eq(coverageStates.sessionId, sessionId), eq(coverageStates.facetId, facetId)))
    .returning().get();
  return row;
}

// ── Checklist elements (delta v1.1 R1) ───────────────────────────────────────
export function getElements(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(elementStates)
    .where(eq(elementStates.sessionId, sessionId))
    .orderBy(asc(elementStates.facetId))
    .all();
}

export function getElementsForFacet(sessionId: string, facetId: number, db: DB = getDb()) {
  return db
    .select()
    .from(elementStates)
    .where(and(eq(elementStates.sessionId, sessionId), eq(elementStates.facetId, facetId)))
    .all();
}

/**
 * Recompute a facet's coverage row from its checklist (R1.1). The meter is
 * derived, never authored — so it can never claim more than the elements show.
 *
 * A facet already in a terminal state is left alone: `unknown_to_informant` and a
 * facet-level `not_applicable` are honest human judgements (P3) that outrank the
 * checklist, and `answered` is immutable by the state machine.
 */
export function reconcileFacetCoverage(sessionId: string, facetId: number, db: DB = getDb()) {
  const current = getCoverageState(sessionId, facetId, db);
  if (!current) throw new Error(`No coverage row for session ${sessionId} facet ${facetId}`);
  if (isTerminal(current.state)) return current;

  const derived = deriveFacetState(
    getElementsForFacet(sessionId, facetId, db).map((r) => ({
      elementId: r.elementId,
      state: r.state,
    })),
  );
  if (derived === current.state) return current;

  return db
    .update(coverageStates)
    .set({ state: derived })
    .where(and(eq(coverageStates.sessionId, sessionId), eq(coverageStates.facetId, facetId)))
    .returning().get();
}

/**
 * Close a checklist element and re-derive its facet's meter, atomically. This is
 * the server disposing of a model proposal (P1): the element id is validated
 * against the facets spec, and evidence is never walked backwards — a closed
 * element may be refined but never returned to outstanding.
 */
export function setElement(
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

  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(elementStates)
      .where(
        and(
          eq(elementStates.sessionId, input.sessionId),
          eq(elementStates.elementId, input.elementId),
        ),
      )
      .get();
    if (!current) {
      throw new Error(`No element row for session ${input.sessionId} element ${input.elementId}`);
    }

    const row = tx
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
      .returning().get();

    reconcileFacetCoverage(input.sessionId, input.facetId, tx as DB);
    return row;
  });
}

/** Outstanding elements, in plain language — what the interview still wants (R1.1). */
export function outstandingElements(sessionId: string, db: DB = getDb()) {
  return getElements(sessionId, db)
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
export function getActiveDraft(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.status, 'active')))
    .orderBy(desc(answerDrafts.updatedAt))
    .get();
}

/** The most recently discarded draft — what Undo restores (R10.3). */
export function getUndoableDraft(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.status, 'discarded')))
    .orderBy(desc(answerDrafts.updatedAt))
    .get();
}

/**
 * Continuous autosave (R10.3). Upserts the live draft for a seq, so a crash, tab
 * close or dropped connection loses seconds rather than the answer.
 */
export function saveDraft(
  input: {
    sessionId: string;
    seq: number;
    content: string;
    origin?: 'typed' | 'voice' | 'mixed';
  },
  db: DB = getDb(),
) {
  const active = getActiveDraft(input.sessionId, db);
  if (active && active.seq === input.seq) {
    return db
      .update(answerDrafts)
      .set({ content: input.content, origin: input.origin ?? active.origin })
      .where(eq(answerDrafts.id, active.id))
      .returning().get();
  }

  // A draft for a different seq means the previous answer was submitted; retire it.
  if (active) {
    db.update(answerDrafts).set({ status: 'submitted' }).where(eq(answerDrafts.id, active.id)).run();
  }

  const lastTake = db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, input.sessionId), eq(answerDrafts.seq, input.seq)))
    .orderBy(desc(answerDrafts.take))
    .get();

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
    .returning().get();
}

/** Soft-delete: recoverable by Undo for the rest of the session (R10.3). */
export function discardDraft(sessionId: string, db: DB = getDb()) {
  const active = getActiveDraft(sessionId, db);
  if (!active) return undefined;
  return db
    .update(answerDrafts)
    .set({ status: 'discarded' })
    .where(eq(answerDrafts.id, active.id))
    .returning().get();
}

/** Restore the most recently discarded draft byte-identically (R10.3). */
export function undoDiscard(sessionId: string, db: DB = getDb()) {
  const discarded = getUndoableDraft(sessionId, db);
  if (!discarded) return undefined;
  // Retire anything currently live so there is exactly one active draft.
  const active = getActiveDraft(sessionId, db);
  if (active) {
    db.update(answerDrafts).set({ status: 'archived' }).where(eq(answerDrafts.id, active.id)).run();
  }
  return db
    .update(answerDrafts)
    .set({ status: 'active' })
    .where(eq(answerDrafts.id, discarded.id))
    .returning().get();
}

/**
 * Start a fresh take, archiving the prior one rather than overwriting it (R10.3).
 * The prior take stays recoverable until the replacement is submitted.
 */
export function startNewTake(sessionId: string, seq: number, db: DB = getDb()) {
  const active = getActiveDraft(sessionId, db);
  if (active) {
    db.update(answerDrafts).set({ status: 'archived' }).where(eq(answerDrafts.id, active.id)).run();
  }
  const lastTake = db
    .select()
    .from(answerDrafts)
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.seq, seq)))
    .orderBy(desc(answerDrafts.take))
    .get();

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
    .returning().get();
}

/** The archived take a re-record replaced — recoverable until submission (R10.3). */
export function getArchivedTakes(sessionId: string, seq: number, db: DB = getDb()) {
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
    .all();
}

/** Mark the live draft submitted once its turn is safely persisted. */
export function markDraftSubmitted(sessionId: string, seq: number, db: DB = getDb()) {
  return db
    .update(answerDrafts)
    .set({ status: 'submitted' })
    .where(and(eq(answerDrafts.sessionId, sessionId), eq(answerDrafts.seq, seq)))
    .run();
}

// ── Process graphs (delta v1.1 R5 — DL.38) ───────────────────────────────────
// A graph is extracted once per (session, spec version, kind) and reused. Model
// calls are not deterministic, so regenerating per view would leave two reviewers
// looking at different diagrams of the same specification.

export function getProcessGraph(
  sessionId: string,
  specVersion: number,
  kind: 'asis' | 'tobe',
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
    .get();
}

/**
 * Store a graph, or return the one already stored. Deliberately not an upsert:
 * a graph is evidence tied to a spec version, and silently replacing one would
 * invalidate any change-set or review already keyed to it. A new spec version
 * gets a new row; regenerating an existing one is a separate, explicit act.
 */
export function saveProcessGraph(
  input: {
    sessionId: string;
    specVersion: number;
    kind: 'asis' | 'tobe';
    graph: unknown;
    changeSet?: unknown;
  },
  db: DB = getDb(),
) {
  const existing = getProcessGraph(input.sessionId, input.specVersion, input.kind, db);
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
    .returning().get();
}

/** Discard a stored graph so the next request re-extracts it. */
export function deleteProcessGraph(
  sessionId: string,
  specVersion: number,
  kind: 'asis' | 'tobe',
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
    .run();
}

// ── Entities and pick-list options (delta v1.1 R2) ───────────────────────────

/**
 * Find or create a canonical entity for a project (R2.3). Matching is on the
 * canonical key, so "Remedy/Helix", "remedy helix" and "Remedy / Helix" all land
 * on one entity rather than three. A name first seen in an interview is created
 * `pending` — it is a candidate for the taxonomy, not yet part of it.
 */
export function upsertEntity(
  input: {
    projectId: string;
    kind: EntityKind;
    name: string;
    status?: 'confirmed' | 'pending';
    origin?: 'taxonomy' | 'interview';
  },
  db: DB = getDb(),
): Entity {
  const key = canonicalKey(input.name);
  if (key === '') throw new Error(`Entity name has no canonical form: "${input.name}"`);

  const existing = db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.projectId, input.projectId),
        eq(entities.kind, input.kind),
        eq(entities.canonicalKey, key),
      ),
    )
    .get();
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
    .returning().get();
}

/**
 * Seed a project's taxonomy with the house vocabulary (R2.2). Idempotent — safe on
 * every project creation and re-runnable after the seed list grows.
 */
export function seedTaxonomy(projectId: string, db: DB = getDb()): number {
  let created = 0;
  for (const group of TAXONOMY_SEED) {
    for (const name of group.names) {
      const before = listEntities(projectId, group.kind, db).length;
      upsertEntity(
        { projectId, kind: group.kind, name, status: 'confirmed', origin: 'taxonomy' },
        db,
      );
      if (listEntities(projectId, group.kind, db).length > before) created += 1;
    }
  }
  return created;
}

export function listEntities(
  projectId: string,
  kind: EntityKind | null = null,
  db: DB = getDb(),
): Entity[] {
  const where = kind
    ? and(eq(entities.projectId, projectId), eq(entities.kind, kind))
    : eq(entities.projectId, projectId);
  return db.select().from(entities).where(where).orderBy(asc(entities.name)).all();
}

/** Record that a session named or ticked an entity on a facet. Idempotent. */
export function recordEntityMention(
  input: {
    sessionId: string;
    entityId: string;
    facetId: number;
    source?: 'taxonomy' | 'this_interview' | 'prior_interview' | 'other';
  },
  db: DB = getDb(),
) {
  const existing = db
    .select()
    .from(entityMentions)
    .where(
      and(
        eq(entityMentions.sessionId, input.sessionId),
        eq(entityMentions.entityId, input.entityId),
        eq(entityMentions.facetId, input.facetId),
      ),
    )
    .get();
  if (existing) return existing;

  return db
    .insert(entityMentions)
    .values({
      sessionId: input.sessionId,
      entityId: input.entityId,
      facetId: input.facetId,
      source: input.source ?? 'other',
    })
    .returning().get();
}

export function listEntityMentions(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(entityMentions)
    .where(eq(entityMentions.sessionId, sessionId))
    .all();
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
export function picklistOptions(
  sessionId: string,
  facetId: number,
  db: DB = getDb(),
): PicklistOption[] {
  const kind = entityKindFor(facetId);
  if (!kind) return [];
  const session = getSession(sessionId, db);
  if (!session) return [];

  const all = listEntities(session.projectId, kind, db);
  const mentions = db
    .select()
    .from(entityMentions)
    .innerJoin(sessions, eq(entityMentions.sessionId, sessions.id))
    .where(eq(sessions.projectId, session.projectId))
    .all();

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

export function coverageSummary(sessionId: string, db: DB = getDb()) {
  const rows = getCoverage(sessionId, db);
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
export function raiseFinding(input: Omit<NewFinding, 'id' | 'createdAt' | 'updatedAt'>, db: DB = getDb()): Finding {
  const row = db.insert(findings).values(input).returning().get();
  return row;
}

export function listFindings(projectId: string, db: DB = getDb()) {
  return db
    .select()
    .from(findings)
    .where(eq(findings.projectId, projectId))
    .orderBy(desc(findings.createdAt))
    .all();
}

export function listFindingsForSession(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(findings)
    .where(eq(findings.sessionId, sessionId))
    .orderBy(desc(findings.createdAt))
    .all();
}

export function updateFinding(
  id: string,
  patch: Partial<Pick<Finding, 'status' | 'routedTo' | 'title' | 'detail'>>,
  db: DB = getDb(),
) {
  const row = db.update(findings).set(patch).where(eq(findings.id, id)).returning().get();
  return row;
}

// ── Specs (versioned) ────────────────────────────────────────────────────────
export function nextSpecVersion(sessionId: string, db: DB = getDb()): number {
  const last = db
    .select({ version: specs.version })
    .from(specs)
    .where(eq(specs.sessionId, sessionId))
    .orderBy(desc(specs.version))
    .get();
  return (last?.version ?? 0) + 1;
}

export function saveSpec(
  input: {
    sessionId: string;
    markdown: string;
    coverageSummary: { answered: number; unknown: number; not_applicable: number };
    openItems: string[];
  },
  db: DB = getDb(),
) {
  const version = nextSpecVersion(input.sessionId, db);
  const row = db
    .insert(specs)
    .values({
      sessionId: input.sessionId,
      version,
      markdown: input.markdown,
      coverageSummary: input.coverageSummary,
      openItems: input.openItems,
    })
    .returning().get();
  return row;
}

export function getLatestSpec(sessionId: string, db: DB = getDb()) {
  return db
    .select()
    .from(specs)
    .where(eq(specs.sessionId, sessionId))
    .orderBy(desc(specs.version))
    .get();
}

export function getSpec(sessionId: string, version: number, db: DB = getDb()) {
  return db
    .select()
    .from(specs)
    .where(and(eq(specs.sessionId, sessionId), eq(specs.version, version)))
    .get();
}
