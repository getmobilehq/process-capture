import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import { listChangeReviews, recordChangeReview } from '@/lib/db/queries';

describe('change review persistence (R5.4)', () => {
  it('stores the verdict, reviewer and timestamp per change', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await recordChangeReview(
      { sessionId: session.id, specVersion: 1, changeIndex: 0, verdict: 'approved', reviewer: 'a' },
      db,
    );
    const [r] = await listChangeReviews(session.id, 1, db);
    expect(r.verdict).toBe('approved');
    expect(r.reviewer).toBe('a');
    expect(r.reviewedAt).toBeInstanceOf(Date);
  });

  // A reviewer changing their mind is normal; the standing verdict is what counts.
  it('replaces a verdict rather than accumulating rows', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    for (const verdict of ['approved', 'rejected'] as const) {
      await recordChangeReview(
        { sessionId: session.id, specVersion: 1, changeIndex: 0, verdict, reviewer: 'a' },
        db,
      );
    }
    const rows = await listChangeReviews(session.id, 1, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('rejected');
  });

  it('keeps reviews of different changes apart', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await recordChangeReview({ sessionId: session.id, specVersion: 1, changeIndex: 0, verdict: 'approved', reviewer: 'a' }, db);
    await recordChangeReview({ sessionId: session.id, specVersion: 1, changeIndex: 1, verdict: 'rejected', reviewer: 'a' }, db);
    const rows = await listChangeReviews(session.id, 1, db);
    expect(rows.map((r) => r.verdict)).toEqual(['approved', 'rejected']);
  });

  // A new spec version is a new change-set; old approvals must not carry over.
  it('scopes reviews to a spec version', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await recordChangeReview({ sessionId: session.id, specVersion: 1, changeIndex: 0, verdict: 'approved', reviewer: 'a' }, db);
    expect(await listChangeReviews(session.id, 2, db)).toEqual([]);
  });

  it('stores the reviewer’s edit alongside their note, as eval signal', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await recordChangeReview(
      {
        sessionId: session.id,
        specVersion: 1,
        changeIndex: 0,
        verdict: 'edited',
        editedDescription: 'Sharper wording',
        note: 'too vague to action',
        reviewer: 'architect',
      },
      db,
    );
    const [r] = await listChangeReviews(session.id, 1, db);
    expect(r.editedDescription).toBe('Sharper wording');
    expect(r.note).toBe('too vague to action');
  });
});
