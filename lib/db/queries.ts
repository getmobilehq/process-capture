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
  coverageStates,
  findings,
  interviewees,
  projects,
  sessions,
  specs,
  statements,
  turns,
  type Finding,
  type NewFinding,
  type NewProject,
  type Session,
  type Statement,
} from './schema';
import { FACET_IDS } from '@/lib/facets/facets';
import {
  assertTransition,
  type CoverageStateValue,
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

    return session;
  });
}

export function getSession(id: string, db: DB = getDb()) {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
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
