/**
 * Retention enforcement (SDD issue I-2).
 *
 * `RETENTION_DAYS` was configurable but nothing acted on it, so interview content
 * persisted indefinitely. That is not tenable once real informants are
 * interviewed: this is a named person's account of their own job, held with their
 * work email address, and keeping it forever is not a decision anyone made.
 *
 * The rule is deliberately simple, because a retention rule nobody can explain is
 * a retention rule nobody can defend:
 *
 *  - A **session** expires `RETENTION_DAYS` after it finished — or after it was
 *    last touched, if it never finished. Everything beneath it goes with it:
 *    transcript, statements, coverage, drafts, specifications, graphs, reviews,
 *    findings. There is no partial retention of an interview.
 *  - An **interviewee** expires once they hold no sessions at all and their own
 *    record is older than the window. That is what removes the email address.
 *  - **Projects are never touched.** They hold no personal data.
 *
 * Specifications are deleted with their session. They are the deliverable, and
 * the intended path is that a modeller has taken them into ARIS long before the
 * window closes — the handover *is* the export. If a longer life is wanted for
 * specifications specifically, that is a policy decision for the data owner and a
 * change to this module, not something to leave implicit.
 *
 * Nothing here runs on a timer by itself. It is invoked deliberately — by the
 * scheduled job in DEPLOY-GCP.md, or by `npm run retention` — and it reports
 * before it deletes.
 */
import { inArray, lt, sql } from 'drizzle-orm';
import { getDb, type DB } from './db';
import {
  answerDrafts,
  changeReviews,
  coverageStates,
  elementStates,
  entityMentions,
  findings,
  interviewees,
  processGraphs,
  sessions,
  specs,
  statements,
  turns,
} from './db/schema';
import { config } from './config';

export interface RetentionPlan {
  cutoff: Date;
  retentionDays: number;
  /** Sessions past the window, oldest first. */
  sessions: { id: string; intervieweeId: string; expiredOn: Date }[];
  /** Interviewees holding no sessions and themselves past the window. */
  interviewees: { id: string; fullName: string }[];
}

export interface RetentionResult extends RetentionPlan {
  applied: boolean;
  deleted: Record<string, number>;
}

export function cutoffDate(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * What would be deleted, without deleting it. The scheduled job and the CLI both
 * call this first — a destructive sweep that cannot be previewed is one nobody
 * will be willing to switch on.
 */
export async function planRetention(
  opts: { now?: Date; retentionDays?: number } = {},
  db: DB = getDb(),
): Promise<RetentionPlan> {
  const now = opts.now ?? new Date();
  const retentionDays = opts.retentionDays ?? config.retentionDays;
  const cutoff = cutoffDate(now, retentionDays);

  // A session's age is measured from when it finished; failing that, from when it
  // was last active. An interview abandoned two years ago is as expired as one
  // completed two years ago.
  //
  // The bound is written as an ISO string with an explicit cast rather than
  // passed as a Date: `coalesce(...)` is a raw fragment, so Drizzle has no column
  // type to infer from and hands the driver a bare Date it cannot serialise.
  // pglite tolerates this; postgres-js does not, so the tests alone would not
  // have caught it.
  const expiredBefore = sql`coalesce(${sessions.completedAt}, ${sessions.updatedAt}, ${sessions.createdAt}) < ${cutoff.toISOString()}::timestamptz`;
  const expiredSessions = await db
    .select({
      id: sessions.id,
      intervieweeId: sessions.intervieweeId,
      completedAt: sessions.completedAt,
      updatedAt: sessions.updatedAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(expiredBefore);

  const sessionRows = expiredSessions
    .map((s) => ({
      id: s.id,
      intervieweeId: s.intervieweeId,
      expiredOn: s.completedAt ?? s.updatedAt ?? s.createdAt,
    }))
    .sort((a, b) => a.expiredOn.getTime() - b.expiredOn.getTime());

  // Interviewees left holding nothing. Computed against the sessions that will
  // remain, so someone whose only session expires in this same sweep is included.
  const doomed = new Set(sessionRows.map((s) => s.id));
  const surviving = await db.select({ intervieweeId: sessions.intervieweeId, id: sessions.id }).from(sessions);
  const stillHeld = new Set(
    surviving.filter((s) => !doomed.has(s.id)).map((s) => s.intervieweeId),
  );

  const oldInterviewees = await db
    .select({ id: interviewees.id, fullName: interviewees.fullName })
    .from(interviewees)
    .where(lt(interviewees.createdAt, cutoff));

  return {
    cutoff,
    retentionDays,
    sessions: sessionRows,
    interviewees: oldInterviewees.filter((i) => !stillHeld.has(i.id)),
  };
}

/**
 * Apply the plan. One transaction, children before parents, so a failure part way
 * leaves the database exactly as it was rather than half a deleted interview.
 */
export async function applyRetention(
  opts: { now?: Date; retentionDays?: number; dryRun?: boolean } = {},
  db: DB = getDb(),
): Promise<RetentionResult> {
  const plan = await planRetention(opts, db);
  const deleted: Record<string, number> = {};

  if (opts.dryRun || (plan.sessions.length === 0 && plan.interviewees.length === 0)) {
    return { ...plan, applied: false, deleted };
  }

  const sessionIds = plan.sessions.map((s) => s.id);
  const intervieweeIds = plan.interviewees.map((i) => i.id);

  await db.transaction(async (tx) => {
    if (sessionIds.length > 0) {
      // Order matters: everything that references a session, then the session.
      const children = [
        ['turns', turns],
        ['statements', statements],
        ['coverage_states', coverageStates],
        ['element_states', elementStates],
        ['answer_drafts', answerDrafts],
        ['entity_mentions', entityMentions],
        ['process_graphs', processGraphs],
        ['change_reviews', changeReviews],
        ['specs', specs],
        ['findings', findings],
      ] as const;

      for (const [name, table] of children) {
        const rows = await tx
          .delete(table)
          .where(inArray(table.sessionId, sessionIds))
          .returning({ id: table.id });
        deleted[name] = rows.length;
      }

      const gone = await tx
        .delete(sessions)
        .where(inArray(sessions.id, sessionIds))
        .returning({ id: sessions.id });
      deleted.sessions = gone.length;
    }

    if (intervieweeIds.length > 0) {
      const gone = await tx
        .delete(interviewees)
        .where(inArray(interviewees.id, intervieweeIds))
        .returning({ id: interviewees.id });
      deleted.interviewees = gone.length;
    }
  });

  return { ...plan, applied: true, deleted };
}

/** A one-line account for the job log — what went, and what the window was. */
export function describeRetention(r: RetentionPlan | RetentionResult): string {
  const applied = 'applied' in r && r.applied;
  const verb = applied ? 'Deleted' : 'Would delete';
  return (
    `${verb} ${r.sessions.length} session(s) and ${r.interviewees.length} interviewee record(s) ` +
    `older than ${r.retentionDays} days (before ${r.cutoff.toISOString().slice(0, 10)}).`
  );
}
