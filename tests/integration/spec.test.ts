import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture, type TestDb } from '../helpers/db';
import { completeInterview, openInterview, processUserTurn } from '@/lib/engine/engine';
import { generateAndSaveSpec } from '@/lib/spec/generate';
import { validateSpec } from '@/lib/spec/validate';
import { getInterviewee, getLatestSpec, getSession, nextTurnSeq } from '@/lib/db/queries';

async function runToReview(db: TestDb, sessionId: string) {
  await openInterview(sessionId, db);
  for (let i = 0; i < 20; i += 1) {
    const seq = nextTurnSeq(sessionId, db);
    const res = await processUserTurn(sessionId, { seq, content: 'answer' }, db);
    if (res.review) break;
  }
}

describe('specification generation (FR-5) — golden path yields a valid spec', () => {
  it('generates a valid, provenance-tagged spec with email absent and open_items populated', async () => {
    const { db } = makeTestDb();
    const { session, interviewee } = makeSessionFixture(db);
    expect(interviewee.email).toContain('@'); // sanity: the register does hold an email

    await runToReview(db, session.id);
    const { specVersion } = await completeInterview(session.id, db);
    expect(specVersion).toBe(1);

    const spec = getLatestSpec(session.id, db)!;
    const validation = validateSpec(spec.markdown);
    expect(validation.ok).toBe(true);

    // Provenance is structural (P4).
    expect(spec.markdown).toMatch(/^provenance: stated$/m);
    // The informant's email never appears (P7).
    expect(spec.markdown).not.toContain(interviewee.email);
    // open_items reflect the unknown_retarget finding for facet 9 (A2/A8).
    expect(spec.openItems.length).toBeGreaterThan(0);
    // Coverage summary matches the golden path.
    expect(spec.coverageSummary).toEqual({ answered: 11, unknown: 1, not_applicable: 0 });

    // Session and interviewee are now complete (FR-4.2).
    expect(getSession(session.id, db)!.status).toBe('complete');
    expect(getInterviewee(interviewee.id, db)!.status).toBe('complete');
  });

  it('is idempotent — completing an already-complete session does not add a version', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await runToReview(db, session.id);
    const first = await completeInterview(session.id, db);
    const second = await completeInterview(session.id, db);
    expect(second.specVersion).toBe(first.specVersion);
  });

  it('regeneration increments the version, never overwrites (FR-5.4)', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await runToReview(db, session.id);
    await completeInterview(session.id, db);
    const regenerated = await generateAndSaveSpec(session.id, db);
    expect(regenerated.version).toBe(2);
  });

  it('refuses to complete a session that is not in review', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await openInterview(session.id, db); // still open, no review reached
    await expect(completeInterview(session.id, db)).rejects.toThrow(/status open/);
  });
});
