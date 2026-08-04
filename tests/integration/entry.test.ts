import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../helpers/db';
import {
  addInterviewee,
  createProject,
  getCoverage,
  getInterviewee,
  listSessionsForProject,
  setIntervieweeStatus,
} from '@/lib/db/queries';
import { resolveEntry, startSession, EntryError } from '@/lib/entry';

async function seedProject(db: TestDb) {
  const project = await createProject(
    { name: 'Consumer operations', department: 'Consumer operations', targetProcesses: ['Billing complaint resolution'] },
    db,
  );
  const interviewee = await addInterviewee(
    { projectId: project.id, fullName: 'Priya Nair', email: 'priya@example.com', role: 'Complaints advisor' },
    db,
  );
  return { project, interviewee };
}

describe('entry resolution (FR-2.1)', () => {
  it('resolves a valid token to an entry screen', async () => {
    const { db } = await makeTestDb();
    const { interviewee } = await seedProject(db);
    const res = await resolveEntry(interviewee.inviteToken, db);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.interviewee.id).toBe(interviewee.id);
      expect(res.project.targetProcesses).toContain('Billing complaint resolution');
      expect(res.resumable).toBeUndefined();
    }
  });

  it('resolves an unknown token to a polite dead-end', async () => {
    const { db } = await makeTestDb();
    await seedProject(db);
    expect(await resolveEntry('not-a-real-token', db).kind).toBe('invalid');
  });

  it('resolves a completed interviewee to used_up', async () => {
    const { db } = await makeTestDb();
    const { interviewee } = await seedProject(db);
    // Complete the interview by finishing a started session flow.
    await startSession({ token: interviewee.inviteToken }, db);
    // Manually mark complete to simulate a finished interview.
    await setIntervieweeStatus(interviewee.id, 'complete', db);
    expect(await resolveEntry(interviewee.inviteToken, db).kind).toBe('used_up');
  });
});

describe('starting and resuming a session (FR-2.2, FR-3.8)', () => {
  it('creates a session, seeds 12 coverage rows, and moves interviewee to in_progress', async () => {
    const { db } = await makeTestDb();
    const { project, interviewee } = await seedProject(db);

    const session = await startSession(
      { token: interviewee.inviteToken, processName: 'Billing complaint resolution' },
      db,
    );

    expect(session.status).toBe('open');
    expect(session.processName).toBe('Billing complaint resolution');
    expect(session.startedAt).toBeInstanceOf(Date);
    expect(await getCoverage(session.id, db)).toHaveLength(12);
    expect(await getInterviewee(interviewee.id, db)!.status).toBe('in_progress');
    expect(await listSessionsForProject(project.id, db)).toHaveLength(1);
  });

  it('resumes the same open session instead of creating a second (FR-3.8)', async () => {
    const { db } = await makeTestDb();
    const { project, interviewee } = await seedProject(db);

    const first = await startSession({ token: interviewee.inviteToken }, db);
    const second = await startSession({ token: interviewee.inviteToken }, db);

    expect(second.id).toBe(first.id);
    expect(await listSessionsForProject(project.id, db)).toHaveLength(1);
  });

  it('persists edits to the prefilled identity', async () => {
    const { db } = await makeTestDb();
    const { interviewee } = await seedProject(db);
    await startSession(
      { token: interviewee.inviteToken, fullName: 'Priya S. Nair', role: 'Senior complaints advisor' },
      db,
    );
    const updated = (await getInterviewee(interviewee.id, db))!;
    expect(updated.fullName).toBe('Priya S. Nair');
    expect(updated.role).toBe('Senior complaints advisor');
  });

  it('rejects starting on a used-up (complete) token', async () => {
    const { db } = await makeTestDb();
    const { interviewee } = await seedProject(db);
    await setIntervieweeStatus(interviewee.id, 'complete', db);
    expect(() => await startSession({ token: interviewee.inviteToken }, db)).toThrow(EntryError);
  });

  it('rejects starting on an unknown token', async () => {
    const { db } = await makeTestDb();
    await seedProject(db);
    expect(() => await startSession({ token: 'nope' }, db)).toThrow(EntryError);
  });
});
