import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import {
  discardDraft,
  getActiveDraft,
  getArchivedTakes,
  getUndoableDraft,
  markDraftSubmitted,
  saveDraft,
  startNewTake,
  undoDiscard,
} from '@/lib/db/queries';

/**
 * R10.3 is a hard requirement: a lost interview is destroyed evidence. These tests
 * are the guarantee — they assert what *cannot* happen, not just what can.
 */
describe('data-loss protection (R10.3)', () => {
  it('persists a draft as it is typed, so a crash loses seconds not the answer', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);

    saveDraft({ sessionId: session.id, seq: 2, content: 'We log the comp' }, db);
    saveDraft({ sessionId: session.id, seq: 2, content: 'We log the complaint in the CRM' }, db);

    const active = getActiveDraft(session.id, db);
    expect(active?.content).toBe('We log the complaint in the CRM');
    // Autosave refines one row rather than piling up takes.
    expect(active?.take).toBe(1);
  });

  it('restores the exact prior state on reopening — the recovery banner case', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const content = 'Four minutes of transcription that must survive a tab close.';
    saveDraft({ sessionId: session.id, seq: 2, content, origin: 'voice' }, db);

    // Simulate reopening the interview URL: read back what was unsubmitted.
    const recovered = getActiveDraft(session.id, db);
    expect(recovered?.content).toBe(content);
    expect(recovered?.origin).toBe('voice');
  });

  it('makes discard reversible — Undo restores the draft byte-identically', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const content = 'Discard 4 minutes of transcription? — this text must come back exactly.';
    saveDraft({ sessionId: session.id, seq: 2, content }, db);

    discardDraft(session.id, db);
    expect(getActiveDraft(session.id, db)).toBeUndefined();

    const restored = undoDiscard(session.id, db);
    expect(restored?.content).toBe(content);
    expect(getActiveDraft(session.id, db)?.content).toBe(content);
  });

  it('never hard-deletes: a discarded draft is still on disk, awaiting Undo', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    saveDraft({ sessionId: session.id, seq: 2, content: 'still here' }, db);
    discardDraft(session.id, db);

    const discarded = getUndoableDraft(session.id, db);
    expect(discarded?.content).toBe('still here');
    expect(discarded?.status).toBe('discarded');
  });

  it('archives the prior take on re-record rather than overwriting it', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const firstTake = 'The first take, which must survive being replaced.';
    saveDraft({ sessionId: session.id, seq: 2, content: firstTake, origin: 'voice' }, db);

    const fresh = startNewTake(session.id, 2, db);
    expect(fresh.content).toBe('');
    expect(fresh.take).toBe(2);

    const archived = getArchivedTakes(session.id, 2, db);
    expect(archived).toHaveLength(1);
    expect(archived[0].content).toBe(firstTake);
  });

  it('cannot destroy a transcription in two actions — discard then undo round-trips', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const content = 'evidence';
    saveDraft({ sessionId: session.id, seq: 2, content }, db);

    // The worst a pair of taps can do is discard, and that is reversible.
    discardDraft(session.id, db);
    discardDraft(session.id, db); // second tap is a no-op, nothing left active
    expect(undoDiscard(session.id, db)?.content).toBe(content);
  });

  it('keeps exactly one active draft after an undo, so recovery is unambiguous', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    saveDraft({ sessionId: session.id, seq: 2, content: 'first' }, db);
    discardDraft(session.id, db);
    saveDraft({ sessionId: session.id, seq: 2, content: 'second' }, db);

    undoDiscard(session.id, db);
    expect(getActiveDraft(session.id, db)?.content).toBe('first');
  });

  it('retires the draft once its turn is submitted, so it is not offered for recovery', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    saveDraft({ sessionId: session.id, seq: 2, content: 'sent' }, db);
    markDraftSubmitted(session.id, 2, db);
    expect(getActiveDraft(session.id, db)).toBeUndefined();
  });

  it('starts a clean draft for the next question without touching the last one', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    saveDraft({ sessionId: session.id, seq: 2, content: 'answer to Q1' }, db);
    saveDraft({ sessionId: session.id, seq: 4, content: 'answer to Q2' }, db);

    const active = getActiveDraft(session.id, db);
    expect(active?.seq).toBe(4);
    expect(active?.content).toBe('answer to Q2');
    // Nothing was destroyed on the way.
    expect(getUndoableDraft(session.id, db)).toBeUndefined();
  });
});
