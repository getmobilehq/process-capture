/**
 * Interview entry logic (BUILD-REQUIREMENTS FR-2). Server-owned: resolves a
 * tokenised link to a polite outcome, and starts (or resumes) a session while
 * seeding coverage and moving the interviewee to in_progress.
 */
import {
  createSession,
  getIntervieweeByToken,
  getProject,
  getResumableSession,
  setIntervieweeStatus,
  updateInterviewee,
  updateSession,
} from '@/lib/db/queries';
import type { DB } from '@/lib/db';
import { getDb } from '@/lib/db';
import type { Interviewee, Project, Session } from '@/lib/db/schema';

export type EntryResolution =
  | { kind: 'invalid' }
  | { kind: 'used_up'; interviewee: Interviewee }
  | {
      kind: 'ok';
      interviewee: Interviewee;
      project: Project;
      resumable: Session | undefined;
    };

/** Resolve a token to what the entry route should render (FR-2.1). */
export function resolveEntry(token: string, db: DB = getDb()): EntryResolution {
  const interviewee = getIntervieweeByToken(token, db);
  if (!interviewee) return { kind: 'invalid' };
  if (interviewee.status === 'complete') return { kind: 'used_up', interviewee };

  const project = getProject(interviewee.projectId, db);
  if (!project) return { kind: 'invalid' };

  const resumable = getResumableSession(interviewee.id, db);
  return { kind: 'ok', interviewee, project, resumable };
}

export class EntryError extends Error {
  constructor(readonly reason: 'invalid' | 'used_up') {
    super(`Cannot start session: ${reason}`);
    this.name = 'EntryError';
  }
}

/**
 * Start or resume a session for the token (FR-2.2, FR-3.8). Resuming reuses the
 * open session; a first start creates one and seeds 12 coverage rows. Sets the
 * interviewee to in_progress. `processName` is the picked target process (FR-2.3)
 * or null for "something else" / open elicitation.
 */
export function startSession(
  input: {
    token: string;
    processName?: string | null;
    fullName?: string;
    email?: string;
    role?: string;
  },
  db: DB = getDb(),
): Session {
  const interviewee = getIntervieweeByToken(input.token, db);
  if (!interviewee) throw new EntryError('invalid');
  if (interviewee.status === 'complete') throw new EntryError('used_up');

  // Persist any edits to the prefilled identity (FR-2.1 — fields are editable).
  const patch: Partial<{ fullName: string; email: string; role: string }> = {};
  if (input.fullName?.trim() && input.fullName.trim() !== interviewee.fullName) {
    patch.fullName = input.fullName.trim();
  }
  if (input.email?.trim() && input.email.trim() !== interviewee.email) {
    patch.email = input.email.trim();
  }
  if (input.role?.trim() && input.role.trim() !== interviewee.role) {
    patch.role = input.role.trim();
  }
  if (Object.keys(patch).length > 0) {
    updateInterviewee(interviewee.id, patch, db);
  }

  const processName = input.processName?.trim() ? input.processName.trim() : null;

  let session = getResumableSession(interviewee.id, db);
  if (session) {
    // Resuming: adopt a newly-picked process name if the session lacked one.
    if (!session.processName && processName) {
      session = updateSession(session.id, { processName }, db);
    }
  } else {
    session = createSession(
      { intervieweeId: interviewee.id, projectId: interviewee.projectId, processName },
      db,
    );
  }

  if (interviewee.status !== 'in_progress') {
    setIntervieweeStatus(interviewee.id, 'in_progress', db);
  }

  return session;
}
