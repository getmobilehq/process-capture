import { describe, it, expect } from 'vitest';
import { makeTestDb, type TestDb } from '../helpers/db';
import {
  addInterviewee,
  archiveTargetProcess,
  countSessionsByProcess,
  createProject,
  createSession,
  getProject,
  restoreTargetProcess,
} from '@/lib/db/queries';
import { startSession } from '@/lib/entry';

const BILLING = 'Billing complaint resolution';
const GOODWILL = 'Goodwill credit approval';

async function seed(db: TestDb) {
  const project = await createProject(
    { name: 'Consumer operations', department: 'Consumer operations', targetProcesses: [BILLING, GOODWILL] },
    db,
  );
  return project;
}

describe('archiving a target process', () => {
  it('moves the name from the live list to the archived one', async () => {
    const { db } = await makeTestDb();
    const project = await seed(db);

    const after = await archiveTargetProcess(project.id, BILLING, db);
    expect(after!.targetProcesses).toEqual([GOODWILL]);
    expect(after!.archivedProcesses).toEqual([BILLING]);
  });

  // The invariant the whole design rests on: one list or the other, never both.
  it('never leaves a name in both lists, or in neither', async () => {
    const { db } = await makeTestDb();
    const project = await seed(db);

    await archiveTargetProcess(project.id, BILLING, db);
    await restoreTargetProcess(project.id, BILLING, db);
    await archiveTargetProcess(project.id, BILLING, db);

    const p = (await getProject(project.id, db))!;
    const both = p.targetProcesses.filter((n) => p.archivedProcesses.includes(n));
    expect(both).toEqual([]);
    expect([...p.targetProcesses, ...p.archivedProcesses].sort()).toEqual([BILLING, GOODWILL].sort());
  });

  it('is idempotent — archiving twice is not an error and does not duplicate', async () => {
    const { db } = await makeTestDb();
    const project = await seed(db);

    await archiveTargetProcess(project.id, BILLING, db);
    const after = await archiveTargetProcess(project.id, BILLING, db);
    expect(after!.archivedProcesses).toEqual([BILLING]);
    expect(after!.targetProcesses).toEqual([GOODWILL]);
  });

  it('restores to the live list', async () => {
    const { db } = await makeTestDb();
    const project = await seed(db);

    await archiveTargetProcess(project.id, BILLING, db);
    const after = await restoreTargetProcess(project.id, BILLING, db);
    expect(after!.targetProcesses).toContain(BILLING);
    expect(after!.archivedProcesses).toEqual([]);
  });

  it('ignores a name that belongs to neither list, and an empty name', async () => {
    const { db } = await makeTestDb();
    const project = await seed(db);

    const a = await archiveTargetProcess(project.id, 'Fault triage', db);
    expect(a!.targetProcesses).toEqual([BILLING, GOODWILL]);
    expect(a!.archivedProcesses).toEqual([]);
    expect(await archiveTargetProcess(project.id, '   ', db)).toBeUndefined();
  });

  it('returns undefined for an unknown project rather than throwing', async () => {
    const { db } = await makeTestDb();
    expect(await archiveTargetProcess('no-such-project', BILLING, db)).toBeUndefined();
  });

  // Archiving withdraws the offer. It must never touch captured work.
  it('leaves sessions already recorded against the process intact and countable', async () => {
    const { db } = await makeTestDb();
    const project = await seed(db);
    const interviewee = await addInterviewee(
      { projectId: project.id, fullName: 'Priya Nair', email: 'priya@example.com', role: 'Complaints advisor' },
      db,
    );
    await createSession(
      { intervieweeId: interviewee.id, projectId: project.id, processName: BILLING },
      db,
    );

    await archiveTargetProcess(project.id, BILLING, db);

    const counts = await countSessionsByProcess(project.id, db);
    expect(counts.get(BILLING)).toBe(1);
  });

  it('still lets an informant resume an interview started before it was archived', async () => {
    const { db } = await makeTestDb();
    const project = await seed(db);
    const interviewee = await addInterviewee(
      { projectId: project.id, fullName: 'Tom Okafor', email: 'tom@example.com', role: 'Billing analyst' },
      db,
    );
    const first = await startSession({ token: interviewee.inviteToken, processName: BILLING }, db);

    await archiveTargetProcess(project.id, BILLING, db);

    const resumed = await startSession({ token: interviewee.inviteToken }, db);
    expect(resumed.id).toBe(first.id);
    expect(resumed.processName).toBe(BILLING);
  });
});
