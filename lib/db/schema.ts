/**
 * Data model (BUILD-REQUIREMENTS §5).
 *
 * All tables carry id (nanoid), createdAt, updatedAt. Statements and Turns are
 * append-only — corrections supersede (supersedesId), never mutate (enforced by
 * the query module, lib/db/queries.ts). Schema is written so a later swap to
 * Postgres (Cloud SQL). Timestamps are timestamptz, JSON columns are jsonb, and
 * booleans are real booleans — SQLite stored all three as integers or text.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => nanoid());

const createdAt = () =>
  timestamp('created_at', { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

// ── Project ────────────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: id(),
  name: text('name').notNull(),
  department: text('department').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['active', 'closed'] })
    .notNull()
    .default('active'),
  // FR-1.2 / FR-2.3 — optional list of target process names, stored as JSON.
  // This is the *live* list: what an informant may be interviewed about. Every
  // reader wants exactly this, so archiving deliberately removes a name from here
  // rather than adding a status a reader could forget to filter on.
  targetProcesses: jsonb('target_processes').notNull().$type<string[]>().default([]),
  // Retired processes. Kept, not deleted — sessions already recorded against one
  // stay intact and readable, and restoring is a single click. A name lives in
  // exactly one of these two arrays; lib/db/queries.ts owns that invariant.
  archivedProcesses: jsonb('archived_processes').notNull().$type<string[]>().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Interviewee ──────────────────────────────────────────────────────────────
export const interviewees = pgTable(
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
export const sessions = pgTable(
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
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
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
export const turns = pgTable(
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
export const statements = pgTable(
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
    verbatim: boolean('verbatim').notNull().default(false),
    // A correction supersedes an earlier statement; the earlier row is untouched.
    supersedesId: text('supersedes_id'),
    createdAt: createdAt(),
  },
  (t) => ({
    bySessionFacet: index('statements_session_facet_idx').on(t.sessionId, t.facetId),
  }),
);

// ── CoverageState (one row per session × facet, seeded at start) ──────────────
export const coverageStates = pgTable(
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

// ── ElementState (one row per session × checklist element, seeded at start) ───
// Delta v1.1 R1.1: elements are the unit of coverage. The facet meter in
// coverage_states is *derived* from these rows by lib/engine/coverage.ts — never
// set independently, so the meter can never disagree with the checklist.
export const elementStates = pgTable(
  'element_states',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    facetId: integer('facet_id').notNull(),
    /** Stable key from lib/facets/facets.ts — validated server-side before write. */
    elementId: text('element_id').notNull(),
    state: text('state', { enum: ['outstanding', 'captured', 'not_applicable'] })
      .notNull()
      .default('outstanding'),
    /** One-line account of what was captured, shown on the rail (R1.1). */
    summary: text('summary').notNull().default(''),
    /** Why the interviewee marked this N/A (R1.3); empty otherwise. */
    naReason: text('na_reason').notNull().default(''),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => ({
    sessionElementUnique: uniqueIndex('element_states_session_element_unique').on(
      t.sessionId,
      t.elementId,
    ),
    bySessionFacet: index('element_states_session_facet_idx').on(t.sessionId, t.facetId),
  }),
);

// ── AnswerDraft (delta v1.1 R10.3 — data-loss protection) ────────────────────
// An unsubmitted answer, persisted continuously as it is typed or transcribed. A
// crash, tab close or dropped connection loses seconds, not the session.
//
// Rows are never hard-deleted here: discarding sets `discarded`, which Undo can
// reverse for the rest of the session, and a re-record archives the prior take
// rather than overwriting it. Hard deletion happens only at engagement
// decommission, under the existing destruction terms.
export const answerDrafts = pgTable(
  'answer_drafts',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    /** The turn seq this draft will be submitted as — one live draft per seq. */
    seq: integer('seq').notNull(),
    /** Successive attempts at the same answer; a re-record increments this. */
    take: integer('take').notNull().default(1),
    content: text('content').notNull().default(''),
    status: text('status', { enum: ['active', 'discarded', 'archived', 'submitted'] })
      .notNull()
      .default('active'),
    /** Where the text came from, so a re-record knows what it is replacing. */
    origin: text('origin', { enum: ['typed', 'voice', 'mixed'] })
      .notNull()
      .default('typed'),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => ({
    bySession: index('answer_drafts_session_idx').on(t.sessionId),
    sessionSeqTakeUnique: uniqueIndex('answer_drafts_session_seq_take_unique').on(
      t.sessionId,
      t.seq,
      t.take,
    ),
  }),
);

// ── Entity (canonical taxonomy — delta v1.1 R2.2/R2.3) ───────────────────────
// Pick-list facets write canonical entity ids, not free text, so cross-interview
// contribution analysis lines entities up reliably. Free-text "other" answers
// create a `pending` entity awaiting admin confirmation.
export const entities = pgTable(
  'entities',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    kind: text('kind', { enum: ['trigger', 'role', 'io', 'system'] }).notNull(),
    /** As displayed — the informant's or the taxonomy's wording. */
    name: text('name').notNull(),
    /** Slug used for matching across informants and interviews. */
    canonicalKey: text('canonical_key').notNull(),
    status: text('status', { enum: ['confirmed', 'pending'] })
      .notNull()
      .default('pending'),
    /** Where the entity came into being: the seeded taxonomy, or an interview. */
    origin: text('origin', { enum: ['taxonomy', 'interview'] })
      .notNull()
      .default('interview'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    projectKindKeyUnique: uniqueIndex('entities_project_kind_key_unique').on(
      t.projectId,
      t.kind,
      t.canonicalKey,
    ),
    byProjectKind: index('entities_project_kind_idx').on(t.projectId, t.kind),
  }),
);

// ── EntityMention (this session selected/named this entity on this facet) ─────
export const entityMentions = pgTable(
  'entity_mentions',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id),
    facetId: integer('facet_id').notNull(),
    /** How it reached this session — every seeded option carries its source (R2.2). */
    source: text('source', {
      enum: ['taxonomy', 'this_interview', 'prior_interview', 'other'],
    })
      .notNull()
      .default('other'),
    createdAt: createdAt(),
  },
  (t) => ({
    sessionEntityFacetUnique: uniqueIndex('entity_mentions_session_entity_facet_unique').on(
      t.sessionId,
      t.entityId,
      t.facetId,
    ),
    bySession: index('entity_mentions_session_idx').on(t.sessionId),
  }),
);

// ── ProcessGraph (delta v1.1 R5 — persisted so a map is drawn once per spec) ──
// Extraction and change-set generation are live model calls and are not
// deterministic, so a graph regenerated per view would drift: two reviewers
// could be looking at different diagrams of the same specification, and a
// change-set could be keyed to a graph that no longer exists. Persisting by
// (session, spec version, kind) makes the artefact stable and reviewable.
export const processGraphs = pgTable(
  'process_graphs',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    /** The spec version this graph was extracted from — a new spec, a new graph. */
    specVersion: integer('spec_version').notNull(),
    kind: text('kind', { enum: ['asis', 'tobe', 'opportunity'] }).notNull(),
    graph: jsonb('graph').notNull().$type<unknown>(),
    /**
     * For a to-be graph: the change-set it was derived from (R5.4).
     * For an opportunity row: the classification set (R5.5). Both are the
     * *proposal* the graph column's content was derived from, keyed the same way
     * and expiring together when the spec version changes.
     */
    changeSet: jsonb('change_set').$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => ({
    sessionVersionKindUnique: uniqueIndex('process_graphs_session_version_kind_unique').on(
      t.sessionId,
      t.specVersion,
      t.kind,
    ),
    bySession: index('process_graphs_session_idx').on(t.sessionId),
  }),
);

// ── ChangeReview (delta v1.1 R5.4 — the verification gate) ───────────────────
// One row per change per reviewer decision. R5.4 requires the verdict, reviewer
// and timestamp to be held *per change*, not per set: approving four changes and
// rejecting a fifth is the normal outcome, and a set-level flag cannot express it.
//
// Human edits are kept alongside the original rather than replacing it — the
// delta calls them eval signal, and a reviewer's correction is the most valuable
// feedback the generator can get.
export const changeReviews = pgTable(
  'change_reviews',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    /** The spec version whose to-be change-set this reviews. */
    specVersion: integer('spec_version').notNull(),
    /**
     * What is being reviewed. R5.5 puts opportunity classifications behind the
     * same human gate as to-be changes, so one table serves both.
     */
    subject: text('subject', { enum: ['change', 'opportunity'] })
      .notNull()
      .default('change'),
    /** Index into the change-set or the classification set — stable per version. */
    changeIndex: integer('change_index').notNull(),
    verdict: text('verdict', { enum: ['approved', 'edited', 'rejected'] }).notNull(),
    /** The reviewer's wording, when they edited rather than approved as-is. */
    editedDescription: text('edited_description'),
    editedRationale: text('edited_rationale'),
    /** Why it was rejected, or any note the reviewer left. */
    note: text('note').notNull().default(''),
    /** Who reviewed. Thin today — the console is one shared login (DL.62). */
    reviewer: text('reviewer').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (t) => ({
    oneReviewPerItem: uniqueIndex('change_reviews_session_version_subject_index_unique').on(
      t.sessionId,
      t.specVersion,
      t.subject,
      t.changeIndex,
    ),
    bySession: index('change_reviews_session_idx').on(t.sessionId),
  }),
);

// ── Finding ──────────────────────────────────────────────────────────────────
export const findings = pgTable(
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
export const specs = pgTable(
  'specs',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    version: integer('version').notNull(),
    markdown: text('markdown').notNull(),
    coverageSummary: jsonb('coverage_summary')
      .notNull()
      .$type<{ answered: number; unknown: number; not_applicable: number }>(),
    openItems: jsonb('open_items').notNull().$type<string[]>(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
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
export type ElementState = typeof elementStates.$inferSelect;
export type AnswerDraft = typeof answerDrafts.$inferSelect;
export type ProcessGraphRow = typeof processGraphs.$inferSelect;
export type ChangeReview = typeof changeReviews.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type EntityMention = typeof entityMentions.$inferSelect;
export type NewElementState = typeof elementStates.$inferInsert;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type Spec = typeof specs.$inferSelect;
