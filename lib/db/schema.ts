/**
 * Data model (BUILD-REQUIREMENTS §5).
 *
 * All tables carry id (nanoid), createdAt, updatedAt. Statements and Turns are
 * append-only — corrections supersede (supersedesId), never mutate (enforced by
 * the query module, lib/db/queries.ts). Schema is written so a later swap to
 * Postgres is a driver + connection-string change plus a migration re-run.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => nanoid());

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

// ── Project ────────────────────────────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id: id(),
  name: text('name').notNull(),
  department: text('department').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['active', 'closed'] })
    .notNull()
    .default('active'),
  // FR-1.2 / FR-2.3 — optional list of target process names, stored as JSON.
  targetProcesses: text('target_processes', { mode: 'json' })
    .notNull()
    .$type<string[]>()
    .default(sql`'[]'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Interviewee ──────────────────────────────────────────────────────────────
export const interviewees = sqliteTable(
  'interviewees',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    inviteToken: text('invite_token').notNull(),
    status: text('status', { enum: ['invited', 'in_progress', 'complete'] })
      .notNull()
      .default('invited'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    inviteTokenUnique: uniqueIndex('interviewees_invite_token_unique').on(t.inviteToken),
    byProject: index('interviewees_project_idx').on(t.projectId),
  }),
);

// ── Session ──────────────────────────────────────────────────────────────────
export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    intervieweeId: text('interviewee_id')
      .notNull()
      .references(() => interviewees.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    processName: text('process_name'),
    status: text('status', { enum: ['open', 'review', 'complete', 'abandoned'] })
      .notNull()
      .default('open'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    durationSec: integer('duration_sec').notNull().default(0),
    turnCount: integer('turn_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    byInterviewee: index('sessions_interviewee_idx').on(t.intervieweeId),
    byProject: index('sessions_project_idx').on(t.projectId),
  }),
);

// ── Turn (append-only) ───────────────────────────────────────────────────────
export const turns = sqliteTable(
  'turns',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    seq: integer('seq').notNull(),
    speaker: text('speaker', { enum: ['agent', 'user', 'system'] }).notNull(),
    content: text('content').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    // Idempotency (FR-3.9): a network retry of the same turn must not duplicate.
    sessionSeqUnique: uniqueIndex('turns_session_seq_unique').on(t.sessionId, t.seq),
  }),
);

// ── Statement (append-only) ──────────────────────────────────────────────────
export const statements = sqliteTable(
  'statements',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    facetId: integer('facet_id').notNull(),
    content: text('content').notNull(),
    kind: text('kind', {
      enum: ['fact', 'step', 'rule', 'metric', 'issue', 'quote'],
    }).notNull(),
    verbatim: integer('verbatim', { mode: 'boolean' }).notNull().default(false),
    // A correction supersedes an earlier statement; the earlier row is untouched.
    supersedesId: text('supersedes_id'),
    createdAt: createdAt(),
  },
  (t) => ({
    bySessionFacet: index('statements_session_facet_idx').on(t.sessionId, t.facetId),
  }),
);

// ── CoverageState (one row per session × facet, seeded at start) ──────────────
export const coverageStates = sqliteTable(
  'coverage_states',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    facetId: integer('facet_id').notNull(),
    state: text('state', {
      enum: ['pending', 'partial', 'answered', 'unknown_to_informant', 'not_applicable'],
    })
      .notNull()
      .default('pending'),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => ({
    sessionFacetUnique: uniqueIndex('coverage_session_facet_unique').on(t.sessionId, t.facetId),
  }),
);

// ── Finding ──────────────────────────────────────────────────────────────────
export const findings = sqliteTable(
  'findings',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id').references(() => sessions.id),
    facetId: integer('facet_id').notNull(),
    type: text('type', {
      enum: ['unknown_retarget', 'candidate_conflict', 'informant_flag'],
    }).notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull().default(''),
    status: text('status', { enum: ['open', 'acknowledged', 'resolved'] })
      .notNull()
      .default('open'),
    routedTo: text('routed_to').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    byProject: index('findings_project_idx').on(t.projectId),
    bySession: index('findings_session_idx').on(t.sessionId),
  }),
);

// ── Spec (versioned; regeneration increments, never overwrites) ───────────────
export const specs = sqliteTable(
  'specs',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    version: integer('version').notNull(),
    markdown: text('markdown').notNull(),
    coverageSummary: text('coverage_summary', { mode: 'json' })
      .notNull()
      .$type<{ answered: number; unknown: number; not_applicable: number }>(),
    openItems: text('open_items', { mode: 'json' }).notNull().$type<string[]>(),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (t) => ({
    sessionVersionUnique: uniqueIndex('specs_session_version_unique').on(t.sessionId, t.version),
    bySession: index('specs_session_idx').on(t.sessionId),
  }),
);

// Row types (select / insert) for use across the app.
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Interviewee = typeof interviewees.$inferSelect;
export type NewInterviewee = typeof interviewees.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;
export type Statement = typeof statements.$inferSelect;
export type NewStatement = typeof statements.$inferInsert;
export type CoverageState = typeof coverageStates.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type Spec = typeof specs.$inferSelect;
