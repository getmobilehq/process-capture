import { describe, it, expect } from 'vitest';
import {
  blockedReason,
  evalSignal,
  verificationState,
  verifiedChangeSet,
  type ReviewRecord,
} from '@/lib/graph/verification';
import type { Change, ChangeSet } from '@/lib/graph/schema';

const change = (n: number): Change => ({
  op: 'modify',
  target: `act:${n}`,
  description: `Proposed change ${n}`,
  resolvesAnnotationId: [`ann:${n}`],
  rationale: `Because of bottleneck ${n}`,
});

const set = (n = 3): ChangeSet => ({
  baseGraph: 'g',
  provenance: 'proposed',
  verified: false,
  changes: Array.from({ length: n }, (_, i) => change(i)),
});

const review = (i: number, verdict: ReviewRecord['verdict'], extra: Partial<ReviewRecord> = {}): ReviewRecord => ({
  changeIndex: i,
  verdict,
  reviewer: 'architect',
  reviewedAt: new Date('2026-08-05T09:00:00Z'),
  ...extra,
});

describe('the verification gate (R5.4)', () => {
  it('is unverified until every change has been ruled on', () => {
    const s = verificationState(set(3), [review(0, 'approved'), review(1, 'rejected')]);
    expect(s.verified).toBe(false);
    expect(s.reviewed).toBe(2);
    expect(s.outstanding).toEqual([2]);
  });

  it('is verified once every change has a verdict — including rejections', () => {
    const s = verificationState(set(3), [
      review(0, 'approved'),
      review(1, 'rejected'),
      review(2, 'edited', { editedDescription: 'Reworded' }),
    ]);
    expect(s.verified).toBe(true);
    expect(s).toMatchObject({ approved: 1, rejected: 1, edited: 1 });
  });

  // The point of the gate: nothing unreviewed reaches a report.
  it('says why it is blocked, in words a reviewer can act on', () => {
    expect(blockedReason(verificationState(set(3), [review(0, 'approved')])))
      .toMatch(/2 of 3 proposed changes have not been reviewed/);
    expect(blockedReason(verificationState(set(1), [])))
      .toMatch(/1 of 1 proposed change has not been reviewed/);
    expect(blockedReason(verificationState(set(2), [review(0, 'approved'), review(1, 'approved')])))
      .toBeNull();
  });

  it('treats an empty change-set as nothing to review, not as approved output', () => {
    const s = verificationState(set(0), []);
    expect(s.verified).toBe(true);
    expect(blockedReason(s)).toMatch(/no proposed changes/i);
  });

  it('drops rejected changes from the diagram but keeps them on the record', () => {
    const reviews = [review(0, 'approved'), review(1, 'rejected'), review(2, 'approved')];
    const s = verificationState(set(3), reviews);
    expect(s.changes.map((c) => c.included)).toEqual([true, false, true]);
    // Still present for audit — the reviewer's decision is part of the record.
    expect(s.changes[1].review?.verdict).toBe('rejected');
    expect(verifiedChangeSet(set(3), reviews).changes).toHaveLength(2);
  });

  it('applies a reviewer edit to the wording and keeps the original alongside', () => {
    const s = verificationState(set(1), [
      review(0, 'edited', { editedDescription: 'Automate the outage check before dispatch' }),
    ]);
    expect(s.changes[0].change.description).toBe('Automate the outage check before dispatch');
    expect(s.changes[0].original.description).toBe('Proposed change 0');
  });

  // A reviewer may rephrase a change; they may not silently re-aim it.
  it('never lets an edit re-point a change at a different bottleneck', () => {
    const s = verificationState(set(1), [
      review(0, 'edited', { editedDescription: 'Something else entirely' }),
    ]);
    expect(s.changes[0].change.resolvesAnnotationId).toEqual(['ann:0']);
  });

  it('carries the verified flag onto the change-set only when it is earned', () => {
    expect(verifiedChangeSet(set(2), [review(0, 'approved')]).verified).toBe(false);
    expect(
      verifiedChangeSet(set(2), [review(0, 'approved'), review(1, 'approved')]).verified,
    ).toBe(true);
  });

  it('lets a reviewer change their mind — the standing verdict is the one that counts', () => {
    const s = verificationState(set(1), [review(0, 'rejected')]);
    expect(s.changes[0].included).toBe(false);
    const s2 = verificationState(set(1), [review(0, 'approved')]);
    expect(s2.changes[0].included).toBe(true);
  });

  describe('eval signal (R5.4)', () => {
    it('records what was proposed, what the human made of it, and who decided', () => {
      const signal = evalSignal(
        verificationState(set(2), [
          review(0, 'approved'),
          review(1, 'edited', { editedDescription: 'Sharper wording', note: 'too vague' }),
        ]),
      );
      expect(signal).toHaveLength(2);
      expect(signal[0]).toMatchObject({ verdict: 'approved', changed: false });
      expect(signal[1]).toMatchObject({
        verdict: 'edited',
        proposedDescription: 'Proposed change 1',
        finalDescription: 'Sharper wording',
        changed: true,
        note: 'too vague',
        reviewer: 'architect',
      });
    });

    it('reports nothing for changes nobody has ruled on', () => {
      expect(evalSignal(verificationState(set(3), [review(0, 'approved')]))).toHaveLength(1);
    });
  });
});
