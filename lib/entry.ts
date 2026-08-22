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
import { sanitiseForPrompt } from '@/lib/sanitise';

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
export async function resolveEntry(
  token: string,
  db: DB = getDb(),
): Promise<EntryResolution> {
  const interviewee = await getIntervieweeByToken(token, db);
  if (!interviewee) return { kind: 'invalid' };
  if (interviewee.status === 'complete') return { kind: 'used_up', interviewee };

  const project = await getProject(interviewee.projectId, db);
  if (!project) return { kind: 'invalid' };

  const resumable = await getResumableSession(interviewee.id, db);
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
export async function startSession(
  input: {
    token: string;
    processName?: string | null;
    fullName?: string;
    email?: string;
    role?: string;
  },
  db: DB = getDb(),
): Promise<Session> {
  const interviewee = await getIntervieweeByToken(input.token, db);
  if (!interviewee) throw new EntryError('invalid');
  if (interviewee.status === 'complete') throw new EntryError('used_up');

  const project = await getProject(interviewee.projectId, db);

  // Persist any edits to the prefilled identity (FR-2.1 — fields are editable).
  const patch: Partial<{ fullName: string; email: string; role: string }> = {};
  if (input.fullName?.trim() && input.fullName.trim() !== interviewee.fullName) {
    patch.fullName = input.fullName.trim();
  }
  if (input.email?.trim() && input.email.trim() !== interviewee.email) {
    patch.email = input.email.trim();
  }
  // `role` is interpolated into the SYSTEM prompt, so it is sanitised rather than
  // merely trimmed: newlines let a caller close the sentence they are inside and
  // append instructions of their own, and there is no legitimate job title that
  // needs one — or that runs past 120 characters.
  if (input.role?.trim() && input.role.trim() !== interviewee.role) {
    patch.role = sanitiseForPrompt(input.role, 120);
  }
  if (Object.keys(patch).length > 0) {
    await updateInterviewee(interviewee.id, patch, db);
  }

  // Likewise interpolated into the system prompt. It is additionally checked
  // against the campaign's own list: the entry screen offers a <select>, so a
  // value outside it did not come from the form, and accepting free text here
  // made that dropdown decorative. "Something else" is represented by null,
  // which the agent elicits properly (facet 1).
  const requested = input.processName?.trim() ? input.processName.trim() : null;
  const offered = project?.targetProcesses ?? [];
  const processName =
    requested && offered.some((p) => p === requested) ? requested : null;

  let session = await getResumableSession(interviewee.id, db);
  if (session) {
    // Resuming: adopt a newly-picked process name if the session lacked one.
    if (!session.processName && processName) {
      session = await updateSession(session.id, { processName }, db);
    }
  } else {
    session = await createSession(
      { intervieweeId: interviewee.id, projectId: interviewee.projectId, processName },
      db,
    );
  }

  if (interviewee.status !== 'in_progress') {
    await setIntervieweeStatus(interviewee.id, 'in_progress', db);
  }

  return session;
}

// Re-exported so callers and tests have one obvious place to reach for it.
export { sanitiseForPrompt } from '@/lib/sanitise';
