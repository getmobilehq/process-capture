import { describe, it, expect } from 'vitest';
import { makeTestDb, type TestDb } from '../helpers/db';
import {
  addInterviewee,
  appendTurn,
  createProject,
  createSession,
  getSession,
  listTurns,
  raiseFinding,
  recordStatement,
  updateSession,
} from '@/lib/db/queries';
import { applyRetention, cutoffDate, planRetention } from '@/lib/retention';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-07T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

async function seedSession(db: TestDb, opts: { completedAt?: Date; name?: string } = {}) {
  const project = await createProject({ name: 'Ops', department: 'Ops' }, db);
  const interviewee = await addInterviewee(
    {
      projectId: project.id,
      fullName: opts.name ?? 'Priya Nair',
      email: `${(opts.name ?? 'priya').split(' ')[0].toLowerCase()}@example.com`,
      role: 'Advisor',
    },
    db,
  );
  const session = await createSession(
    { intervieweeId: interviewee.id, projectId: project.id, processName: 'Billing' },
    db,
  );
  await appendTurn({ sessionId: session.id, seq: 1, speaker: 'agent', content: 'Hello' }, db);
  await recordStatement(
    { sessionId: session.id, facetId: 1, content: 'It starts in the queue.', kind: 'fact' },
    db,
  );
  await raiseFinding(
    { projectId: project.id, sessionId: session.id, facetId: 9, type: 'unknown_retarget', title: 'x', detail: '', status: 'open', routedTo: '' },
    db,
  );
  if (opts.completedAt) {
    await updateSession(session.id, { status: 'complete', completedAt: opts.completedAt }, db);
  }
  return { project, interviewee, session };
}

describe('retention enforcement (I-2)', () => {
  it('computes the cutoff from the window', () => {
    expect(cutoffDate(NOW, 30)).toEqual(new Date('2026-07-08T12:00:00Z'));
  });

  it('leaves a session inside the window alone', async () => {
    const { db } = await makeTestDb();
    const { session } = await seedSession(db, { completedAt: ago(10) });

    const r = await applyRetention({ now: NOW, retentionDays: 365 }, db);
    expect(r.sessions).toHaveLength(0);
    expect(await getSession(session.id, db)).toBeTruthy();
  });

  it('deletes an expired session and everything beneath it', async () => {
    const { db } = await makeTestDb();
    const { session } = await seedSession(db, { completedAt: ago(400) });

    const r = await applyRetention({ now: NOW, retentionDays: 365 }, db);
    expect(r.applied).toBe(true);
    expect(r.sessions).toHaveLength(1);
    expect(await getSession(session.id, db)).toBeFalsy();
    expect(await listTurns(session.id, db)).toEqual([]);
    expect(r.deleted.turns).toBe(1);
    expect(r.deleted.statements).toBe(1);
    expect(r.deleted.findings).toBe(1);
    expect(r.deleted.coverage_states).toBe(12);
  });

  // The whole point: nothing goes until someone asks for it.
  it('a dry run reports exactly what a real run would delete, and deletes nothing', async () => {
    const { db } = await makeTestDb();
    const { session } = await seedSession(db, { completedAt: ago(400) });

    const dry = await applyRetention({ now: NOW, retentionDays: 365, dryRun: true }, db);
    expect(dry.applied).toBe(false);
    expect(dry.sessions).toHaveLength(1);
    expect(dry.deleted).toEqual({});
    expect(await getSession(session.id, db)).toBeTruthy();

    const real = await applyRetention({ now: NOW, retentionDays: 365 }, db);
    expect(real.sessions.map((s) => s.id)).toEqual(dry.sessions.map((s) => s.id));
  });

  it('expires an abandoned interview that never completed, by last activity', async () => {
    const { db } = await makeTestDb();
    const { session } = await seedSession(db);
    // Never completed; drag its activity back beyond the window.
    await updateSession(session.id, { status: 'abandoned' }, db);
    await db.execute(
      // eslint-disable-next-line
      `update sessions set updated_at = '${ago(500).toISOString()}', created_at = '${ago(500).toISOString()}'` as never,
    );

    const plan = await planRetention({ now: NOW, retentionDays: 365 }, db);
    expect(plan.sessions).toHaveLength(1);
  });

  it('removes an interviewee once they hold no sessions — this is what clears the email', async () => {
    const { db } = await makeTestDb();
    const { interviewee } = await seedSession(db, { completedAt: ago(400) });
    await db.execute(
      `update interviewees set created_at = '${ago(400).toISOString()}'` as never,
    );

    const r = await applyRetention({ now: NOW, retentionDays: 365 }, db);
    expect(r.interviewees.map((i) => i.id)).toContain(interviewee.id);
    expect(r.deleted.interviewees).toBe(1);
  });

  it('keeps an interviewee who still holds a live session, however old their record', async () => {
    const { db } = await makeTestDb();
    const { interviewee } = await seedSession(db, { completedAt: ago(10) });
    await db.execute(
      `update interviewees set created_at = '${ago(900).toISOString()}'` as never,
    );

    const plan = await planRetention({ now: NOW, retentionDays: 365 }, db);
    expect(plan.interviewees).toHaveLength(0);
  });

  it('does nothing, and reports nothing, on an empty database', async () => {
    const { db } = await makeTestDb();
    const r = await applyRetention({ now: NOW, retentionDays: 365 }, db);
    expect(r.applied).toBe(false);
    expect(r.sessions).toEqual([]);
  });
});
