import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture, type TestDb } from '../helpers/db';
import { completeInterview, openInterview, processUserTurn } from '@/lib/engine/engine';
import { generateAndSaveSpec } from '@/lib/spec/generate';
import { validateSpec } from '@/lib/spec/validate';
import {
  getInterviewee,
  getLatestSpec,
  getSession,
  nextTurnSeq,
  setElement,
  updateSession,
} from '@/lib/db/queries';

async function runToReview(db: TestDb, sessionId: string) {
  await openInterview(sessionId, db);
  for (let i = 0; i < 20; i += 1) {
    const seq = await nextTurnSeq(sessionId, db);
    const res = await processUserTurn(sessionId, { seq, content: 'answer' }, db);
    if (res.review) break;
  }
}

describe('specification generation (FR-5) — golden path yields a valid spec', () => {
  it('generates a valid, provenance-tagged spec with email absent and open_items populated', async () => {
    const { db } = await makeTestDb();
    const { session, interviewee } = await makeSessionFixture(db);
    expect(interviewee.email).toContain('@'); // sanity: the register does hold an email

    await runToReview(db, session.id);
    const { specVersion } = await completeInterview(session.id, db);
    expect(specVersion).toBe(1);

    const spec = (await getLatestSpec(session.id, db))!;
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
    expect(await getSession(session.id, db)!.status).toBe('complete');
    expect(await getInterviewee(interviewee.id, db)!.status).toBe('complete');
  });

  it('is idempotent — completing an already-complete session does not add a version', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await runToReview(db, session.id);
    const first = await completeInterview(session.id, db);
    const second = await completeInterview(session.id, db);
    expect(second.specVersion).toBe(first.specVersion);
  });

  it('regeneration increments the version, never overwrites (FR-5.4)', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await runToReview(db, session.id);
    await completeInterview(session.id, db);
    const regenerated = await generateAndSaveSpec(session.id, db);
    expect(regenerated.version).toBe(2);
  });

  // Delta v1.1 R9.3 — an open session may be finished early; the informant is
  // never trapped by their own coverage. R9.4 requires the result to be honest.
  it('finishes an open interview early and writes an honest, valid spec (R9.3)', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await openInterview(session.id, db);

    // A couple of elements captured; everything else untouched.
    await setElement(
      {
        sessionId: session.id,
        facetId: 1,
        elementId: 'identity.purpose',
        state: 'captured',
        summary: 'Sorting out wrong charges.',
      },
      db,
    );

    const { specVersion } = await completeInterview(session.id, db);
    expect(specVersion).toBe(1);

    const spec = (await getLatestSpec(session.id, db))!;
    expect(validateSpec(spec.markdown).ok).toBe(true);

    // Every element not reached is listed for follow-up, with its facet.
    expect(spec.openItems.length).toBeGreaterThan(30);
    expect(spec.openItems.some((i) => /Facet 12 .*not covered/.test(i))).toBe(true);

    // R9.4 — no section claims content it does not have.
    expect(spec.markdown).toMatch(/Not covered in this interview/);
    expect(spec.markdown).not.toMatch(/— answered/);
  });

  it('still refuses to complete an abandoned session', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await openInterview(session.id, db);
    await updateSession(session.id, { status: 'abandoned' }, db);
    await expect(await completeInterview(session.id, db)).rejects.toThrow(/status abandoned/);
  });
});
